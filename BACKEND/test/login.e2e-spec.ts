/**
 * Email + password sign-in managed by Master Admin, file storage without Google,
 * and Excel/CSV report downloads. Same requirements as app.e2e-spec.ts — disposable database.
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

describe.skipIf(!run)('TEAM OS password sign-in, storage and exports (e2e)', () => {
  let app: INestApplication;
  let master: ReturnType<typeof request.agent>;
  const suffix = Date.now().toString(36);
  const email = `pw-${suffix}@teamos.test`;
  let personId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    master = request.agent(app.getHttpServer());
    await master.post('/auth/dev-login').send({ email: MASTER_EMAIL }).expect(204);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: MASTER_EMAIL } });
    await prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { privilegedUntil: new Date(Date.now() + 3_600_000) } });
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('first-time Master setup: needs the gateway code, signs in, and works only once', async () => {
    const guest = request.agent(app.getHttpServer());
    expect((await guest.get('/auth/providers').expect(200)).body.firstSetup).toBe(true);
    await guest.post('/auth/first-setup').send({ email: MASTER_EMAIL, gatewayCode: 'wrong-code', password: 'Sunrise2026x' }).expect(401);
    await guest.post('/auth/first-setup').send({ email: MASTER_EMAIL, gatewayCode: process.env.SEED_GATEWAY_CODE, password: 'Sunrise2026x' }).expect(204);
    expect((await guest.get('/auth/me').expect(200)).body.user.email).toBe(MASTER_EMAIL);
    expect((await guest.get('/auth/providers').expect(200)).body.firstSetup).toBe(false);
    await request(app.getHttpServer()).post('/auth/first-setup').send({ email: MASTER_EMAIL, gatewayCode: process.env.SEED_GATEWAY_CODE, password: 'Other2026xy' }).expect(401);
    await request(app.getHttpServer()).post('/auth/login').send({ email: MASTER_EMAIL, password: 'Sunrise2026x' }).expect(204);
  });

  it('only Master Admin adds people with a password, and weak passwords are refused', async () => {
    const role = await prisma.role.findFirstOrThrow({ where: { key: 'creative_member' } });
    await master.post('/master/control/people').send({ name: 'Pass Word', email, password: 'short1' }).expect(400);
    const created = await master.post('/master/control/people').send({ name: 'Pass Word', email, password: 'Starter2026', roleId: role.id }).expect(201);
    personId = created.body.id;
    await master.post('/master/control/people').send({ name: 'Again', email, password: 'Starter2026' }).expect(409);

    const outsider = request.agent(app.getHttpServer());
    await outsider.post('/master/control/people').send({ name: 'X', email: 'x@y.z', password: 'Starter2026' }).expect(401);
  });

  it('signs in with email and password, then must choose a new password before anything else', async () => {
    const person = request.agent(app.getHttpServer());
    await person.post('/auth/login').send({ email, password: 'Wrong2026' }).expect(401);
    await person.post('/auth/login').send({ email: email.toUpperCase(), password: 'Starter2026' }).expect(204);

    const me = await person.get('/auth/me').expect(200);
    expect(me.body.user.mustChangePassword).toBe(true);
    const blocked = await person.get('/tasks').query({ scope: 'mine' }).expect(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

    await person.post('/auth/password').send({ currentPassword: 'Nope1234', newPassword: 'MyOwn2026x' }).expect(401);
    await person.post('/auth/password').send({ currentPassword: 'Starter2026', newPassword: 'weak' }).expect(400);
    await person.post('/auth/password').send({ currentPassword: 'Starter2026', newPassword: 'MyOwn2026x' }).expect(204);
    await person.get('/tasks').query({ scope: 'mine' }).expect(200);

    // The old password no longer works; the new one does.
    await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'Starter2026' }).expect(401);
    await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'MyOwn2026x' }).expect(204);
  });

  it('Master Admin can reset a forgotten password, which signs the person out everywhere', async () => {
    const person = request.agent(app.getHttpServer());
    await person.post('/auth/login').send({ email, password: 'MyOwn2026x' }).expect(204);
    await person.get('/auth/me').expect(200);

    await master.post(`/master/control/people/${personId}/password`).send({ password: 'Reset2026ab', mustChangePassword: false }).expect(201);
    await person.get('/auth/me').expect(401);
    await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'Reset2026ab' }).expect(204);
  });

  it('a disabled person cannot sign in, and repeated wrong passwords are paused', async () => {
    await master.post(`/users/${personId}/disable`).expect(201);
    const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'Reset2026ab' }).expect(401);
    expect(res.body.code).toBe('disabled');
    await master.post(`/users/${personId}/enable`).expect(201);

    const unknown = `nobody-${suffix}@teamos.test`;
    for (let i = 0; i < 5; i++) await request(app.getHttpServer()).post('/auth/login').send({ email: unknown, password: 'Guess2026' }).expect(401);
    await request(app.getHttpServer()).post('/auth/login').send({ email: unknown, password: 'Guess2026' }).expect(429);
  });

  it('bulk import hands back generated passwords that work', async () => {
    const csv = `email,name,department,role,password\nbulk-${suffix}@teamos.test,Bulk Person,,,\nweak-${suffix}@teamos.test,Weak Person,,,abc`;
    const result = await master.post('/master/control/people/bulk-invite').send({ csv, dryRun: false }).expect(201);
    expect(result.body.created).toBe(1);
    expect(result.body.problems).toHaveLength(1);
    const cred = result.body.credentials[0];
    expect(cred.email).toBe(`bulk-${suffix}@teamos.test`);
    await request(app.getHttpServer()).post('/auth/login').send({ email: cred.email, password: cred.password }).expect(204);
  });

  it('stores uploaded files without Google and streams them back', async () => {
    const task = await master.post('/tasks').send({ title: `File task ${suffix}` }).expect(201);
    const upload = await master
      .post('/files')
      .field('entityType', 'task')
      .field('entityId', task.body.id)
      .attach('file', Buffer.from('hello from TEAM OS'), { filename: 'note.txt', contentType: 'text/plain' })
      .expect(201);
    const record = await prisma.fileRecord.findUniqueOrThrow({ where: { id: upload.body.id } });
    expect(record.storageProvider).toBe('database');
    const download = await master.get(`/files/${upload.body.id}/download`).expect(200);
    expect(download.text ?? download.body.toString()).toContain('hello from TEAM OS');
  });

  it('downloads reports as Excel and CSV, and keeps saved copies', async () => {
    const xlsx = await master.get('/reports/export').query({ kind: 'weekly', format: 'xlsx' }).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');

    const csv = await master.get('/reports/export').query({ kind: 'people', format: 'csv' }).expect(200);
    expect(csv.headers['content-disposition']).toContain('.csv');

    const saved = await master.post('/reports/saved').send({ kind: 'weekly' }).expect(201);
    const list = await master.get('/reports/saved').expect(200);
    expect(list.body.some((r: { id: string }) => r.id === saved.body.id)).toBe(true);
    await master.get(`/reports/saved/${saved.body.id}/download`).query({ format: 'csv' }).expect(200);
  });

  it('backups are saved inside TEAM OS and can be downloaded', async () => {
    const entry = await master.post('/master/control/backups/run').expect(201);
    expect(entry.body.key).toBeTruthy();
    const file = await master.get('/master/control/backups/download').query({ key: entry.body.key }).expect(200);
    expect(JSON.stringify(file.body)).toContain('TEAM OS');
    await master.get('/master/control/backups/download').query({ key: 'backups/not-real.json' }).expect(404);
  });
});
