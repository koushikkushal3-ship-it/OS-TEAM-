# TEAM OS — project state for Claude

Read this first in a new session. It is the handover note; the READMEs hold the user-facing detail.

## What this is

TEAM OS is a **website** (a work portal the user named "OS"). **Not an operating system** — never call it one.
It is the organization's single system of record: people, teams, events, work, meetings, attendance, operations,
knowledge, plus a hidden Master Admin control plane.

Design source (read only if a decision needs it, they are long):
- `C:\Users\mypck\Downloads\TEAM_OS_Master_Plan.pdf` — 22 pages, 6-phase roadmap
- `C:\Users\mypck\Downloads\TEAM OS — Complete Unified System Architecture.md` — 72 sections

Owner: `freefiresaisrk@gmail.com` (Master Admin, name "KUSHAL.OX"; the old Google account `work.on.off.ox@gmail.com` was
disabled by Google on 2026-09-17). Organization "TEAM ON".

## Layout

| Folder | Stack |
|---|---|
| `BACKEND/` | NestJS 12 (ESM, `.js` import suffixes), Prisma 7, Supabase Postgres, vitest, oxlint |
| `FRONTEND/` | Next.js 16 App Router, React 19, Tailwind 4, TanStack Query, eslint |

Runtime versions are newer than training data. Next 16 renamed middleware to **`proxy.ts`**; `params` is a Promise;
read `FRONTEND/node_modules/next/dist/docs/` before changing framework-level things. Prisma 7 uses
`prisma.config.ts`, a driver adapter (`@prisma/adapter-pg`), and generates the client into `BACKEND/src/generated/prisma`.

## Live setup (already working — do not redo)

- Supabase project ref `ydkqjrmvwdyiaqpdytgf`, region ap-south-1 — a **new** project created 2026-09-17 under a
  non-Google Supabase login, freshly migrated and seeded (the old project `jtoaynhjmrencleyedib` was abandoned; its
  connection string was overwritten, so its few rows were not copied). Tables live in the **`app` schema**.
  Connection strings are in `BACKEND/.env` (git-ignored); pooled URL needs `pgbouncer=true&schema=app`.
- **Sign-in is email + password** (rule 19). `AUTH_GOOGLE_ENABLED=false`; no Google services are connected.
- `AUTH_DEV_LOGIN=false` on the live config. Dev email login only exists when that flag is true and NODE_ENV is not production.
- Master Admin gateway: code = `SEED_GATEWAY_CODE` in `BACKEND/.env`; the owner must enrol the authenticator again on the
  new database (first gateway visit shows a QR). Set the owner password with `npm run owner-login` (terminal, hidden).

Run it:

```bash
cd "E:\ADV TEAM WORK PORTEL\BACKEND" && npm run start:dev
```
```bash
cd "E:\ADV TEAM WORK PORTEL\FRONTEND" && npm run dev
```

Site http://localhost:3000, API http://localhost:4000. The site proxies `/api/*` to the API (`next.config.ts`
rewrites), so the session cookie belongs to the site's own origin.

## Phase status

| Phase | Scope | State |
|---|---|---|
| 1 Foundation | auth, hidden Master Admin gateway, org, departments, people, custom roles, permissions + overrides, teams, events, module registry, audit | Built, live |
| 2 Work | tasks, subtasks, assignment, daily work updates, lead review, progress rollup | Built, live |
| 3 Meetings | meeting records with a pasted join link, participants, join/leave sessions, derived attendance, notes, decisions, action items → tasks | Built, live |
| 4 Operations | finance (budgets, expenses, approval, reimbursement), tickets, documents on Google Drive, ideas, opportunities pipeline | Built, live |
| 5 Reporting | organization / team / people / event reports, performance scoring (`reports/performance.ts`, unit-tested), CSV export | Built, live |
| 6 Platform builder | module builder (`custom_modules` + `custom_records`): Master Admin defines fields, workflow states and scope; TEAM OS registers a real module row and four permissions so roles, overrides and the enable switch work unchanged | Built, live |
| 7 Platform features | see "Platform features" below — ~30 features across worker, lead and Master portals (migration `20260917090000_platform_features`) | Built, live |
| 8 Schedule + deploy | organization Schedule mirrored to Google Calendar (migration `20260917150000_schedule`), GitHub CI, Render/Vercel auto-deploy config, `DEPLOY.md` | Built; not yet deployed |

Enabled modules in the live DB: `core, teams, events, administration, tasks, meetings, attendance, finance, documents, ideas, tickets, sponsors, guests, vendors, venues, invitations, notifications, leave, shifts, kudos, schedule` (+ any custom modules).
Everything else is `PLANNED` and its permissions are denied by the engine until enabled.

## Core rules that must not be broken

1. **One permission decision point**: `PermissionService.can(auth, action, { teamId, eventId })`
   (`BACKEND/src/modules/permissions/`). Pure logic in `permission-engine.ts`, unit-tested.
   Order: module must be ENABLED → privileged Master session allows → a role grants it (team/event/department-scoped
   roles only inside their scope) → overrides cascade GLOBAL → ORGANIZATION → DEPARTMENT → TEAM → EVENT → ROLE → USER,
   most specific wins, DENY beats ALLOW at the same level. Keys may be exact (`finance.approve`) or wildcards (`finance.*`).
2. **Every route** passes the global `AccessGuard`: session → `@MasterOnly()` → `@RequirePermission()`.
3. **Master plane** (`/master/*`): users without a Master Admin role get **404**, eligible users need code + TOTP.
   Holding the role alone grants nothing in the user plane.
4. **Audit everything** that changes state, with old and new values: `AuditService.record(actorFrom(req), {...})`.
5. Nothing about roles is hard-coded — `catalog.ts` only seeds defaults; Master Admin edits them at runtime.
6. Attendance thresholds are **policy**, read from the attendance module's `config`, never hard-coded judgement.
7. **Video is a pasted link, not an embed.** The owner creates the Google Meet (or any) link and pastes it into the
   meeting; **Join** records the attendance session and opens the link in a new tab. Decided 2026-09-16 after trying an
   embedded Jitsi call: Google Meet cannot be embedded at all (Google blocks iframing; feature request
   issuetracker 289696532 still open), public `meet.jit.si` disconnects *embedded* calls after 5 minutes, and every
   hosted free tier meters participant-minutes, which dies at the 50+ people this organization meets with.
   Self-hosting was offered and declined. **Do not re-add an embedded video SDK unless the user asks.**
   The `IN_PORTAL` value in the `MeetingProvider` enum is a leftover of that experiment: reserved, never set.
   Meet's REST API (real attendance sync) would still need Google Workspace.

8. **Files live in Google Drive** (`modules/integrations/google-drive.service.ts`). Master Admin connects the org's
   Drive once at `/master/integrations`; the refresh token is stored AES-encrypted in `system_settings`. Scope is
   `drive.file` only — TEAM OS sees files it created, nothing else. Uploads go to folders under a "TEAM OS" root;
   downloads stream back through `/files/:id/download` after a permission check, so nothing is public.
   Needs the Drive API enabled in Google Cloud and the redirect URI
   `http://localhost:3000/api/integrations/google-drive/callback` added to the OAuth client.

9. **Scores are explainable, never a black box.** `reports/performance.ts` combines four visible signals — task
   completion, deadline adherence, recent work updates, meeting attendance — with weights Master Admin can change on
   the reports module config. A signal with no data is dropped and the rest rescaled, so a team with no meetings is
   not punished. Attendance stays one input among four, per the plan's rule that it is participation data, not a
   verdict on a person.

10. **Custom modules are real modules, not a side system.** Creating one in `/master/builder` writes a `modules` row
    and four permissions (`<moduleKey>.view/create/update/delete`) in the same transaction as the definition, then
    calls `permissions.invalidate()`. So the enable switch, role grants and overrides govern custom modules exactly
    like built-in ones. Never add a second permission path for them. Field definitions are validated by
    `custom/field-schema.ts` (pure, unit-tested) and record `data` is checked against the definition on every write.

11. **The menu shows what a person can actually open.** `/auth/me` returns `visibleModules` (pure, in
    `permission-engine.ts`): enabled modules where the person holds at least one permission. So a USER override
    `finance.* DENY` removes Finance from that person's sidebar, not just the API. The per-person control is
    Master → People → **Access** (added at the owner's request): a select per module (As roles allow / Hidden /
    View only / Full) that calls the existing `POST /master/permissions/presets` with `scopeType: USER`, and reads
    state from `GET /master/permissions/access`. Core modules (Organization, Teams, Events) cannot be hidden this way.

12. **"View as" is read-only and separate.** A preview uses its own cookie (`teamos_view_as`) and a session row with
    `impersonatorId`; `AccessGuard` refuses every non-GET request on it (`READ_ONLY_PREVIEW`) and never uses it for
    `/master/*`, so the control plane always runs as the Master Admin. 30 minutes, audited start and end.
13. **Two-person rule** (`platform/records.ts#requestSecondApproval`): granting Master Admin or deleting a custom module
    becomes a `change_requests` row when another active Master Admin exists; the requester can never approve it. With a
    single Master Admin the change goes straight through (otherwise nobody could ever approve).
14. **Deletes snapshot first.** `recycle()` runs *before* `delete` for task, expense, budget, ticket, idea, opportunity,
    meeting, custom record, event, team, file, shift and run-of-show line; if the snapshot fails the delete fails. The
    snapshot carries cascaded children (`{ __row, __children: [{model, rows}] }`, ordered array because jsonb loses key
    order) and restore recreates row + children in one transaction. Master bin: **Needs review / Ignored** tabs;
    Restore, Ignore (`reviewedAt`), Delete permanently. A deleted file keeps its Drive copy until permanent delete or
    the 30-day purge removes it. Nav shows a badge with the needs-review count.
15. **Notifications never break the work.** `notify()` swallows its own errors. Automation alerts fire once per item
    (`automation_firings`), meeting reminders once per meeting (checked by existing notification).

16. **Maintenance mode is a full lockout, for everyone or per person** (owner's decision). Setting
    `platform.maintenance` = `{ enabled, message, people: [{userId, name, message, since}] }`; `maintenanceFor()` decides
    per user. Master → **Maintenance** page: whole-portal switch + a person dropdown ("Put in maintenance" / "End
    maintenance"); a Master Admin cannot close their own portal. While closed, `AccessGuard` returns 503 `MAINTENANCE`
    for every request — reads included — except `/master/*` (console + gateway), `/auth/me`, `/auth/logout`, and
    anyone with a privileged Master session. The frontend replaces the whole portal with `MaintenanceScreen`
    (big "Maintenance Mode" + the owner's message); `/auth/me` is re-read every 30 s and on any MAINTENANCE error,
    so open pages lock and unlock by themselves. Administrators are locked out too — only the Master session is exempt.

17. **Schedule is read-only for workers.** `schedule.view` (seeded to every role with `task.view`) reads;
    `schedule.manage` (roles with `work_update.review`, i.e. leads, plus admins and the Master session) writes —
    TEAM/EVENT entries check the target, so a team-scoped lead manages only their team's entries. Entries mirror into
    ONE Google calendar created by TEAM OS (`integrations/google-calendar.service.ts`, scopes `calendar.app.created`
    + `calendar.acls`), shared read-only with every ACTIVE member's Google account (`readerChanges` never removes the
    owner or hand-made shares). The portal is the source of truth: Google copies are best-effort, retried every
    automation tick (`ScheduleService.syncAll`, "synced" = `googleSyncedAt >= updatedAt`, both written with the same
    timestamp). Needs Google Calendar API enabled + redirect `/api/integrations/google-calendar/callback`.
18. **Deploys only after checks pass.** GitHub Actions (`.github/workflows/ci.yml`) runs types, lint, unit tests and the
    full e2e suite on a throwaway Postgres; Render (`render.yaml`, `autoDeployTrigger: checksPass`) deploys the API
    and runs `prisma migrate deploy` on start; Vercel deploys FRONTEND (root dir, env `BACKEND_URL`). Owner-facing
    steps are in `DEPLOY.md`. Keep migrations additive so a Render/Vercel rollback is always safe. Production refuses
    to start without a 32+ char `MFA_ENCRYPTION_KEY` — it must equal the local one.

19. **No Google dependency (owner's decision, 2026-09-17).** The owner's Google account `work.on.off.ox@gmail.com`
    was disabled by Google, so:
    - **Sign-in is email + password**, managed by Master Admin only (Master → People → **Add person** / **Password** /
      **Invite many** with a password column; blanks are generated and shown once). argon2 hashes; `/auth/login`
      pauses after 5 wrong tries per email (20 per IP) in 15 min; unknown emails cost the same time as wrong passwords.
      `mustChangePassword` forces `PasswordChangeScreen` and the guard returns 403 `PASSWORD_CHANGE_REQUIRED` for
      everything except `/auth/me|password|logout` and the Master plane. Changing/resetting a password revokes the
      person's other sessions. Google sign-in only shows when `AUTH_GOOGLE_ENABLED=true`.
    - **Files and backups** go through `platform/file-storage.service.ts`: Supabase Storage when `SUPABASE_URL` +
      `SUPABASE_SERVICE_ROLE_KEY` are set, otherwise Postgres (`file_blobs`, 10 MB per file). Old Drive-backed files
      (`storage_provider = google_drive`) cannot be opened.
    - **Reports** download as Excel (`exceljs`, `automation/spreadsheet.ts`) or CSV from `/reports/export`; the weekly
      automation saves a `report_snapshots` row instead of a Google Sheet. Backups keep the 10 newest files.
    - **Owner email/password** is set from a terminal with `npm run owner-login` (password typed hidden, never seen by
      Claude). Drive/Calendar integration code still exists but is optional.
    - **Moving databases**: `npm run copy-database` (dry run) / `-- --apply` copies every table from `DIRECT_URL` to an
      already-migrated `NEW_DIRECT_URL`, parents before children, and checks row counts.

20. **"My calendar" was removed at the owner's request (2026-09-17)** — page, menu item, `/calendar` API and the private
    .ics feed. The organization **Schedule** (with its month grid, `components/platform/month-calendar.tsx`) is the only
    calendar. `users.calendar_token` is left in the database, unused.

## Platform features (Phase 7)

| Portal | Features | Where |
|---|---|---|
| Worker | Notifications bell + page, global search (Ctrl K, permission-filtered), Leave requests, Kudos, My performance card, Shifts sign-up, install on phone (manifest + `public/sw.js`, network-only) | `modules/workspace`, `app/(app)/{notifications,leave,kudos,shifts}` |
| Lead | Workload (`task.assign`), event templates (`POST /events/:id/duplicate`), run of show, shifts management, budget health (80% warning), Google Sheets export (`POST /reports/export-sheet`, CSV converted by Drive under `drive.file`) | `modules/event-ops`, `modules/automation`, `components/platform/event-ops.tsx` |
| Master | View as, access map, sign-ins & security alerts (`control/alerts.ts`), system health (DB vs 500 MB, Google 100 test users, Drive quota), sign out everywhere, offboarding with handover, bulk invite (`control/csv.ts`), maintenance mode, recycle bin, backups to Drive (weekly, secrets excluded), approvals (two-person rule), undo from audit log (whitelisted actions only), branding, announcements, automation rules, policies page, temporary access (`permission_overrides.expires_at`) | `modules/control`, `app/master/(console)/*` |

Automation (`modules/automation`): a 5-minute in-process timer (off when `NODE_ENV=test`). Triggers are a closed list in
`automation/rules.ts` (TASK_OVERDUE, TICKET_STALE, BUDGET_THRESHOLD, EXPENSE_TWO_APPROVERS enforced inside Finance
approval, WEEKLY_REPORT). Seeded per org: overdue 2 days, budget 80%, weekly report on; stale tickets and two approvers off.
Single process only — if the backend is ever scaled to several instances, move the timer to one worker.

## Module map (backend)

`src/modules/`: auth, users, organization, departments, roles, permissions, teams, events, modules-registry, audit,
master-admin, dashboard, **workspace**, **event-ops**, **automation**, **control**, **platform** (shared helpers + settings), **tasks**, **meetings** (also owns `/attendance`), **finance**, **documents**, **ideas**,
**opportunities**, **tickets**, **reports**, **integrations** (Google Drive), **custom** (the Phase 6 builder:
`/master/builder` defines modules, `/custom/:moduleKey` serves their records), plus planned stubs
(none left for notifications/search — replaced by `workspace`) generated by `planned/planned-module.factory.ts`.

Frontend pages mirror the five areas; `src/app/master/` is the hidden console (gateway + console layout with
countdown banner). Feature hooks in `src/features/*`, UI atoms in `src/components/ui/primitives.tsx`.

## Testing

```bash
cd BACKEND && npm test        # 70 unit tests (ics tests removed with My calendar)
cd FRONTEND && npm run build  # type-check + build
```

End-to-end (47 tests across `test/app`, `test/tasks`, `test/meetings`, `test/platform`, `test/login`) needs a **disposable** database — never the live one:

```bash
cd BACKEND
npx prisma dev -n teamos-test -d          # prints a local postgres URL (port varies, usually 51214)
# then, with schema=app in the URL:
DATABASE_URL="postgres://postgres:postgres@localhost:51214/template1?sslmode=disable&schema=app" \
DIRECT_URL="$DATABASE_URL" DATABASE_SCHEMA=app SEED_MASTER_ADMIN_EMAIL=master@teamos.test \
SEED_GATEWAY_CODE=open-sesame-2026 AUTH_DEV_LOGIN=true MFA_ENCRYPTION_KEY=test-key-0123456789abcdef0123456789abcdef \
npx prisma migrate deploy && npx prisma db seed && npx vitest run --config ./vitest.config.e2e.ts
npx prisma dev stop teamos-test && npx prisma dev rm teamos-test
```

Gotchas that already cost time:
- e2e specs share one DB, so `vitest.config.e2e.ts` sets `fileParallelism: false`. A dirty DB breaks the MFA-enrolment test — drop the `app` schema and re-migrate between full runs: `echo 'DROP SCHEMA IF EXISTS app CASCADE; CREATE SCHEMA app;' | npx prisma db execute --stdin` (`migrate reset --skip-seed` does not work in Prisma 7).
- `prisma migrate diff ... > migration.sql 2>&1` captures the "Loaded Prisma config" line into the SQL and the deploy fails at position 1. Redirect stdout only, or delete that line; if it already failed, `migrate resolve --rolled-back <name>` then deploy again.
- Large Python/TS content in a bash heredoc fails with "unexpected EOF"; write the script with the Write tool into the scratchpad and run it.
- `export A=1 B=$A` does not work in one statement; `$A` is empty.
- Only one `next dev` per folder (Next 16 lock). To run a second frontend, kill the first process (the PID in the error message), do not just stop the npm wrapper.
- Claude cannot drive the live site in the browser: dev login is off and Claude must not use the owner's Google account. Verify UI on a throwaway stack (own DB + `AUTH_DEV_LOGIN=true`) instead.
- A Prisma error message starts with a newline; automation logs flatten it. If a rule's `last_run_at` stays empty, read the backend log line for that rule — the Weekly report failed silently once because of a wrong field name (`TaskUpdate.userId`, not `authorId`) that type-checking did not catch inside `Promise.all`.
- Migrations are generated offline with `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`, then applied with `migrate deploy`. Check the SQL for DROP before applying to the live DB.

## Conventions

- Comments explain *why*, not what. Match the surrounding file.
- Backend: zod schemas in `dto.ts` per module, `ZodPipe` for validation, service holds logic, controller stays thin.
- Frontend: `"use client"` pages using TanStack Query hooks; permissions only hide UI (`useCan`, `<Can>`), the API is the authority.
- Money is ₹ (`formatMoney`), dates via `en-IN` helpers in `src/lib/format.ts`.
- The user reads plain language: no jargon in chat, name real outcomes, admit what was not verified.

## Next

All six plan phases plus the platform features are built. Open work, in the order it matters:

0. **Go live** — follow `DEPLOY.md` Part A with the owner (GitHub private repo `team-os` under
   `koushikkushal3-ship-it`, Render, Vercel, Google redirect URIs, UptimeRobot). Local git repo is initialised and
   committed on `main`; nothing has been pushed. Pushing publishes code, so confirm with the owner first.
1. **Try the new features on the live site** — nothing in Phase 7 has been clicked through with a real Google account
   (Claude cannot sign in as the owner). Most valuable checks: View as, hide a module for one person, maintenance mode,
   Back up now (needs Drive connected), Google Sheets export.
2. **e2e for Phases 4–6** (finance approval incl. two approvers, Drive upload/download permissions, builder permission
   registration). Phase 7 now has `test/platform.e2e-spec.ts` (10 tests).
3. **Going public** — calendar feed and Sheets links only work for others once TEAM OS has a public address; then add the
   production redirect URIs and move the Google consent screen out of Testing (lifts the 100 test-user cap).
4. **Google Calendar two-way sync** — only the read-only .ics feed exists.

Deferred by the user's own decision: **no in-portal video**. See rule 7.
Decided 2026-09-17: **keep TEAM OS's own email + password login** for the deadline. After it, consider adding Supabase
Auth *alongside* (Master Admin still the only one creating accounts) for emailed reset links and one-time login codes;
Google sign-in via Supabase would still need a Google Cloud OAuth client, and free Supabase email is heavily rate-limited.
