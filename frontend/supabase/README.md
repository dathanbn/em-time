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
3. Dashboard, Authentication, Sign In / Providers, Email: "Enable Sign in / up" ON and
   "Confirm email" OFF. That is the whole dashboard setup: no URL configuration, no email
   templates, no SMTP, no organization invite.
4. GitHub repository, Settings, Secrets and variables, Actions: add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` (the anon or publishable key, never the service role key). Re-run the
   workflow.
5. Locally: copy `.env.example` to `.env.local` (repo root) and keep the same two values.

## Sign-in: the sync code

There are no emails. The user chooses a sync code (at least 8 characters) and types it once per
device. The app derives an address (`<code>@dathanbn.github.io`, nothing is ever sent to it) and a password
(SHA-256 of `em-time:v1:` + the code) from it, signs in, and creates the account the first time the
code is used anywhere. If "Confirm email" is still on, creating the account returns no session and
the app shows a message asking to turn it off.

Security model, honestly:

- The sync code is the only secret. Anyone who knows it can read and write that account's data.
  Row level security keeps accounts apart, but it cannot tell a person who knows the code from
  its owner.
- Pick something not guessable. 8 characters is the enforced minimum, and a longer phrase is
  better. The derived address contains the code, so it is not hidden from Supabase or from anyone
  with access to the project dashboard.
- If she forgets the code she can choose a new one on a device that still has her history. That
  creates a new account and the device's history is pushed to it. The old account's data stays in
  the old account, unreachable without the old code.
- The code and password are not saved by the app (not in the stored document and not in backups);
  only the Supabase session token stays on the device, until she signs out.

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
