# Em Time: Supabase setup

Sync is optional. The app never assumes any of this exists: with `VITE_SUPABASE_URL` or
`VITE_SUPABASE_ANON_KEY` missing or empty, it builds and runs local-only with no Sync card and
makes no requests to Supabase.

## Status (2026-10-14): steps 1 and 2 are already done

The project exists and the schema is applied. Nothing in this folder needs to be run again unless
you create a new project.

- Project: `em-time`, ref `svbpsgllxlcjgkrlagrp`, region us-west-1, organization "Pumo's Castle".
- The migration in `migrations/20261015000000_em_time_sync.sql` has been applied to it (as three
  migrations named `em_time_sync_tables`, `em_time_sync_lww_rls` and `em_time_sync_grants`).
  RLS, triggers and grants were verified. The file here is the same SQL in one piece so the
  schema is reproducible.
- The values below are public by design (the publishable/anon key is meant to ship in the
  browser) and are safe to commit. They are in `.env.example` at the repo root.

```
VITE_SUPABASE_URL=https://svbpsgllxlcjgkrlagrp.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_EPA5ZWLe-Im30BnKl_E2kA_MNrUM8qr
```

Never put the service role key in the app, in `.env.local`, or in a build step. It is only for the
optional real-project e2e test, passed through the shell for that test run.

## One-time setup

1. ~~Create a Supabase project.~~ Done.
2. ~~Run the migration~~ (`supabase db push`, or paste the file into the SQL editor). Done.
3. Dashboard, Authentication, Providers: Email enabled; "Confirm email" on; password sign-in not
   used.
4. Dashboard, Authentication, URL configuration: Site URL `https://dathanbn.github.io/em-time/`.
   Redirect URLs, add:
   - `https://dathanbn.github.io/em-time/`
   - `http://localhost:5173/em-time/`
   - `http://localhost:4173/em-time/`
5. Dashboard, Authentication, Email templates, Magic Link: keep the link and add the code line,
   for example "Or type this code in Em Time: {{ .Token }}". This is required for the iPhone
   home-screen app, whose storage is separate from Safari, so a link opened from Mail cannot sign
   it in but a typed 6-digit code can.
6. Optional: custom SMTP. The built-in sender is rate limited (a few emails per hour), which is
   fine for one user.
7. GitHub repository, Settings, Secrets and variables, Actions: add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` (the anon or publishable key, never the service role key). Re-run the
   workflow.
8. Locally: copy `.env.example` to `.env.local` (repo root) and keep the same two values.

## What the schema does

- Tables `categories`, `tasks`, `sessions`, `settings`, keyed by `(user_id, id)` (settings by
  `user_id`). All ids and timestamps (epoch ms) come from the client.
- Row level security limits every table to `auth.uid() = user_id`. `anon` has no grants. There is
  no DELETE policy or grant: deletion is a soft delete (`deleted_at`).
- `em_lww_guard` triggers enforce last-write-wins on `updated_at`: an older write is ignored, a
  tombstone wins an exact tie, and an `updated_at` more than 10 minutes ahead of the server clock
  is clamped to server time.
- `server_updated_at` is set by the trigger with `clock_timestamp()` and is what the client pulls
  by (with a 60 s overlap).
