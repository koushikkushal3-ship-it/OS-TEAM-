import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../types.js';

export const IS_PUBLIC = 'teamos:public';
export const REQUIRED_PERMISSION = 'teamos:permission';
export const MASTER_ONLY = 'teamos:master';

/** Route needs no session (login, health, OAuth callback). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export interface PermissionRequirement {
  action: string;
  /** Route param holding the team id the action targets. */
  teamParam?: string;
  /** Route param holding the event id the action targets. */
  eventParam?: string;
}

/**
 * Checked by PermissionGuard through PermissionService.can().
 * `@RequirePermission('team.update', { teamParam: 'id' })`
 */
export const RequirePermission = (action: string, opts: Omit<PermissionRequirement, 'action'> = {}) =>
  SetMetadata(REQUIRED_PERMISSION, { action, ...opts } satisfies PermissionRequirement);

/** Hidden control plane: Master Admin role + privileged session (gateway code + MFA). */
export const MasterOnly = () => SetMetadata(MASTER_ONLY, true);

export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth;
});
