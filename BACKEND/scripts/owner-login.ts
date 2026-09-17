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

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Print the question, then swallow what is typed instead of echoing it.
      process.stdout.write(question);
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => undefined;
      rl.question('', (answer) => {
        rl.close();
        process.stdout.write('\n');
        resolve(answer);
      });
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
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
  console.log('Your gateway code and authenticator app for the Master console are unchanged.\n');
}

main()
  .catch((err) => {
    console.error(`\nNot changed: ${(err as Error).message}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
