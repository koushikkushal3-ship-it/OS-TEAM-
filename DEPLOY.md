# TEAM OS — going live, and adding things later

After the one-time setup in Part A, every change works like this:

> change the code → push to GitHub → checks run → the live portal updates by itself.

Everything below uses free plans, and **nothing needs a Google account**.

| Piece | Where it runs | Updates automatically from GitHub |
|---|---|---|
| Website (FRONTEND) | Vercel | Yes, on every push |
| API (BACKEND) | Render | Yes, after the GitHub checks pass |
| Database | Supabase (already set up) | Database changes apply on each deploy |

---

## Part A — one-time setup (about 30 minutes)

### Step 1 — Put the code on GitHub (private)

1. Go to https://github.com/new while signed in as **koushikkushal3-ship-it**.
2. Repository name `team-os`, choose **Private**, do **not** tick "Add a README", click **Create repository**.
3. Tell Claude the repository address. Claude connects it and uploads the code; a GitHub sign-in window may pop up once.
4. On GitHub → **Actions**, wait for the **CI** run to finish with a green tick (about 5 minutes).

Your passwords are **not** uploaded: `BACKEND/.env` is excluded.

### Step 2 — Put the API on Render

1. Go to https://render.com and sign up **with GitHub**.
2. **New → Blueprint** → pick `team-os` → **Connect**.
3. Render asks for four values. Open `BACKEND\.env` in Notepad and copy **exactly**:
   - `DATABASE_URL`
   - `DIRECT_URL`
   - `MFA_ENCRYPTION_KEY` — must be identical, or the Master authenticator stops working
   - `FRONTEND_URL` — type `https://example.com` for now; you fix it in Step 4
4. Click **Apply**. The first build takes about 5 minutes.
5. When it says **Live**, copy the address at the top, e.g. `https://teamos-backend.onrender.com`.
6. Open that address with `/health` at the end — you should see `"status":"ok"`.

### Step 3 — Put the website on Vercel

1. Go to https://vercel.com and sign up **with GitHub**.
2. **Add New → Project** → import `team-os`.
3. **Root Directory** → **Edit** → choose `FRONTEND`.
4. **Environment Variables** → add `BACKEND_URL` = your Render address from Step 2.5 (no `/` at the end).
5. Click **Deploy**. Copy the website address when done, e.g. `https://team-os.vercel.app`.

### Step 4 — Tell the API where the website is

Render → your service → **Environment** → set `FRONTEND_URL` to your Vercel address → **Save changes**.
Render restarts by itself.

### Step 5 — Keep it awake (free)

The free Render plan sleeps after 15 minutes without visitors (the first visit then takes about 50 seconds).

1. https://uptimerobot.com → free account → **Add New Monitor**.
2. Type **HTTP(s)**, URL `https://teamos-backend.onrender.com/health`, interval **5 minutes**, **Create**.

### Step 6 — Check the live portal

1. Open your Vercel address → sign in with your email and password.
2. Open `/master` → gateway code → authenticator code.
3. Add your team from Master → People.

---

## Part B — adding or changing something later

### Changes that need NO code

Master → **Module builder** (new forms), **Roles / Permissions / Access**, **Automations**, **Policies**,
**Branding**, **Announcements**, **Schedule** — they take effect immediately.

### Changes that need code

1. **Close the portal if the change is big:** Master → **Maintenance** → message → switch on.
2. **Make the change on this computer** — ask Claude in this folder.
3. **Try it locally** at http://localhost:3000.
4. **Save and upload** — in the terminal, one line at a time:

```bash
git add -A
```
```bash
git commit -m "Describe the change in a few words"
```
```bash
git push
```

5. **Wait for green** on GitHub → **Actions**. A red cross means the live portal is **not** changed — ask Claude "CI failed, please fix", then push again.
6. **Wait for the deploy** — Render and Vercel show **Live** a few minutes after the green tick.
7. **Check the live portal**, then Master → **Maintenance** → switch off.

### If something goes wrong after an update

- **Render** → your service → **Events** → previous deploy → **Rollback**.
- **Vercel** → **Deployments** → previous one → **⋯ → Promote to Production**.
- Database changes in this project only ever **add** things, so rolling the code back is safe.
