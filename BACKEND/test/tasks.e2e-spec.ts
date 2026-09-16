/**
 * Phase 2 end-to-end: task assignment, daily work updates, lead review, rollup.
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

describe.skipIf(!run)('TEAM OS work management (e2e)', () => {
  let app: INestApplication;
  let lead: ReturnType<typeof request.agent>;
  let member: ReturnType<typeof request.agent>;
  const suffix = Date.now().toString(36);
  let teamId: string;
  let memberId: string;
  let taskId: string;
  let updateId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    lead = request.agent(app.getHttpServer());
    member = request.agent(app.getHttpServer());
    await lead.post('/auth/dev-login').send({ email: MASTER_EMAIL }).expect(204);

    // A team, a member on it, and that member holding a plain member role.
    const team = await lead.post('/teams').send({ name: `Work Team ${suffix}` }).expect(201);
    teamId = team.body.id;
    const invited = await lead.post('/users').send({ email: `worker-${suffix}@teamos.test`, name: 'Work Member' }).expect(201);
    memberId = invited.body.id;
    await lead.put(`/teams/${teamId}/members/${memberId}`).send({ memberRole: 'MEMBER' }).expect(200);

    // Role assignment lives in the Master Admin plane; for this suite we set it
    // up directly so the test focuses on work management.
    const memberRole = await prisma.role.findFirstOrThrow({ where: { key: 'creative_member' } });
    await prisma.userRole.create({ data: { userId: memberId, roleId: memberRole.id, scopeType: 'ORGANIZATION' } });
    await member.post('/auth/dev-login').send({ email: `worker-${suffix}@teamos.test` }).expect(204);
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('a lead creates and assigns a task', async () => {
    const res = await lead
      .post('/tasks')
      .send({ title: `Stage backdrop ${suffix}`, teamId, assignedToId: memberId, priority: 'HIGH', dueDate: '2026-12-01' })
      .expect(201);
    taskId = res.body.id;
    expect(res.body.status).toBe('ASSIGNED');
    expect(res.body.assignedTo.id).toBe(memberId);
  });

  it('a member cannot create tasks for others but sees their own', async () => {
    await member.post('/tasks').send({ title: 'Nope', teamId, assignedToId: memberId }).expect(403);
    const mine = await member.get('/tasks').query({ scope: 'mine' }).expect(200);
    expect(mine.body.map((t: { id: string }) => t.id)).toContain(taskId);
  });

  it('daily work update moves progress and keeps history', async () => {
    await member.post(`/tasks/${taskId}/updates`).send({ percentage: 40, summary: 'Sketches done' }).expect(201);
    const blocked = await member
      .post(`/tasks/${taskId}/updates`)
      .send({ percentage: 60, summary: 'Printing quote pending', blockers: 'Waiting on vendor price' })
      .expect(201);
    expect(blocked.body.status).toBe('BLOCKED');

    const detail = await member.get(`/tasks/${taskId}`).expect(200);
    expect(detail.body.percentage).toBe(60);
    expect(detail.body.status).toBe('BLOCKED');
    expect(detail.body.updates).toHaveLength(2);
    expect(detail.body.capabilities.canReview).toBe(false);
  });

  it('100% sends the task to review; the member cannot review it themselves', async () => {
    const done = await member.post(`/tasks/${taskId}/updates`).send({ percentage: 100, summary: 'Backdrop delivered' }).expect(201);
    updateId = done.body.id;
    expect(done.body.status).toBe('IN_REVIEW');
    await member.post(`/tasks/${taskId}/updates/${updateId}/review`).send({ decision: 'ACCEPT' }).expect(403);
  });

  it('the lead sends it back, then accepts it', async () => {
    await lead
      .post(`/tasks/${taskId}/updates/${updateId}/review`)
      .send({ decision: 'CHANGES_REQUESTED', note: 'Fix the logo size' })
      .expect(201);
    let detail = await lead.get(`/tasks/${taskId}`).expect(200);
    expect(detail.body.status).toBe('IN_PROGRESS');

    const redo = await member.post(`/tasks/${taskId}/updates`).send({ percentage: 100, summary: 'Logo resized' }).expect(201);
    await lead.post(`/tasks/${taskId}/updates/${redo.body.id}/review`).send({ decision: 'ACCEPT' }).expect(201);

    detail = await lead.get(`/tasks/${taskId}`).expect(200);
    expect(detail.body.status).toBe('COMPLETED');
    expect(detail.body.completedAt).not.toBeNull();
    expect(detail.body.updates[0].reviewedAt).not.toBeNull();
  });

  it('progress rolls up to the team', async () => {
    const stats = await lead.get('/tasks/stats').query({ teamId }).expect(200);
    expect(stats.body.total).toBe(1);
    expect(stats.body.completed).toBe(1);
    expect(stats.body.progress).toBe(100);
    expect(stats.body.completionRate).toBe(100);

    const mine = await member.get('/tasks/stats/mine').expect(200);
    expect(mine.body.completed).toBe(1);
  });

  it('records work updates and reviews in the audit log', async () => {
    const rows = await prisma.auditLog.findMany({ where: { entityType: 'task', entityId: taskId }, select: { action: true } });
    const actions = rows.map((a) => a.action);
    expect(actions).toContain('work_update.submitted');
    expect(actions).toContain('work_update.accepted');
    expect(actions).toContain('work_update.changes_requested');
    expect(actions).toContain('task.created');
  });

});
