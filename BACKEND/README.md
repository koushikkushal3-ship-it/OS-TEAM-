# TEAM OS — Backend

NestJS 12 + Prisma 7 API for TEAM OS, the organization's work portal.
Postgres is hosted on **Supabase** (used only as a database — tables live in the `app` schema).

## Setup

```bash
npm install                 # also runs prisma generate
cp .env.example .env        # then fill it in (see below)
npm run db:deploy           # create tables in Supabase
npm run db:seed             # modules, permissions, org structure, first Master Admin
npm run start:dev           # http://localhost:4000
```

### What goes in `.env`

| Variable | Where to get it |
|---|---|
| `DATABASE_URL` | Supabase → Connect → Transaction pooler (port 6543). Add `&schema=app`. |
| `DIRECT_URL` | Supabase → Connect → Session pooler (port 5432). Add `?schema=app`. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud Console → Credentials → OAuth client (Web). Redirect URI `http://localhost:3000/api/auth/google/callback` (the frontend proxies `/api/*` to this API). |
| `MFA_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `SEED_MASTER_ADMIN_EMAIL` | The Google account of the first Master Admin. |
| `SEED_GATEWAY_CODE` | Secondary code for the hidden Master Admin gateway (8+ chars). |

Only people whose email is already in TEAM OS can sign in — Master Admin (or anyone with `user.create`) invites them.

## Structure

```
src/
├── common/            AccessGuard (auth → master plane → permission), decorators, zod pipe, error filter
├── config/env.ts      validated environment
├── prisma/            PrismaService (Supabase via @prisma/adapter-pg)
└── modules/
    ├── auth/              Google OAuth, sessions, /auth/me          ─┐
    ├── permissions/       PermissionService + pure engine + catalog  │
    ├── roles/             custom role engine                         │
    ├── master-admin/      hidden gateway, security, overview         │ Phase 1
    ├── organization/  departments/  users/  teams/  events/          │
    ├── modules-registry/  audit/  dashboard/                        ─┘
    ├── tasks/             Phase 2 — tasks, work updates, review, rollup
    ├── meetings/          Phase 3 — meeting engine + /attendance (attendance.ts is pure, unit-tested)
    └── finance/ documents/
        ideas/ opportunities/ tickets/ notifications/ reports/
        search/ integrations/                      planned (GET /<module>/status)
```

## Authorization model

- Every route passes `AccessGuard`: session cookie → `AuthContext` → `@MasterOnly()` check → `@RequirePermission()` check.
- `PermissionService.can(auth, 'team.update', { teamId })` is the single decision point. Rules
  (`src/modules/permissions/permission-engine.ts`):
  1. Permission's module must be `ENABLED`.
  2. Privileged Master Admin session → allow.
  3. A role grants it — team/event/department-scoped roles only inside their scope.
  4. Overrides cascade `GLOBAL → ORGANIZATION → DEPARTMENT → TEAM → EVENT → ROLE → USER`; the most specific level wins, DENY beats ALLOW within a level. Keys can be exact (`finance.approve`) or wildcards (`finance.*`).
- **Master Admin plane** (`/master/*`): users without the Master Admin role get `404`. Eligible users must pass
  secondary code → TOTP MFA to get a privileged session (default 30 min). Holding the role alone grants nothing extra.

## API (Phase 1)

| Area | Routes |
|---|---|
| Auth | `GET /auth/providers`, `GET /auth/google`, `GET /auth/google/callback`, `GET /auth/me`, `POST /auth/logout`, `POST /auth/dev-login` (dev only) |
| User plane | `GET /dashboard/summary`, `/organization`, `/departments`, `/users`, `/teams` (+ `/:id/members/:userId`), `/events` (+ `/:id/teams`, `/:id/members/:userId`) |
| Work (Phase 2) | `/tasks` (list, create, update, delete), `/tasks/:id`, `POST /tasks/:id/updates`, `POST /tasks/:id/updates/:updateId/review`, `/tasks/stats`, `/tasks/stats/mine` |
| Meetings (Phase 3) | `/meetings` (+ `/:id/start`, `/end`, `/join`, `/leave`, `/participants`, `/sessions`, `/attendance/:userId`, `/decisions`, `/actions`), `/attendance/stats`, `/attendance/policy` |
| Gateway | `GET /master/gateway`, `POST /master/gateway/code`, `POST /master/gateway/mfa/setup`, `POST /master/gateway/mfa/verify`, `POST /master/gateway/exit` |
| Master | `/master/overview`, `/master/organization`, `/master/users/:id/roles`, `/master/roles`, `/master/permissions` (+ `/overrides`, `/presets`, `/explain`), `/master/modules`, `/master/security`, `/master/audit` |

## Testing

```bash
npm test                    # unit tests (permission engine)
npm run test:e2e            # Phase 1 + Phase 2 flows — needs a disposable, freshly seeded database
```

Video (Phase 3): the meeting carries a **pasted link** — you create the Google Meet yourself and paste it in.
Clicking **Join** in TEAM OS records the attendance session and opens the link in a new tab; everything around the
call (participants, attendance, notes, decisions, action items) stays in the portal. Google Meet cannot be embedded
in another site, and its REST API needs Google Workspace.

Attendance rules (Phase 3): join/leave sessions are merged (rejoins never double count), then compared with the
meeting window. Thresholds — late after N minutes, partial below X%, absent below Y% — live in the attendance
module's config and are editable by Master Admin. A manual status set by a lead survives later recalculation.

Work rules (Phase 2): a work update at 100% moves the task to IN_REVIEW; filling in blockers marks it BLOCKED;
a lead accepting a 100% update completes the task, and requesting changes sends it back to IN_PROGRESS.

The e2e suite runs only when `DATABASE_URL`, `SEED_MASTER_ADMIN_EMAIL`, `SEED_GATEWAY_CODE`, `MFA_ENCRYPTION_KEY` and
`AUTH_DEV_LOGIN=true` are set. **Do not point it at your real Supabase database** — it creates test records and enrols MFA.
A local throwaway database works well: `npx prisma dev -n teamos-test -d`.
