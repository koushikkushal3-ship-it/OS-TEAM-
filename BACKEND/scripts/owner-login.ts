/**
 * Sets the Master Admin's sign-in email and password from this computer's terminal.
 * The password is typed here (hidden) and never shown, logged or sent anywhere except as a hash.
 *
 *   npm run owner-login
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import { createInterface } from 'node:readline';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { passwordProblem } from '../src/modules/auth/password.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }, { schema: process.env.DATABASE_SCHEMA ?? 'app' }),
});

// One line reader for the whole run, so typed or pasted answers are never lost between questions.
const reader = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
const pending: string[] = [];
const waiting: ((line: string) => void)[] = [];
reader.on('line', (line) => {
  const next = waiting.shift();
  if (next) next(line);
  else pending.push(line);
});
const nextLine = () => new Promise<string>((resolve) => (pending.length ? resolve(pending.shift()!) : waiting.push(resolve)));

async function ask(question: string, hidden = false): Promise<string> {
  process.stdout.write(question);
  if (!hidden || !process.stdin.isTTY) {
    const answer = await nextLine();
    if (hidden) process.stdout.write('\n');
    return hidden ? answer : answer.trim();
  }
  // Read key by key without echoing, so the password never appears on screen (works in PowerShell and cmd).
  reader.pause();
  return new Promise((resolve) => {
    const stdin = process.stdin;
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          reader.resume();
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          process.stdout.write('\nCancelled.\n');
          process.exit(1);
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const masters = await prisma.user.findMany({
    where: { roles: { some: { role: { isMasterAdmin: true } } } },
    select: { id: true, email: true, name: true, status: true },
  });
  if (masters.length === 0) throw new Error('No Master Admin found in this database.');
  console.log('\nMaster Admins in this database:');
  masters.forEach((m, i) => console.log(`  ${i + 1}. ${m.name} <${m.email}> (${m.status.toLowerCase()})`));

  const pick = masters.length === 1 ? masters[0] : masters[Number(await ask('Which one? Type the number: ')) - 1];
  if (!pick) throw new Error('No such number.');

  const newEmail = (await ask(`Sign-in email [press Enter to keep ${pick.email}]: `)).toLowerCase() || pick.email;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) throw new Error('That is not an email address.');
  if (newEmail !== pick.email && (await prisma.user.findUnique({ where: { email: newEmail } }))) {
    throw new Error(`${newEmail} already belongs to someone else in TEAM OS.`);
  }

  const password = await ask('New password (hidden while you type): ', true);
  const problem = passwordProblem(password, newEmail);
  if (problem) throw new Error(problem);
  if ((await ask('Type it again: ', true)) !== password) throw new Error('The two passwords do not match.');

  await prisma.user.update({
    where: { id: pick.id },
    data: {
      email: newEmail,
      // The old Google identity no longer applies to this account.
      googleSubject: null,
      status: 'ACTIVE',
      passwordHash: await argon2.hash(password),
      passwordChangedAt: new Date(),
      mustChangePassword: false,
    },
  });
  // Every existing session ends; sign in again with the new details.
  await prisma.session.updateMany({ where: { userId: pick.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await prisma.auditLog.create({
    data: {
      organizationId: (await prisma.user.findUniqueOrThrow({ where: { id: pick.id } })).organizationId,
      actorId: pick.id,
      action: 'user.owner_login_reset',
      entityType: 'user',
      entityId: pick.id,
      oldValue: { email: pick.email },
      newValue: { email: newEmail, via: 'terminal' },
    },
  });
  console.log(`\nDone. Sign in at http://localhost:3000 with ${newEmail} and the password you just typed.`);
  console.log('Then open http://localhost:3000/master: the gateway code is SEED_GATEWAY_CODE in BACKEND/.env; scan the QR code if asked.\n');
}

main()
  .catch((err) => {
    console.error(`\nNot changed: ${(err as Error).message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    reader.close();
    await prisma.$disconnect();
  });
