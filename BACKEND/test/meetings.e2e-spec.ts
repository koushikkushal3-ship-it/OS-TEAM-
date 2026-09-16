/**
 * Phase 3 end-to-end: meeting lifecycle, attendance derivation, decisions,
 * action items becoming tasks. Disposable, freshly seeded database.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }, { schema: process.env.DATABASE_SCHEMA ?? 'app' }),
});

const MASTER_EMAIL = process.env.SEED_MASTER_ADMIN_EMAIL ?? '';
const run = Boolean(process.env.DATABASE_URL && MASTER_EMAIL && process.env.AUTH_DEV_LOGIN === 'true');

describe.skipIf(!run)('TEAM OS meetings & attendance (e2e)', () => {
  let app: INestApplication;
  let lead: ReturnType<typeof request.agent>;
  let member: ReturnType<typeof request.agent>;
  const suffix = Date.now().toString(36);
  const memberEmail = `attendee-${suffix}@teamos.test`;
  let teamId: string;
  let memberId: string;
  let meetingId: string;

  const iso = (h: number, m = 0) => new Date(2026, 8, 20, h, m).toISOString();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    lead = request.agent(app.getHttpServer());
    member = request.agent(app.getHttpServer());
    await lead.post('/auth/dev-login').send({ email: MASTER_EMAIL }).expect(204);

    const team = await lead.post('/teams').send({ name: `Meeting Team ${suffix}` }).expect(201);
    teamId = team.body.id;
    const invited = await lead.post('/users').send({ email: memberEmail, name: 'Meeting Member' }).expect(201);
    memberId = invited.body.id;
    await lead.put(`/teams/${teamId}/members/${memberId}`).send({ memberRole: 'MEMBER' }).expect(200);

    const memberRole = await prisma.role.findFirstOrThrow({ where: { key: 'creative_member' } });
    await prisma.userRole.create({ data: { userId: memberId, roleId: memberRole.id, scopeType: 'ORGANIZATION' } });
    await member.post('/auth/dev-login').send({ email: memberEmail }).expect(204);
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('creates a meeting with participants and a Meet link', async () => {
    const res = await lead
      .post('/meetings')
      .send({
        title: `Creative sync ${suffix}`,
        type: 'GOOGLE_MEET',
        teamId,
        joinUrl: 'https://meet.google.com/abc-defg-hij',
        agenda: 'Stage design review',
        scheduledStart: iso(19),
        scheduledEnd: iso(20),
        participantIds: [memberId],
      })
      .expect(201);
    meetingId = res.body.id;
    expect(res.body.provider).toBe('GOOGLE_MEET_LINK');
    expect(res.body._count.participants).toBe(2); // host + invited member
  });

  it('a member cannot create meetings but sees the one they are invited to', async () => {
    await member.post('/meetings').send({ title: 'Nope', scheduledStart: iso(21), scheduledEnd: iso(22) }).expect(403);
    const mine = await member.get('/meetings').query({ scope: 'mine' }).expect(200);
    expect(mine.body.map((m: { id: string }) => m.id)).toContain(meetingId);
  });

  it('joining records a session and takes the meeting live', async () => {
    const res = await member.post(`/meetings/${meetingId}/join`).expect(201);
    expect(res.body.joinUrl).toBe('https://meet.google.com/abc-defg-hij');

    const detail = await lead.get(`/meetings/${meetingId}`).expect(200);
    expect(detail.body.status).toBe('LIVE');
    expect(detail.body.sessions).toHaveLength(1);
    expect(detail.body.sessions[0].source).toBe('SELF');
  });

  it('derives attendance from recorded times when the meeting ends', async () => {
    // Replace the live session with a known window: 7:04 PM – 7:57 PM of a 7–8 PM meeting.
    await prisma.participantSession.deleteMany({ where: { meetingId } });
    await lead
      .post(`/meetings/${meetingId}/sessions`)
      .send({ userId: memberId, joinedAt: iso(19, 4), leftAt: iso(19, 57) })
      .expect(201);

    const ended = await lead.post(`/meetings/${meetingId}/end`).expect(201);
    expect(ended.body.status).toBe('ENDED');

    // Pin the real run window to the scheduled 7–8 PM slot, then let the manual
    // session above be recomputed against it.
    await prisma.meeting.update({ where: { id: meetingId }, data: { startedAt: new Date(iso(19)), endedAt: new Date(iso(20)) } });
    await lead.post(`/meetings/${meetingId}/sessions`).send({ userId: memberId, joinedAt: iso(19, 4), leftAt: iso(19, 57) }).expect(201);
    await prisma.participantSession.deleteMany({ where: { meetingId, joinedAt: { lt: new Date(iso(19)) } } });
    const after = await lead.get(`/meetings/${meetingId}`).expect(200);

    const attendee = after.body.participants.find((p: { user: { id: string } }) => p.user.id === memberId);
    expect(attendee.minutes).toBe(53);
    expect(attendee.status).toBe('PRESENT');

    // The host never joined
    const host = after.body.participants.find((p: { user: { id: string } }) => p.user.id !== memberId);
    expect(host.status).toBe('ABSENT');
  });

  it('a lead can override a derived status, and the override survives recalculation', async () => {
    const res = await lead
      .patch(`/meetings/${meetingId}/attendance/${memberId}`)
      .send({ status: 'EXCUSED', note: 'Was at the venue' })
      .expect(200);
    expect(res.body.status).toBe('EXCUSED');
    expect(res.body.statusManual).toBe(true);

    await lead.post(`/meetings/${meetingId}/sessions`).send({ userId: memberId, joinedAt: iso(19, 58), leftAt: iso(20, 0) }).expect(201);
    const detail = await lead.get(`/meetings/${meetingId}`).expect(200);
    const attendee = detail.body.participants.find((p: { user: { id: string } }) => p.user.id === memberId);
    expect(attendee.status).toBe('EXCUSED');
    expect(attendee.minutes).toBe(55);
  });

  it('a member cannot mark attendance for anyone', async () => {
    await member.patch(`/meetings/${meetingId}/attendance/${memberId}`).send({ status: 'PRESENT' }).expect(403);
    await member.post(`/meetings/${meetingId}/sessions`).send({ joinedAt: iso(19, 0) }).expect(403);
  });

  it('records decisions and turns an action item into a real task', async () => {
    await lead.post(`/meetings/${meetingId}/decisions`).send({ text: 'Backdrop goes with the navy palette' }).expect(201);

    const action = await lead
      .post(`/meetings/${meetingId}/actions`)
      .send({ text: `Order backdrop print ${suffix}`, ownerId: memberId, dueDate: iso(23), createTask: true })
      .expect(201);
    expect(action.body.task).not.toBeNull();

    const task = await member.get(`/tasks/${action.body.task.id}`).expect(200);
    expect(task.body.assignedTo.id).toBe(memberId);
    expect(task.body.teamId).toBe(teamId);
    expect(task.body.status).toBe('ASSIGNED');

    const mine = await member.get('/tasks').query({ scope: 'mine' }).expect(200);
    expect(mine.body.map((t: { id: string }) => t.id)).toContain(action.body.task.id);
  });

  it('attendance stats summarise the person and the team', async () => {
    const mine = await member.get('/attendance/stats').expect(200);
    expect(mine.body.meetings).toBe(1);
    expect(mine.body.minutes).toBe(55);

    const team = await lead.get('/attendance/stats').query({ teamId }).expect(200);
    expect(team.body.meetings).toBeGreaterThanOrEqual(1);

    // A member may not read another person's attendance
    await member.get('/attendance/stats').query({ userId: 'ac0ffee0-0000-4000-8000-000000000000' }).expect(403);
  });

  it('attendance thresholds come from the module configuration', async () => {
    const policy = await lead.get('/attendance/policy').expect(200);
    expect(policy.body).toMatchObject({ lateAfterMinutes: expect.any(Number), partialBelowPercent: expect.any(Number) });
  });

  it('writes the meeting lifecycle to the audit log', async () => {
    const rows = await prisma.auditLog.findMany({ where: { entityType: 'meeting', entityId: meetingId }, select: { action: true } });
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('meeting.created');
    expect(actions).toContain('meeting.ended');
    expect(actions).toContain('attendance.overridden');
    expect(actions).toContain('meeting.decision_recorded');
    expect(actions).toContain('meeting.action_item_added');
  });
});
