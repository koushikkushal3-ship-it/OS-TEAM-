# TEAM OS — going live, and adding things later

Right now TEAM OS runs on this computer only. Putting it on GitHub by itself does **not** update anything.
After the one-time setup in Part A, it works the way you want:

> change the code → push to GitHub → checks run → the live portal updates by itself.

Everything below uses free plans.

| Piece | Where it runs | Updates automatically from GitHub |
|---|---|---|
| Website (FRONTEND) | Vercel | Yes, on every push |
| API (BACKEND) | Render | Yes, after the GitHub checks pass |
| Database | Supabase (already set up) | Database changes apply on each deploy |
| Files, Sheets, Calendar | Your Google account (already set up) | — |

---

## Part A — one-time setup (about 45 minutes)

### Step 1 — Put the code on GitHub (private)

1. Go to https://github.com/new while signed in as **koushikkushal3-ship-it**.
2. Repository name: `team-os`. Choose **Private**. Do **not** tick "Add a README". Click **Create repository**.
3. On this computer, in the `E:\ADV TEAM WORK PORTEL` folder, run these (GitHub shows the same lines):

```bash
git remote add origin https://github.com/koushikkushal3-ship-it/team-os.git
```
```bash
git push -u origin main
```

4. A browser window may ask you to sign in to GitHub. Sign in.
5. On GitHub, open the **Actions** tab. A run called **CI** starts. Wait for the green tick (about 5 minutes).

Your passwords are **not** uploaded: `BACKEND/.env` and `FRONTEND/.env.local` are excluded by `.gitignore`.

### Step 2 — Put the API on Render

1. Go to https://render.com and sign up **with GitHub**.
2. Click **New → Blueprint**, pick the `team-os` repository, then **Connect**.
3. Render reads `render.yaml` and asks for these values. Open `BACKEND\.env` in Notepad and copy each one **exactly**:
   - `DATABASE_URL`
   - `DIRECT_URL`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `MFA_ENCRYPTION_KEY` — **must be identical**, or your authenticator and Google connections stop working
4. For the other four, type a placeholder for now: `https://example.com`. You will fix them in Step 4.
5. Click **Apply**. The first build takes about 5 minutes.
6. When it says **Live**, copy the address at the top, for example `https://teamos-backend.onrender.com`.
7. Open that address with `/health` at the end. You should see `"status":"ok"`.

### Step 3 — Put the website on Vercel

1. Go to https://vercel.com and sign up **with GitHub**.
2. Click **Add New → Project** and import `team-os`.
3. **Root Directory**: click Edit and choose `FRONTEND`.
4. Under **Environment Variables**, add:
   - Name `BACKEND_URL`, value your Render address from Step 2.6 (no `/` at the end).
5. Click **Deploy**. When it finishes, copy the website address, for example `https://team-os.vercel.app`.

### Step 4 — Tell the API where the website is

In Render → your service → **Environment**, set these (replace `team-os.vercel.app` with your address):

| Key | Value |
|---|---|
| `FRONTEND_URL` | `https://team-os.vercel.app` |
| `GOOGLE_REDIRECT_URI` | `https://team-os.vercel.app/api/auth/google/callback` |
| `GOOGLE_DRIVE_REDIRECT_URI` | `https://team-os.vercel.app/api/integrations/google-drive/callback` |
| `GOOGLE_CALENDAR_REDIRECT_URI` | `https://team-os.vercel.app/api/integrations/google-calendar/callback` |

Click **Save changes**. Render restarts the API by itself.

### Step 5 — Tell Google about the live address

1. Go to https://console.cloud.google.com/apis/credentials and open your OAuth client (ID ends `mibgr8hb`).
2. Under **Authorised JavaScript origins**, add `https://team-os.vercel.app`.
3. Under **Authorised redirect URIs**, **add** the three `https://…` addresses from Step 4. Keep the `localhost` ones, so the copy on this computer keeps working.
4. Click **Save**.
5. Only if not done yet: **APIs & Services → Library** → enable **Google Calendar API**.

### Step 6 — Keep it awake (free)

The free Render plan sleeps after 15 minutes without visitors, and while it sleeps reminders and automations pause.
The free Supabase plan pauses after a week without use. One free monitor prevents both:

1. Go to https://uptimerobot.com and create a free account.
2. **Add New Monitor** → type **HTTP(s)** → URL `https://teamos-backend.onrender.com/health` → interval **5 minutes** → **Create**.

### Step 7 — Check the live portal

1. Open your Vercel address and sign in with Google.
2. Open `/master`, then enter your gateway code and authenticator code.
3. Go to **Integrations** and click **Connect Google Calendar**. Drive is already connected, because the connection is saved in the database.
4. Add one entry on **Schedule** and check it appears in Google Calendar.

---

## Part B — adding or changing something later

### Changes that need NO code and NO upload

Do these straight in the portal. They take effect immediately:

- New forms or trackers → Master → **Module builder**
- Who can see or do what → **Roles**, **Permissions**, People → **Access**
- Rules and alerts → **Automations**, **Policies**
- Look → **Branding**; messages → **Announcements**; dates for everyone → **Schedule**

### Changes that need code

1. **Close the portal if the change is big.**
   Master → **Maintenance** → type a message → switch on. For a small fix you can skip this.
2. **Make the change on this computer.**
   Ask Claude in this folder, for example: "add a field X to expenses". Claude also updates `CLAUDE.md`.
3. **Check it locally.**
   Run the backend and website as usual and try the change at http://localhost:3000.
4. **Save and upload:**

```bash
git add -A
```
```bash
git commit -m "Describe the change in a few words"
```
```bash
git push
```

5. **Wait for green.**
   On GitHub → **Actions**, the CI run must finish with a green tick.
   - Red cross: the live portal is **not** changed. Ask Claude "CI failed, please fix", then push again.
6. **Wait for the deploy.**
   Render and Vercel each show **Live** a few minutes after the green tick. Database changes are applied during this step.
7. **Check the live portal**, then Master → **Maintenance** → switch off.

### If something goes wrong after an update

- **Render** → your service → **Events** → pick the previous deploy → **Rollback**.
- **Vercel** → **Deployments** → the previous one → **⋯ → Promote to Production**.
- Database changes in this project only ever **add** things, so rolling the code back is safe.

---

## Good to know

- **The first visit after a quiet spell** can take about 50 seconds while Render wakes up. The uptime monitor in Step 6 mostly avoids this.
- **Google sign-in stays in "Testing"** until you publish the consent screen. That means at most 100 people, each added under **Audience → Test users**.
  - To lift the limit: Google Cloud → **Google Auth Platform → Audience → Publish app**. Google may ask for verification because of the Drive and Calendar permissions.
- **The Google Calendar subscription links** on My calendar start working for everyone once the portal is live.
- **One server only.** Automations run inside the API. If you ever run two copies of the API, move the timer to one of them first.
