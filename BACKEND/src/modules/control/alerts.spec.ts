import { type AuditRow, deviceOf, detectAlerts } from './alerts.js';

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';

let n = 0;
const row = (p: Partial<AuditRow>): AuditRow => ({
  id: `a${n++}`,
  action: 'auth.login',
  actorId: 'u1',
  actorName: 'Sai',
  ip: '1.2.3.4',
  userAgent: CHROME_WIN,
  createdAt: new Date('2026-09-20T10:00:00Z'),
  ...p,
});

describe('security alerts', () => {
  it('names devices by browser and OS', () => {
    expect(deviceOf(CHROME_WIN)).toBe('Chrome on Windows');
    expect(deviceOf(SAFARI_IOS)).toBe('Safari on iOS');
  });

  it('raises failed gateway attempts only at the threshold', () => {
    const two = [row({ action: 'master.gateway.code_failed' }), row({ action: 'master.gateway.mfa_failed' })];
    expect(detectAlerts(two, [])).toHaveLength(0);
    const three = [...two, row({ action: 'master.gateway.code_failed' })];
    expect(detectAlerts(three, [])[0]).toMatchObject({ kind: 'FAILED_GATEWAY', count: 3 });
  });

  it('flags a sign-in from an unseen device but not a first-ever sign-in', () => {
    expect(detectAlerts([row({ userAgent: SAFARI_IOS })], [])).toHaveLength(0);
    const alerts = detectAlerts([row({ userAgent: SAFARI_IOS })], [row({})]);
    expect(alerts[0]).toMatchObject({ kind: 'NEW_DEVICE' });
    expect(detectAlerts([row({})], [row({})])).toHaveLength(0);
  });

  it('flags bulk downloads within one hour', () => {
    const many = Array.from({ length: 20 }, () => row({ action: 'file.downloaded' }));
    expect(detectAlerts(many, [])[0]).toMatchObject({ kind: 'BULK_DOWNLOAD', count: 20 });
    expect(detectAlerts(many.slice(0, 19), [])).toHaveLength(0);
  });
});
