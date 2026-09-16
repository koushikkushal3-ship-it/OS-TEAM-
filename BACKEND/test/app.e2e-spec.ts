/**
 * Phase 1 end-to-end flow against a real, seeded database.
 * Requires DATABASE_URL, AUTH_DEV_LOGIN=true, MFA_ENCRYPTION_KEY, and the seed's
 * SEED_MASTER_ADMIN_EMAIL + SEED_GATEWAY_CODE. See README "Testing".
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { generate } from 'otplib';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

const MASTER_EMAIL = process.env.SEED_MASTER_ADMIN_EMAIL ?? '';
const GATEWAY_CODE = process.env.SEED_GATEWAY_CODE ?? '';
const run = Boolean(process.env.DATABASE_URL && MASTER_EMAIL && GATEWAY_CODE && process.env.AUTH_DEV_LOGIN === 'true');

describe.skipIf(!run)('TEAM OS Phase 1 (e2e)', () => {
  let app: INestApplication;
  let master: ReturnType<typeof request.agent>;
  let member: ReturnType<typeof request.agent>;
  const suffix = Date.now().toString(36);
  const memberEmail = `member-${suffix}@teamos.test`;
  let memberId: string;
  let creativeTeamId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    master = request.agent(app.getHttpServer());
    member = request.agent(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rejects unauthenticated requests and uninvited sign-ins', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
    await request(app.getHttpServer()).post('/auth/dev-login').send({ email: 'nobody@teamos.test' }).expect(404);
  });

  it('signs in the seeded Master Admin without exposing privileged access', async () => {
    await master.post('/auth/dev-login').send({ email: MASTER_EMAIL }).expect(204);
    const me = await master.get('/auth/me').expect(200);
    expect(me.body.master).toEqual({ privileged: false, privilegedUntil: null });
    expect(me.body.roles.map((r: { key: string }) => r.key)).not.toContain('master_admin');
    // Control plane is locked until the gateway is passed
    await master.get('/master/overview').expect(403);
  });

  it('passes the hidden gateway: secondary code → TOTP enrolment → privileged session', async () => {
    await master.post('/master/gateway/code').send({ code: 'wrong-code' }).expect(403);
    await master.post('/master/gateway/mfa/setup').expect(403);
    await master.post('/master/gateway/code').send({ code: GATEWAY_CODE }).expect(200);

    const status = await master.get('/master/gateway').expect(200);
    let secret: string;
    if (!status.body.mfaEnrolled) {
      const setup = await master.post('/master/gateway/mfa/setup').expect(200);
      expect(setup.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
      secret = setup.body.secret;
    } else {
      throw new Error('Master Admin already enrolled; reset MFA or use a fresh database for this test');
    }
    await master.post('/master/gateway/mfa/verify').send({ token: '000000' }).expect(403);
    await master.post('/master/gateway/mfa/verify').send({ token: await generate({ secret }) }).expect(200);

    const overview = await master.get('/master/overview').expect(200);
    expect(overview.body.totals.roles).toBeGreaterThan(10);
  });

  it('creates a custom role without code changes (Sponsorship Lead)', async () => {
    const role = await master
      .post('/master/roles')
      .send({ name: `Sponsorship Lead ${suffix}`, permissionKeys: ['sponsor.view', 'sponsor.manage', 'meeting.create'] })
      .expect(201);
    expect(role.body.permissions).toHaveLength(3);
    await master.post('/master/roles').send({ name: 'Bad', permissionKeys: ['not.real'] }).expect(400);
  });

  it('invites a member, who can sign in but cannot create teams or see the control plane', async () => {
    const invited = await master.post('/users').send({ email: memberEmail, name: 'Test Member' }).expect(201);
    memberId = invited.body.id;
    expect(invited.body.status).toBe('INVITED');

    const roles = await master.get('/master/roles').expect(200);
    const memberRole = roles.body.find((r: { key: string }) => r.key === 'creative_member');
    await master.post(`/master/users/${memberId}/roles`).send({ roleId: memberRole.id }).expect(201);

    await member.post('/auth/dev-login').send({ email: memberEmail }).expect(204);
    const me = await member.get('/auth/me').expect(200);
    expect(me.body.master).toBeUndefined();
    expect(me.body.permissions).toContain('team.view');
    expect(me.body.permissions).not.toContain('team.create');

    await member.post('/teams').send({ name: `Nope ${suffix}` }).expect(403);
    await member.get('/master/overview').expect(404);
    await member.get('/master/gateway').expect(404);
  });

  it('creates a team and an event with teams, and scopes a lead role to one team', async () => {
    const teams = await master.get('/teams').expect(200);
    creativeTeamId = teams.body.find((t: { name: string }) => t.name === 'Creative Team').id;
    const techTeamId = teams.body.find((t: { name: string }) => t.name === 'Technical Team').id;

    const team = await master.post('/teams').send({ name: `Logistics ${suffix}`, leadUserId: memberId }).expect(201);
    const event = await master
      .post('/events')
      .send({ name: `India Summit ${suffix}`, startDate: '2026-12-01', endDate: '2026-12-03', teamIds: [creativeTeamId, team.body.id] })
      .expect(201);

    // Make the member Creative Lead — scoped to the Creative Team only
    const roles = await master.get('/master/roles').expect(200);
    const creativeLead = roles.body.find((r: { key: string }) => r.key === 'creative_lead');
    await master
      .post(`/master/users/${memberId}/roles`)
      .send({ roleId: creativeLead.id, scopeType: 'TEAM', scopeId: creativeTeamId })
      .expect(201);

    await member.patch(`/teams/${creativeTeamId}`).send({ description: 'Design & creative' }).expect(200);
    await member.patch(`/teams/${techTeamId}`).send({ description: 'Hijack' }).expect(403);

    const detail = await member.get(`/events/${event.body.id}`).expect(200);
    expect(detail.body.teams).toHaveLength(2);
    expect(detail.body.budget).toBeNull();
  });

  it('changes Creative Lead finance access and records old/new values in the audit log', async () => {
    const roles = await master.get('/master/roles').expect(200);
    const creativeLead = roles.body.find((r: { key: string }) => r.key === 'creative_lead');

    await master.patch('/master/modules/finance').send({ status: 'ENABLED' }).expect(200);
    await master
      .post('/master/permissions/presets')
      .send({ scopeType: 'ROLE', scopeId: creativeLead.id, moduleKey: 'finance', preset: 'VIEW_ONLY' })
      .expect(201);

    const explainView = await master.get('/master/permissions/explain').query({ userId: memberId, action: 'finance.view' }).expect(200);
    const explainApprove = await master.get('/master/permissions/explain').query({ userId: memberId, action: 'finance.approve' }).expect(200);
    expect(explainView.body.allowed).toBe(true);
    expect(explainApprove.body.allowed).toBe(false);

    const audit = await master.get('/master/audit').query({ action: 'permission.access_changed' }).expect(200);
    const entry = audit.body.items[0];
    expect(entry.oldValue.access).toBe('DEFAULT');
    expect(entry.newValue.access).toBe('VIEW_ONLY');
    expect(entry.privileged).toBe(true);

    // restore
    await master
      .post('/master/permissions/presets')
      .send({ scopeType: 'ROLE', scopeId: creativeLead.id, moduleKey: 'finance', preset: 'DEFAULT' })
      .expect(201);
    await master.patch('/master/modules/finance').send({ status: 'DISABLED' }).expect(200);
    await master.patch('/master/modules/teams').send({ status: 'DISABLED' }).expect(400);
  });

  it('disabling a person revokes their sessions', async () => {
    await master.post(`/users/${memberId}/disable`).expect(201);
    await member.get('/auth/me').expect(401);
  });

  it('exits the privileged session', async () => {
    await master.post('/master/gateway/exit').expect(204);
    await master.get('/master/overview').expect(403);
  });
});
