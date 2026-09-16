# TEAM OS

The organization's work portal: one website for people, teams, events, work, meetings, operations and knowledge,
with a hidden Master Admin control plane. ("OS" is the product name. It is a website, not an operating system.)

| Folder | What | Stack |
|---|---|---|
| [`FRONTEND/`](FRONTEND/README.md) | The website | Next.js 16, React 19, Tailwind 4, TanStack Query |
| [`BACKEND/`](BACKEND/README.md) | The API | NestJS 12, Prisma 7, Supabase Postgres |

## Going live and updating

See [DEPLOY.md](DEPLOY.md): one-time setup on GitHub, Render and Vercel (free), then every push updates the live portal after the checks pass.

## Run locally

1. `BACKEND`: `npm install`, copy `.env.example` → `.env` and fill it in, `npm run db:deploy`, `npm run db:seed`, `npm run start:dev`
2. `FRONTEND`: `npm install`, copy `.env.example` → `.env.local`, `npm run dev`
3. Open http://localhost:3000 and sign in with the Google account you set as `SEED_MASTER_ADMIN_EMAIL`.
4. Master Admin: open http://localhost:3000/master → gateway code (`SEED_GATEWAY_CODE`) → authenticator app.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 Foundation | Google sign-in, hidden Master Admin gateway, organization, departments, people, custom roles, permissions & overrides, teams, events, modules, audit | **Built** |
| 2 Work Management | Tasks, subtasks, assignment, daily work updates, lead review, progress rollup into teams and events | **Built** |
| 3 Meeting Center | Meeting records with a pasted Google Meet link, participants, join/leave sessions, derived attendance, notes, decisions, action items that become tasks | **Built** |
| 4 Operations | Finance with approval and reimbursement, tickets, files in Google Drive, ideas, sponsors / guests / vendors / venues / invitations pipeline | **Built** |
| 5 Reporting | Organization, team, people and event reports with performance scores built from real work records, CSV export, print view | **Built** |
| 6 Platform Builder | Module builder: custom modules with their own fields, workflow states and permissions, built from Master Admin without code | **Built** |
| 7 Platform features | Workers: notifications, search, calendar + subscription link, leave, kudos, shifts, my performance, install on phone. Leads: workload, event templates, run of show, budget health, Google Sheets export. Master: view as, access map, sign-ins & alerts, system health, offboarding, bulk invite, maintenance mode, recycle bin, backups, two-person approvals, undo, branding, announcements, automations, policies, temporary access | **Built** |
