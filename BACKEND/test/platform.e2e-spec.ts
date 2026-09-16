/**
 * Platform features end-to-end: per-person access, notifications, read-only preview,
 * maintenance mode, recycle bin, two-person rule, leave, calendar feed and search.
 * Same requirements as app.e2e-spec.ts — disposable, freshly seeded database.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../src/app.module.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }, { schema: process.env.DATABASE_SCHEMA ?? 'app' }),
});

const MASTER_EMAIL = process.env.SEED_MASTER_ADMIN_EMAIL ?? '';
const run = Boolean(process.env.DATABASE_URL && MASTER_EMAIL && process.env.AUTH_DEV_LOGIN === 'true');

describe.skipIf(!run)('TEAM OS platform features (e2e)', () => {
  let app: INestApplication;
  let master: ReturnType<typeof request.agent>;
  let member: ReturnType<typeof request.agent>;
  const suffix = Date.now().toString(36);
  const memberEmail = `platform-${suffix}@teamos.test`;
  let masterId: string;
  let memberId: string;
  let teamId: string;
  let taskId: string;

  /** Stands in for gateway code + TOTP, which app.e2e-spec.ts already covers. */
  const privilege = async (email: string) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.session.updateMany({ where: { userId: user.id, revokedAt: null, impersonatorId: null }, data: { privilegedUntil: new Date(Date.now() + 3_600_000) } });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    master = request.agent(app.getHttpServer());
    member = request.agent(app.getHttpServer());
    await master.post('/auth/dev-login').send({ email: MASTER_EMAIL }).expect(204);
    masterId = (await prisma.user.findUniqueOrThrow({ where: { email: MASTER_EMAIL } })).id;
    await privilege(MASTER_EMAIL);

    const team = await master.post('/teams').send({ name: `Platform Team ${suffix}` }).expect(201);
    teamId = team.body.id;
    const invited = await master.post('/users').send({ email: memberEmail, name: 'Platform Member' }).expect(201);
    memberId = invited.body.id;
    await master.put(`/teams/${teamId}/members/${memberId}`).send({ memberRole: 'MEMBER' }).expect(200);
    const role = await prisma.role.findFirstOrThrow({ where: { key: 'creative_member' } });
    await prisma.userRole.create({ data: { userId: memberId, roleId: role.id, scopeType: 'ORGANIZATION' } });
    await member.post('/auth/dev-login').send({ email: memberEmail }).expect(204);
  });

  afterAll(async () => {
    await master?.put('/master/control/maintenance').send({ enabled: false, message: '' });
    await app?.close();
    await prisma.$disconnect();
  });

  it('assigning a task notifies the assignee, and marking read clears the count', async () => {
    const task = await master.post('/tasks').send({ title: `Poster ${suffix}`, teamId, assignedToId: memberId }).expect(201);
    taskId = task.body.id;
    const count = await member.get('/notifications/unread-count').expect(200);
    expect(count.body.count).toBeGreaterThanOrEqual(1);
    const list = await member.get('/notifications').expect(200);
    expect(list.body.some((n: { link: string }) => n.link === `/tasks/${taskId}`)).toBe(true);
    await member.post('/notifications/read-all').expect(204);
    expect((await member.get('/notifications/unread-count').expect(200)).body.count).toBe(0);
  });

  it('hiding a module for one person removes it from their menu and blocks the API', async () => {
    await member.post('/leave').send({ startDate: '2026-12-01', endDate: '2026-12-02' }).expect(201);
    expect((await member.get('/auth/me').expect(200)).body.modules).toContain('leave');

    await master.post('/master/permissions/presets').send({ scopeType: 'USER', scopeId: memberId, moduleKey: 'leave', preset: 'DENIED' }).expect(201);
    const me = await member.get('/auth/me').expect(200);
    expect(me.body.modules).not.toContain('leave');
    await member.post('/leave').send({ startDate: '2026-12-03', endDate: '2026-12-03' }).expect(403);

    const access = await master.get('/master/permissions/access').query({ scopeType: 'USER', scopeId: memberId }).expect(200);
    expect(access.body.find((m: { key: string }) => m.key === 'leave').preset).toBe('DENIED');

    await master.post('/master/permissions/presets').send({ scopeType: 'USER', scopeId: memberId, moduleKey: 'leave', preset: 'DEFAULT' }).expect(201);
    expect((await member.get('/auth/me').expect(200)).body.modules).toContain('leave');
  });

  it('temporary access must end in the future', async () => {
    await master
      .post('/master/permissions/presets')
      .send({ scopeType: 'USER', scopeId: memberId, moduleKey: 'finance', preset: 'FULL', expiresAt: '2020-01-01T00:00:00Z' })
      .expect(400);
  });

  it('view as is read-only and never touches the control plane', async () => {
    await master.post(`/master/control/view-as/${memberId}`).expect(201);
    const me = await master.get('/auth/me').expect(200);
    expect(me.body.user.id).toBe(memberId);
    expect(me.body.viewAs.impersonatorName).toBeTruthy();

    const blocked = await master.post('/kudos').send({ toId: masterId, message: 'Should not be sent' }).expect(403);
    expect(blocked.body.code).toBe('READ_ONLY_PREVIEW');
    // Master routes still run as the Master Admin.
    await master.get('/master/control/health').expect(200);

    await master.delete('/view-as').expect(204);
    expect((await master.get('/auth/me').expect(200)).body.user.id).toBe(masterId);
  });

  it('maintenance mode closes the portal to everyone but a privileged Master Admin', async () => {
    await master.put('/master/control/maintenance').send({ enabled: true, message: 'Back soon' }).expect(200);
    const res = await member.post('/kudos').send({ toId: masterId, message: 'Thanks for the help' }).expect(503);
    expect(res.body.code).toBe('MAINTENANCE');
    // Reading is closed too, but the lock screen can still load who you are.
    await member.get('/tasks').query({ scope: 'mine' }).expect(503);
    expect((await member.get('/auth/me').expect(200)).body.maintenance.message).toBe('Back soon');
    await master.get('/tasks').query({ scope: 'mine' }).expect(200);
    await master.put('/master/control/maintenance').send({ enabled: false, message: '' }).expect(200);
    await member.post('/kudos').send({ toId: masterId, message: 'Thanks for the help' }).expect(201);
  });

  it('a deleted task goes to the recycle bin and can be restored', async () => {
    await master.delete(`/tasks/${taskId}`).expect(204);
    const bin = await master.get('/master/control/bin').expect(200);
    const item = bin.body.items.find((b: { entityId: string }) => b.entityId === taskId);
    expect(item.deletedBy.id).toBe(masterId);
    expect(item.label).toContain('Poster');
    await master.post(`/master/control/bin/${item.id}/restore`).expect(201);
    expect(await prisma.task.findUnique({ where: { id: taskId } })).not.toBeNull();
    await master.post(`/master/control/bin/${item.id}/restore`).expect(404);
  });

  it("one person's portal can be closed while everyone else keeps working", async () => {
    await master.post('/master/control/maintenance/people').send({ userId: memberId, message: 'Your account is being updated' }).expect(201);
    const me = await member.get('/auth/me').expect(200);
    expect(me.body.maintenance).toMatchObject({ scope: 'personal', message: 'Your account is being updated' });
    await member.get('/tasks').query({ scope: 'mine' }).expect(503);
    await master.get('/tasks').query({ scope: 'mine' }).expect(200);
    await master.post('/master/control/maintenance/people').send({ userId: masterId }).expect(400);

    await master.delete(`/master/control/maintenance/people/${memberId}`).expect(200);
    await member.get('/tasks').query({ scope: 'mine' }).expect(200);
  });

  it('recycle bin: ignore keeps it restorable, delete permanently removes it, and an event comes back with its teams', async () => {
    const event = await master.post('/events').send({ name: `Bin Event ${suffix}`, teamIds: [teamId] }).expect(201);
    await master.delete(`/events/${event.body.id}`).expect(204);
    let bin = await master.get('/master/control/bin').expect(200);
    const eventItem = bin.body.items.find((b: { entityId: string }) => b.entityId === event.body.id);
    expect(eventItem.entityType).toBe('event');

    await master.post(`/master/control/bin/${eventItem.id}/ignore`).expect(201);
    bin = await master.get('/master/control/bin').query({ view: 'ignored' }).expect(200);
    expect(bin.body.items.some((b: { id: string }) => b.id === eventItem.id)).toBe(true);
    await master.post(`/master/control/bin/${eventItem.id}/restore`).expect(201);
    expect(await prisma.eventTeam.count({ where: { eventId: event.body.id } })).toBe(1);

    const doomed = await master.post('/tasks').send({ title: `Doomed ${suffix}`, teamId }).expect(201);
    await master.delete(`/tasks/${doomed.body.id}`).expect(204);
    const doomedItem = (await master.get('/master/control/bin').expect(200)).body.items.find((b: { entityId: string }) => b.entityId === doomed.body.id);
    await master.delete(`/master/control/bin/${doomedItem.id}`).expect(204);
    expect(await prisma.deletedRecord.count({ where: { id: doomedItem.id } })).toBe(0);
  });

  it('schedule: leads and admins write, workers only read, and removals go to the recycle bin', async () => {
    const from = '2026-10-01T00:00:00Z';
    const to = '2026-10-31T23:59:59Z';
    const entry = await master
      .post('/schedule')
      .send({ title: `Town hall ${suffix}`, startsAt: '2026-10-10T04:30:00Z', endsAt: '2026-10-10T06:00:00Z', category: 'Meeting' })
      .expect(201);
    const teamOnly = await master
      .post('/schedule')
      .send({ title: `Team rehearsal ${suffix}`, startsAt: '2026-10-11T04:30:00Z', endsAt: '2026-10-11T06:00:00Z', scopeType: 'TEAM', scopeId: teamId })
      .expect(201);
    await master.post('/schedule').send({ title: 'Nobody', startsAt: from, endsAt: from, scopeType: 'TEAM' }).expect(400);

    const seen = await member.get('/schedule').query({ from, to }).expect(200);
    const titles = seen.body.items.map((i: { title: string }) => i.title);
    expect(titles).toContain(`Town hall ${suffix}`);
    expect(titles).toContain(`Team rehearsal ${suffix}`);
    expect(seen.body.capabilities.canManage).toBe(false);
    expect(seen.body.items.every((i: { canEdit: boolean }) => !i.canEdit)).toBe(true);

    await member.post('/schedule').send({ title: 'Worker entry', startsAt: from, endsAt: from }).expect(403);
    await member.patch(`/schedule/${entry.body.id}`).send({ title: 'Changed', startsAt: from, endsAt: from }).expect(403);
    await member.delete(`/schedule/${entry.body.id}`).expect(403);

    const cal = await member.get('/calendar').query({ from, to }).expect(200);
    expect(cal.body.some((c: { kind: string }) => c.kind === 'schedule')).toBe(true);

    await master.delete(`/schedule/${teamOnly.body.id}`).expect(204);
    const bin = await master.get('/master/control/bin').expect(200);
    expect(bin.body.items.some((b: { entityId: string; entityType: string }) => b.entityId === teamOnly.body.id && b.entityType === 'schedule_entry')).toBe(true);
  });

  it('undo puts a disabled person back', async () => {
    await master.post(`/users/${memberId}/disable`).expect(201);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.disabled', entityId: memberId }, orderBy: { createdAt: 'desc' } });
    await master.post(`/master/control/audit/${entry.id}/revert`).expect(201);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: memberId } })).status).toBe('ACTIVE');
    await master.post(`/master/control/audit/${entry.id}/revert`).expect(409);
    await member.post('/auth/dev-login').send({ email: memberEmail }).expect(204);
  });

  it('two-person rule: with two Master Admins a grant waits for the other one', async () => {
    const masterRole = await prisma.role.findFirstOrThrow({ where: { isMasterAdmin: true } });
    // Only one active Master Admin: goes through directly.
    await prisma.userRole.deleteMany({ where: { roleId: masterRole.id, userId: { not: masterId } } });
    const first = await master.post(`/master/users/${memberId}/roles`).send({ roleId: masterRole.id, scopeType: 'ORGANIZATION' }).expect(201);
    expect(first.body.pendingApproval).toBeUndefined();

    const third = await master.post('/users').send({ email: `third-${suffix}@teamos.test`, name: 'Third Person' }).expect(201);
    const pending = await master.post(`/master/users/${third.body.id}/roles`).send({ roleId: masterRole.id, scopeType: 'ORGANIZATION' }).expect(201);
    expect(pending.body.pendingApproval).toBe(true);

    await master.post(`/master/control/approvals/${pending.body.requestId}/approve`).expect(403);
    await member.post('/auth/dev-login').send({ email: memberEmail }).expect(204);
    await privilege(memberEmail);
    await member.post(`/master/control/approvals/${pending.body.requestId}/approve`).expect(201);
    expect(await prisma.userRole.count({ where: { userId: third.body.id, roleId: masterRole.id } })).toBe(1);
  });

  it('calendar feed is private by token and serves iCalendar', async () => {
    const { body } = await member.post('/calendar/feed-token').expect(201);
    const feed = await request(app.getHttpServer()).get(`/calendar/feed/${body.token}.ics`).expect(200);
    expect(feed.headers['content-type']).toContain('text/calendar');
    expect(feed.text).toContain('BEGIN:VCALENDAR');
    await request(app.getHttpServer()).get('/calendar/feed/not-a-real-token.ics').expect(404);
  });

  it('search finds my task and bulk invite checks rows before creating anyone', async () => {
    const found = await member.get('/search').query({ q: `Poster ${suffix}` }).expect(200);
    expect(found.body.tasks.map((t: { id: string }) => t.id)).toContain(taskId);

    const csv = `email,name\nnew-${suffix}@teamos.test,New Person\nbad-email,Nobody`;
    const dry = await master.post('/master/control/people/bulk-invite').send({ csv, dryRun: true }).expect(201);
    expect(dry.body.ready).toBe(1);
    expect(dry.body.problems).toHaveLength(1);
    expect(await prisma.user.count({ where: { email: `new-${suffix}@teamos.test` } })).toBe(0);
  });
});
