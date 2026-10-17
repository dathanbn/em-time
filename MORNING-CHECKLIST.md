# Em Time: morning deploy checklist

Everything below is one-time. Budget about 25 minutes. Do the parts in order.
Values you will paste are in `.env.example` at the root of this folder (they are public keys, safe to publish).

```
VITE_SUPABASE_URL=https://svbpsgllxlcjgkrlagrp.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_EPA5ZWLe-Im30BnKl_E2kA_MNrUM8qr
```

---

## Part A: GitHub (about 10 minutes)

You do not need `npm install` for this. GitHub builds the site; your laptop only pushes the source.

**A1. Create the empty repo on GitHub**

1. Open https://github.com/new
2. Repository name: `em-time` (exactly, it becomes the URL path)
3. Public
4. Leave "Add a README", ".gitignore" and "license" unchecked
5. Create repository

**A2. Set Pages and secrets before the first push** (so the first build is the real one)

1. In the new repo: Settings, Pages. Under "Build and deployment", Source: **GitHub Actions**. (If this option is not offered on an empty repo, skip and come back after A3.)
2. Settings, Secrets and variables, Actions, "New repository secret", twice:
   - Name `VITE_SUPABASE_URL`, value `https://svbpsgllxlcjgkrlagrp.supabase.co`
   - Name `VITE_SUPABASE_ANON_KEY`, value `sb_publishable_EPA5ZWLe-Im30BnKl_E2kA_MNrUM8qr`

**A3. Push from this folder** (PowerShell; Git must be installed, check with `git --version`, install from https://git-scm.com if not)

```powershell
cd "C:\Users\datha\OneDrive\Desktop\Em Time"
# the GitHub Actions workflow could not be written into .github\ remotely, so move it into place first
New-Item -ItemType Directory -Force .github\workflows | Out-Null
Move-Item deploy-workflow.yml .github\workflows\deploy.yml
git init -b main
git add .
git commit -m "Em Time v1"
git remote add origin https://github.com/dathanbn/em-time.git
git push -u origin main
```

If git asks who you are first:

```powershell
git config --global user.name "Dathan"
git config --global user.email "your-github-email"
```

**A4. Watch the build**

1. Repo, Actions tab, "Build and deploy". Takes 4 to 6 minutes (lint, typecheck, 338 unit tests, build, 421 Playwright tests, build again with the secrets, deploy).
2. If you skipped A2 step 1, set Pages, Source: GitHub Actions now, then Actions, open the run, "Re-run all jobs".
3. Green check means it is live at **https://dathanbn.github.io/em-time/**

If the run fails, open the failed step and paste the last 30 lines to me. The most likely first-run issue is a Playwright timeout on GitHub's runner; re-running once usually clears it.

---

## Part B: Supabase dashboard (about 8 minutes)

The project and database schema already exist (I created them through the connector). These are the auth settings only. Open https://supabase.com/dashboard, project **em-time**.

**B1. Authentication, Sign In / Providers (or "Providers"), Email**

- Enable Email provider: on
- Confirm email: on
- Leave everything else at defaults. The app never uses passwords; it sends a magic link and a 6-digit code.

**B2. Authentication, URL Configuration**

- Site URL: `https://dathanbn.github.io/em-time/`
- Redirect URLs, add both:
  - `https://dathanbn.github.io/em-time/**`
  - `http://localhost:5173/em-time/**`

**B3. Authentication, Emails (Email Templates), Magic Link**

Add one line to the template body so the email also carries the code (needed when the app is installed on the iPhone home screen, where the link cannot hand the session back):

```html
<p>Or type this code in Em Time: {{ .Token }}</p>
```

Keep the existing `{{ .ConfirmationURL }}` link.

**B4. Know the limit**

Supabase's built-in email sender allows only a few auth emails per hour. Fine for one person, but while testing do not request five links in a row. If you ever want unlimited, Authentication, SMTP settings lets you plug in a free Resend or Brevo account (not needed now).

---

## Part C: Test it (about 7 minutes, needs the Part A build to be green)

Laptop, Chrome:
1. Open https://dathanbn.github.io/em-time/ and press Space. The ring should start. Notification permission is asked here, on first Start, not on load.
2. Settings, Sync, enter an email, "Send link". Open the email, click the link. The Sync card should say signed in and "Synced just now".
3. Chrome address bar, install icon (or menu, "Install Em Time"). Installed app opens standalone.

iPhone, Safari:
1. Open the same URL, Share, "Add to Home Screen".
2. Open it from the home screen. Settings, Sync, enter the same email, then type the 6-digit code from the email (the link will not work inside the home-screen app; the code does).
3. Complete one 1-minute session (Settings lets you set Focus to 1 min). Switch to the laptop and reload: the session should appear in Today and in the heatmap.
4. Lock the phone mid-session and unlock after a minute: remaining time should be correct. Note: iPhone cannot ring or notify while locked; "Keep screen awake" in Settings is the workaround.

Her setup, when you hand it over: she signs in with her own email on each device once, everything else is automatic. The export reminder exists because Safari can wipe site data after 7 days of non-use unless the app is on the home screen, so have her install it.

---

## Part D: Local development (optional, only if you want to change things)

OneDrive and `node_modules` do not mix well (thousands of small files syncing). Copy the folder first:

```powershell
Copy-Item "C:\Users\datha\OneDrive\Desktop\Em Time" -Destination "C:\dev\em-time" -Recurse
cd C:\dev\em-time
npm install
Copy-Item .env.example .env.local
npm run dev
```

Then open http://localhost:5173/em-time/ . Add `?stub` to the URL to see 70 days of fake history, `?stub=empty` for the first-run state.

Checks: `npm run lint`, `npm run typecheck`, `npx vitest run`, and for end-to-end: `VITE_E2E=1 npm run build` then `npx playwright test` (first time: `npx playwright install chromium`).

---

## What is where

- `docs/` spec, design brief, architecture, contract, tasks (the plan the agents built from)
- `frontend/` the app; `frontend/src/core/` is the framework-free logic and sync engine
- `frontend/src/data/messages.json` the 40 encouraging lines and break prompts; edit freely
- `frontend/supabase/` the SQL migration (already applied) and setup notes
- `tests/` unit and Playwright tests, 56 screenshots, and `tests/qa-report.md` with pass/fail per acceptance criterion plus a manual checklist
- `HANDOFF.md` the agents' notes on every place they deviated from the contract and why
