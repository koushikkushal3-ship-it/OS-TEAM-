/**
 * Security alerts derived from the audit log — no separate tracking, so an alert can
 * always be traced back to the exact audit entries behind it.
 */

export interface AuditRow {
  id: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export type AlertKind = 'FAILED_GATEWAY' | 'NEW_DEVICE' | 'BULK_DOWNLOAD' | 'MASTER_GRANTED';

export interface SecurityAlert {
  kind: AlertKind;
  severity: 'high' | 'medium';
  actorId: string | null;
  actorName: string | null;
  message: string;
  at: Date;
  count: number;
}

export const FAILED_GATEWAY_THRESHOLD = 3;
export const BULK_DOWNLOAD_THRESHOLD = 20;

/** Rough device fingerprint: browser + OS family, so a browser update is not "new". */
export function deviceOf(userAgent: string | null) {
  if (!userAgent) return 'unknown';
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /Chrome\//.test(userAgent) ? 'Chrome' : /Firefox\//.test(userAgent) ? 'Firefox' : /Safari\//.test(userAgent) ? 'Safari' : 'Other';
  const os = /Android/.test(userAgent) ? 'Android' : /iPhone|iPad/.test(userAgent) ? 'iOS' : /Windows/.test(userAgent) ? 'Windows' : /Mac OS/.test(userAgent) ? 'macOS' : /Linux/.test(userAgent) ? 'Linux' : 'Other';
  return `${browser} on ${os}`;
}

/**
 * @param recent audit rows inside the alert window, newest first
 * @param history earlier sign-ins used to decide whether a device is new
 */
export function detectAlerts(recent: AuditRow[], history: AuditRow[]): SecurityAlert[] {
  const alerts: SecurityAlert[] = [];

  // Repeated wrong gateway code or authenticator code, per person.
  const failed = new Map<string, AuditRow[]>();
  for (const r of recent) {
    if (!r.actorId || !['master.gateway.code_failed', 'master.gateway.mfa_failed'].includes(r.action)) continue;
    failed.set(r.actorId, [...(failed.get(r.actorId) ?? []), r]);
  }
  for (const rows of failed.values()) {
    if (rows.length < FAILED_GATEWAY_THRESHOLD) continue;
    alerts.push({ kind: 'FAILED_GATEWAY', severity: 'high', actorId: rows[0].actorId, actorName: rows[0].actorName, count: rows.length, at: rows[0].createdAt, message: `${rows.length} failed Master gateway attempts` });
  }

  // Sign-in from a device not seen for that person before.
  const known = new Map<string, Set<string>>();
  for (const r of history) {
    if (!r.actorId || !r.action.startsWith('auth.')) continue;
    known.set(r.actorId, (known.get(r.actorId) ?? new Set()).add(deviceOf(r.userAgent)));
  }
  const logins = recent.filter((r) => r.actorId && ['auth.login', 'auth.first_login'].includes(r.action)).reverse();
  for (const r of logins) {
    const devices = known.get(r.actorId!) ?? new Set<string>();
    const device = deviceOf(r.userAgent);
    // A first-ever sign-in is expected, not suspicious.
    if (devices.size > 0 && !devices.has(device)) {
      alerts.push({ kind: 'NEW_DEVICE', severity: 'medium', actorId: r.actorId, actorName: r.actorName, count: 1, at: r.createdAt, message: `Signed in from a new device: ${device}${r.ip ? ` (${r.ip})` : ''}` });
    }
    known.set(r.actorId!, devices.add(device));
  }

  // Many file downloads by one person within an hour.
  const downloads = new Map<string, AuditRow[]>();
  for (const r of recent) {
    if (!r.actorId || r.action !== 'file.downloaded') continue;
    const key = `${r.actorId}:${Math.floor(r.createdAt.getTime() / 3_600_000)}`;
    downloads.set(key, [...(downloads.get(key) ?? []), r]);
  }
  for (const rows of downloads.values()) {
    if (rows.length < BULK_DOWNLOAD_THRESHOLD) continue;
    alerts.push({ kind: 'BULK_DOWNLOAD', severity: 'high', actorId: rows[0].actorId, actorName: rows[0].actorName, count: rows.length, at: rows[0].createdAt, message: `${rows.length} files downloaded within one hour` });
  }

  for (const r of recent) {
    if (r.action !== 'user.master_admin_granted') continue;
    alerts.push({ kind: 'MASTER_GRANTED', severity: 'medium', actorId: r.actorId, actorName: r.actorName, count: 1, at: r.createdAt, message: 'Granted Master Admin to someone' });
  }

  return alerts.sort((a, b) => b.at.getTime() - a.at.getTime());
}
