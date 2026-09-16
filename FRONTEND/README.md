# TEAM OS — Frontend

Next.js 16 (App Router) + React 19 + Tailwind CSS 4 + TanStack Query. The website people use to run the organization.

## Setup

```bash
npm install
cp .env.example .env.local   # BACKEND_URL=http://localhost:4000
npm run dev                  # http://localhost:3000 (start the BACKEND first)
```

The site proxies `/api/*` to the backend (`next.config.ts` rewrites), so the browser only talks to this origin and the
session cookie belongs to the website. `src/proxy.ts` sends visitors without a session cookie to `/login`; real
authorization always happens in the backend.

## Structure

```
src/
├── app/
│   ├── login/                 Google sign-in (+ dev email sign-in when the backend allows it)
│   ├── (app)/                 workspace shell — the five areas
│   │   ├── dashboard/         01 Home (role-aware: member / lead / admin)
│   │   ├── teams/ events/ people/                02 Teams & Events  (Phase 1, live)
│   │   ├── work/ tasks/[id]/                     My Work, task detail, daily updates (Phase 2, live)
│   │   ├── meetings/ meetings/[id]/ attendance/  Meeting room, attendance (Phase 3, live)
│   │   ├── operations/ finance/ tickets/ invitations/   04 Operations (Phase 4 placeholders)
│   │   └── ideas/ reports/                       05 Knowledge       (Phase 4–5 placeholders)
│   └── master/                hidden control plane — never linked from navigation
│       ├── gateway/           secondary code → authenticator (TOTP)
│       └── (console)/         overview, organization, people, roles, permissions, modules, security, audit
├── components/  ui/ layout/ teams/ events/ admin/
├── features/    teams/ events/ people/ administration/   (TanStack Query hooks per feature)
└── lib/         api/ (client + types), auth/ (useMe), permissions/ (useCan, <Can>), format.ts
```

Navigation comes from `/auth/me`: disabled modules are hidden, planned modules show "Soon", and items needing a
permission are hidden without it. Users without the Master Admin role get a 404 at `/master`.
