import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SessionService, VIEW_AS_COOKIE } from '../../modules/auth/session.service.js';
import { PlatformSettingsService, maintenanceFor } from '../../modules/platform/platform-settings.service.js';
import { PermissionService } from '../../modules/permissions/permission.service.js';
import {
  IS_PUBLIC,
  MASTER_ONLY,
  type PermissionRequirement,
  REQUIRED_PERMISSION,
} from '../decorators/auth.decorators.js';
import type { AuthenticatedRequest } from '../types.js';

/**
 * Global request pipeline (arch doc §44):
 * Authentication → Organization context → Master Admin plane check → Permission check.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly permissions: PermissionService,
    private readonly settings: PlatformSettingsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handlers = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, handlers)) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const masterRoute = this.reflector.getAllAndOverride<boolean>(MASTER_ONLY, handlers);
    const writing = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);

    // 1. Authentication. A "view as" preview answers the user plane only; the control
    //    plane always runs as the Master Admin themselves.
    const previewToken: string | undefined = masterRoute ? undefined : req.cookies?.[VIEW_AS_COOKIE];
    const preview = previewToken ? await this.sessions.resolve(previewToken) : null;
    const token: string | undefined = req.cookies?.[this.sessions.cookieName];
    const session = preview?.impersonatorId ? preview : token ? await this.sessions.resolve(token) : null;
    if (!session) throw new UnauthorizedException({ message: 'Sign in required', code: 'UNAUTHENTICATED' });
    if (session.impersonatorId && writing) {
      throw new ForbiddenException({ message: 'This is a read-only preview. Exit "view as" to make changes.', code: 'READ_ONLY_PREVIEW' });
    }

    const { user, ...sessionFields } = session;
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      organizationId: user.organizationId,
      departmentId: user.departmentId,
    };
    req.session = {
      id: sessionFields.id,
      gatewayVerifiedAt: sessionFields.gatewayVerifiedAt,
      privilegedUntil: sessionFields.privilegedUntil,
      expiresAt: sessionFields.expiresAt,
      impersonatorId: sessionFields.impersonatorId,
    };
    req.auth = await this.permissions.buildContext(user.id, sessionFields);

    // Maintenance mode closes the portal to everyone — reading included — except a Master Admin with a
    // privileged session. The Master console and its gateway stay reachable so they can switch it off,
    // and /auth/me + sign-out stay open so the lock screen can explain itself.
    const openDuringMaintenance = masterRoute || req.path.startsWith('/master/') || req.path === '/auth/me' || req.path === '/auth/logout';
    if (!openDuringMaintenance && !req.auth.privileged) {
      const maintenance = maintenanceFor(await this.settings.maintenance(), req.user.id);
      if (maintenance) {
        throw new ServiceUnavailableException({
          message: maintenance.message || 'TEAM OS is in maintenance.',
          code: 'MAINTENANCE',
        });
      }
    }

    // 2. Hidden control plane — non-eligible users see a 404, never a hint that it exists.
    if (masterRoute) {
      if (!req.auth.hasMasterRole) throw new NotFoundException();
      if (!req.auth.privileged) {
        throw new ForbiddenException({
          message: 'Master Admin session required',
          code: 'PRIVILEGED_SESSION_REQUIRED',
        });
      }
    }

    // 3. Permission check
    const requirement = this.reflector.getAllAndOverride<PermissionRequirement>(REQUIRED_PERMISSION, handlers);
    if (requirement) {
      const param = (name?: string) => (name ? String(req.params[name]) : undefined);
      await this.permissions.assert(req.auth, requirement.action, {
        teamId: param(requirement.teamParam),
        eventId: param(requirement.eventParam),
      });
    }

    return true;
  }
}
