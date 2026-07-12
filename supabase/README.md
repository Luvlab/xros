# Supabase — XR Search Engine

The database foundation for the XR/immersive AI search engine + advertising
platform. Backend is Supabase (Postgres + Auth + Row Level Security).

## What's here

```
supabase/
  migrations/
    0001_init.sql   — tables, indexes, helper functions, triggers, RLS policies
  README.md         — this file
```

## 1. Create a Supabase project

1. Go to <https://supabase.com/dashboard> and sign in.
2. Click **New project**. Pick an organization, name it (e.g. `xr-search-engine`),
   set a strong database password, and choose a region close to your users.
3. Wait for the project to finish provisioning (~2 min).
4. Grab your API credentials from **Project Settings → API**:
   - **Project URL** → goes in `VITE_SUPABASE_URL`
   - **anon public key** → goes in `VITE_SUPABASE_ANON_KEY`

Copy `.env.example` to `.env` and fill those two values in.

## 2. Run the migration

You have two options.

### Option A — Supabase CLI (recommended)

```bash
# Install the CLI once: https://supabase.com/docs/guides/cli
supabase login
supabase link --project-ref <your-project-ref>   # ref is in the dashboard URL
supabase db push
```

`supabase db push` applies everything in `supabase/migrations/` in order.

### Option B — SQL editor (no CLI)

1. Open your project → **SQL Editor** → **New query**.
2. Paste the entire contents of `supabase/migrations/0001_init.sql`.
3. Click **Run**.

The migration is idempotent-friendly (`create table if not exists`,
`drop policy if exists` before each `create policy`, `create or replace function`),
so re-running it on a fresh database is safe.

## 3. Make yourself an admin

New users are created with `role = 'consumer'` automatically (via the
`handle_new_user` trigger on `auth.users`). To promote your own account to
`admin`, first sign in to the app at least once so your `profiles` row exists,
then run this in the **SQL Editor**:

```sql
update public.profiles
set role = 'admin'
where email = 'you@example.com';
```

> Note: the `prevent_role_escalation` trigger blocks normal users from changing
> their own `role`. The SQL editor runs as a privileged role, so this statement
> works. Alternatively, look up your `id` under **Authentication → Users** and use
> `where id = '<uuid>'`.

Once you are an admin you can change other users' roles from within the app
(the RLS policies + trigger allow admins to update any profile, including `role`).

## How authorization works

- **`role` column** on `profiles` is the single source of truth. Persisted values:
  `consumer`, `creator`, `advertiser`, `moderator`, `admin`. (`guest` is an
  app-level unauthenticated state and is never stored.)
- **`public.current_role()`** is a `SECURITY DEFINER STABLE` SQL function that
  returns the caller's role (or `'guest'` if unauthenticated). RLS policies call
  it to gate access. `public.is_admin()` is a thin wrapper. Because it is
  `SECURITY DEFINER`, it reads `profiles` without tripping RLS or recursing.
  Always call it schema-qualified — `public.current_role()` — since Postgres has a
  reserved keyword of the same name.
- **Role-lock**: the `prevent_role_escalation` BEFORE UPDATE trigger on `profiles`
  raises an exception if a non-admin tries to change `role`. Users may update
  their own profile (display name, etc.) but cannot escalate privileges.
- **New-user provisioning**: the `handle_new_user` trigger on `auth.users` inserts
  the matching `profiles` row on signup.

### Policy summary

| Table | Read | Write |
|---|---|---|
| `profiles` | any authenticated user (directory) | own row only; role locked to admins |
| `apps` | anyone: `published`; owners: their own | owners full on own; moderators+admins full |
| `campaigns` | advertiser: own only | advertiser own; admins full |
| `ad_creatives` | advertiser: own; authenticated: `active` campaigns | advertiser own (via campaign join); admins full |
| `ad_events` | advertiser: events for own creatives; admins full | any authenticated can INSERT; no public update/delete |
| `bookmarks` | owner only | owner only |

## Env vars

See `.env.example`. For Phase 1 you only need the two public Supabase values:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

AI provider keys are BYOK (bring your own key), set by users in-app — no server
keys are required for Phase 1.
