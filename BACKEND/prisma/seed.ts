/**
 * Seeds the TEAM OS foundation. Safe to re-run: existing records (and any edits
 * Master Admin made to them) are left untouched; only missing records are created.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { DEFAULT_GATEWAY_SETTINGS, GATEWAY_SETTINGS_KEY } from '../src/modules/master-admin/gateway-settings.service.js';
import { BUILT_MODULES, DEPARTMENTS, MODULES, ROLES, TEAMS } from '../src/modules/permissions/catalog.js';

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('DIRECT_URL or DATABASE_URL must be set');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }, { schema: process.env.DATABASE_SCHEMA ?? 'app' }),
});

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function main() {
  // 1. Module registry + permission catalog
  for (const m of MODULES) {
    await prisma.module.upsert({
      where: { key: m.key },
      create: {
        key: m.key,
        name: m.name,
        description: m.description,
        phase: m.phase,
        isCore: m.isCore ?? false,
        status: BUILT_MODULES.includes(m.key) ? 'ENABLED' : 'PLANNED',
      },
      // Newly built modules move PLANNED -> ENABLED; anything Master Admin disabled stays disabled.
      update: {
        name: m.name,
        description: m.description,
        phase: m.phase,
        isCore: m.isCore ?? false,
        ...(BUILT_MODULES.includes(m.key) ? { status: 'ENABLED' as const } : {}),
      },
    });
    for (const [key, description] of Object.entries(m.permissions)) {
      await prisma.permission.upsert({
        where: { key },
        create: { key, moduleKey: m.key, description },
        update: { moduleKey: m.key, description },
      });
    }
  }
  console.log(`✓ ${MODULES.length} modules, ${MODULES.reduce((n, m) => n + Object.keys(m.permissions).length, 0)} permissions`);

  // 2. Organization
  const orgName = process.env.SEED_ORGANIZATION_NAME || 'TEAM OS';
  const org = await prisma.organization.upsert({
    where: { slug: slugify(orgName) },
    create: { name: orgName, slug: slugify(orgName) },
    update: {},
  });

  if ((await prisma.automationRule.count({ where: { organizationId: org.id } })) === 0) {
    await prisma.automationRule.createMany({
      data: [
        { organizationId: org.id, name: 'Overdue tasks', trigger: 'TASK_OVERDUE', config: { days: 2 }, enabled: true },
        { organizationId: org.id, name: 'Budget warning', trigger: 'BUDGET_THRESHOLD', config: { percent: 80 }, enabled: true },
        { organizationId: org.id, name: 'Weekly report', trigger: 'WEEKLY_REPORT', config: {}, enabled: true },
        { organizationId: org.id, name: 'Tickets left open', trigger: 'TICKET_STALE', config: { hours: 48 }, enabled: false },
        { organizationId: org.id, name: 'Two approvers for large expenses', trigger: 'EXPENSE_TWO_APPROVERS', config: { minAmount: 10000 }, enabled: false },
      ],
    });
    console.log('✓ Default automation rules');
  }
  console.log(`✓ Organization "${org.name}"`);

  // 3. Departments
  const departments = new Map<string, string>();
  for (const d of DEPARTMENTS) {
    const row = await prisma.department.upsert({
      where: { organizationId_name: { organizationId: org.id, name: d.name } },
      create: { organizationId: org.id, ...d },
      update: {},
    });
    departments.set(d.name, row.id);
  }
  console.log(`✓ ${departments.size} departments`);

  // 4. Roles (created with default permissions only the first time)
  const roles = new Map<string, string>();
  for (const r of ROLES) {
    const existing = await prisma.role.findUnique({ where: { organizationId_key: { organizationId: org.id, key: r.key } } });
    const row =
      existing ??
      (await prisma.role.create({
        data: {
          organizationId: org.id,
          key: r.key,
          name: r.name,
          description: r.description,
          departmentId: departments.get(r.department),
          isSystem: true,
          isMasterAdmin: r.isMasterAdmin ?? false,
          permissions: { create: [...new Set(r.permissions)].map((permissionKey) => ({ permissionKey })) },
        },
      }));
    roles.set(r.key, row.id);
  }
  for (const r of ROLES) {
    if (!r.reportsTo) continue;
    await prisma.role.updateMany({
      where: { id: roles.get(r.key), reportsToRoleId: null },
      data: { reportsToRoleId: roles.get(r.reportsTo) },
    });
  }
  console.log(`✓ ${roles.size} roles`);

  // 5. Teams
  for (const t of TEAMS) {
    await prisma.team.upsert({
      where: { organizationId_name: { organizationId: org.id, name: t.name } },
      create: { organizationId: org.id, name: t.name, departmentId: departments.get(t.department) },
      update: {},
    });
  }
  console.log(`✓ ${TEAMS.length} teams`);

  // 6. First Master Admin
  const email = process.env.SEED_MASTER_ADMIN_EMAIL?.trim().toLowerCase();
  if (email) {
    const user = await prisma.user.upsert({
      where: { email },
      create: {
        email,
        name: process.env.SEED_MASTER_ADMIN_NAME || 'Master Admin',
        organizationId: org.id,
        departmentId: departments.get('Administration'),
      },
      update: {},
    });
    // Master Admin (control plane) + Administrator (so the normal user plane works outside a privileged session)
    for (const key of ['master_admin', 'administrator']) {
      const roleId = roles.get(key)!;
      const has = await prisma.userRole.findFirst({ where: { userId: user.id, roleId, scopeType: 'ORGANIZATION' } });
      if (!has) await prisma.userRole.create({ data: { userId: user.id, roleId, scopeType: 'ORGANIZATION' } });
    }
    console.log(`✓ Master Admin ${email} (set the password with: npm run owner-login)`);
  } else {
    console.warn('! SEED_MASTER_ADMIN_EMAIL not set — no Master Admin created');
  }

  // 7. Hidden gateway code
  const setting = await prisma.systemSetting.findUnique({ where: { key: GATEWAY_SETTINGS_KEY } });
  const current = { ...DEFAULT_GATEWAY_SETTINGS, ...(setting?.value as object | undefined) };
  const code = process.env.SEED_GATEWAY_CODE;
  if (!current.codeHash && code) {
    if (code.length < 8) throw new Error('SEED_GATEWAY_CODE must be at least 8 characters');
    await prisma.systemSetting.upsert({
      where: { key: GATEWAY_SETTINGS_KEY },
      create: { key: GATEWAY_SETTINGS_KEY, value: { ...current, codeHash: await argon2.hash(code) } },
      update: { value: { ...current, codeHash: await argon2.hash(code) } },
    });
    console.log('✓ Master Admin gateway code configured');
  } else if (!current.codeHash) {
    console.warn('! SEED_GATEWAY_CODE not set — the Master Admin gateway will refuse codes until one is configured');
  }

  await prisma.auditLog.create({
    data: { organizationId: org.id, action: 'system.seeded', entityType: 'system', newValue: { modules: MODULES.length, roles: ROLES.length } },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
