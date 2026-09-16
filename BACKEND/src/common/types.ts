import type { Request } from 'express';
import type { AuthContext } from '../modules/permissions/permission-engine.js';

export interface SessionInfo {
  id: string;
  gatewayVerifiedAt: Date | null;
  privilegedUntil: Date | null;
  expiresAt: Date;
  /** Set when this is a read-only "view as" preview opened by a Master Admin. */
  impersonatorId: string | null;
}

export interface RequestUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  organizationId: string;
  departmentId: string | null;
}

export interface AuthenticatedRequest extends Request {
  auth: AuthContext;
  user: RequestUser;
  session: SessionInfo;
}

/** Actor metadata recorded with every audit entry. */
export interface AuditActor {
  userId: string;
  organizationId: string;
  sessionId?: string;
  privileged?: boolean;
  ip?: string;
  userAgent?: string;
}

export function actorFrom(req: AuthenticatedRequest): AuditActor {
  return {
    userId: req.user.id,
    organizationId: req.user.organizationId,
    sessionId: req.session.id,
    privileged: req.auth.privileged,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  };
}
