-- =============================================================================
-- 0001_init.sql — XR Search Engine: database foundation
-- =============================================================================
-- Targets a fresh Supabase Postgres instance (Postgres + Auth + RLS).
-- Idempotent-friendly: uses "create table if not exists", "drop policy if exists",
-- and "create or replace function" so it can be re-run without error on a fresh DB.
--
-- Design notes:
--   * Role model: a single primary `role` column on `profiles`
--     (guest/consumer/creator/advertiser/moderator/admin at the app level; the DB
--     check constraint enforces the persistable subset consumer..admin — 'guest'
--     is an unauthenticated app-level state and is never stored).
--   * Role resolution in policies: helper function public.current_role() reads the
--     caller's role from profiles. It is SECURITY DEFINER + STABLE so it can read
--     the profiles row regardless of RLS and be reused across policies. See below.
--   * Role-lock: a BEFORE UPDATE trigger `prevent_role_escalation` on profiles
--     rejects any change to `role` unless the caller is an admin. This prevents
--     privilege escalation even though users are allowed to UPDATE their own row.
--   * New-user provisioning: a SECURITY DEFINER trigger `handle_new_user()` on
--     auth.users inserts the matching profiles row on signup.
-- =============================================================================

-- gen_random_uuid() lives in pgcrypto; present by default on Supabase but be safe.
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

-- profiles: one row per auth user. `role` is the single primary role.
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  role         text not null default 'consumer'
                 check (role in ('consumer','creator','advertiser','moderator','admin')),
  created_at   timestamptz default now()
);

-- apps: XR mini-apps / experiences in the directory.
create table if not exists public.apps (
  id            uuid primary key default gen_random_uuid(),
  owner         uuid references public.profiles(id) on delete cascade,
  slug          text unique,
  title         text not null,
  description   text,
  url           text,
  thumbnail_url text,
  category      text,
  status        text not null default 'draft'
                  check (status in ('draft','pending','published','rejected')),
  created_at    timestamptz default now()
);

-- campaigns: advertising campaigns owned by an advertiser.
create table if not exists public.campaigns (
  id           uuid primary key default gen_random_uuid(),
  advertiser   uuid references public.profiles(id) on delete cascade,
  name         text not null,
  status       text not null default 'draft'
                 check (status in ('draft','active','paused','ended')),
  budget_cents bigint not null default 0,
  spend_cents  bigint not null default 0,
  starts_at    timestamptz,
  ends_at      timestamptz,
  created_at   timestamptz default now()
);

-- ad_creatives: individual creatives belonging to a campaign.
create table if not exists public.ad_creatives (
  id         uuid primary key default gen_random_uuid(),
  campaign   uuid references public.campaigns(id) on delete cascade,
  format     text not null default 'billboard'
               check (format in ('billboard','skybox','portal')),
  title      text,
  body       text,
  media_url  text,
  click_url  text,
  created_at timestamptz default now()
);

-- ad_events: impression / click log for creatives.
create table if not exists public.ad_events (
  id         bigint generated always as identity primary key,
  creative   uuid references public.ad_creatives(id) on delete cascade,
  event_type text not null check (event_type in ('impression','click')),
  user_id    uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

-- bookmarks: private per-user saved links.
create table if not exists public.bookmarks (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid references public.profiles(id) on delete cascade,
  title      text,
  url        text not null,
  created_at timestamptz default now()
);

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------
create index if not exists idx_campaigns_advertiser  on public.campaigns (advertiser);
create index if not exists idx_ad_creatives_campaign on public.ad_creatives (campaign);
create index if not exists idx_ad_events_creative    on public.ad_events (creative);
create index if not exists idx_bookmarks_owner       on public.bookmarks (owner);
create index if not exists idx_apps_status           on public.apps (status);

-- -----------------------------------------------------------------------------
-- Helper: current_role()
-- -----------------------------------------------------------------------------
-- Returns the caller's role from profiles, or 'guest' when unauthenticated /
-- no profile row exists. SECURITY DEFINER lets it read profiles without being
-- blocked by RLS (and without recursive policy evaluation). STABLE because it
-- does not modify data and returns the same value within a statement.
--
-- NOTE: named public.current_role() per the contract. Postgres also has a
-- reserved keyword `current_role`; always call this schema-qualified as
-- public.current_role() to avoid ambiguity.
create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    'guest'
  );
$$;

-- Convenience predicate used across policies.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() = 'admin';
$$;

-- -----------------------------------------------------------------------------
-- New-user provisioning trigger on auth.users
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER so it can insert into public.profiles from the auth schema
-- context. Runs after a new auth user is created and mirrors them into profiles
-- with the default 'consumer' role.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'consumer')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Role-lock trigger: prevent privilege escalation on profiles
-- -----------------------------------------------------------------------------
-- Users are permitted to UPDATE their own profiles row, but must NOT be able to
-- change their own `role`. This BEFORE UPDATE trigger raises unless the caller
-- is an admin. Admins may change role freely.
create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    if not public.is_admin() then
      raise exception 'Only admins may change a profile role'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_role_escalation on public.profiles;
create trigger prevent_role_escalation
  before update on public.profiles
  for each row execute function public.prevent_role_escalation();

-- -----------------------------------------------------------------------------
-- Enable Row Level Security
-- -----------------------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.apps         enable row level security;
alter table public.campaigns    enable row level security;
alter table public.ad_creatives enable row level security;
alter table public.ad_events    enable row level security;
alter table public.bookmarks    enable row level security;

-- =============================================================================
-- RLS POLICIES
-- =============================================================================

-- ---- profiles ---------------------------------------------------------------
-- Public directory: any authenticated user can read all profiles.
drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated
  on public.profiles for select
  to authenticated
  using (true);

-- A user can update ONLY their own row. The prevent_role_escalation trigger
-- additionally blocks any role change by non-admins.
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Admins can update any profile (including role — trigger allows it for admins).
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---- apps -------------------------------------------------------------------
-- Public (even anonymous) can read published apps.
drop policy if exists apps_select_published on public.apps;
create policy apps_select_published
  on public.apps for select
  to anon, authenticated
  using (status = 'published');

-- Owners can read all of their own apps (any status).
drop policy if exists apps_select_own on public.apps;
create policy apps_select_own
  on public.apps for select
  to authenticated
  using (owner = auth.uid());

-- Owners can insert their own apps.
drop policy if exists apps_insert_own on public.apps;
create policy apps_insert_own
  on public.apps for insert
  to authenticated
  with check (owner = auth.uid());

-- Owners can update their own apps.
drop policy if exists apps_update_own on public.apps;
create policy apps_update_own
  on public.apps for update
  to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid());

-- Owners can delete their own apps.
drop policy if exists apps_delete_own on public.apps;
create policy apps_delete_own
  on public.apps for delete
  to authenticated
  using (owner = auth.uid());

-- Moderators and admins can do everything on any app.
drop policy if exists apps_all_staff on public.apps;
create policy apps_all_staff
  on public.apps for all
  to authenticated
  using (public.current_role() in ('moderator','admin'))
  with check (public.current_role() in ('moderator','admin'));

-- ---- campaigns --------------------------------------------------------------
-- Advertiser can read their own campaigns. No public read.
drop policy if exists campaigns_select_own on public.campaigns;
create policy campaigns_select_own
  on public.campaigns for select
  to authenticated
  using (advertiser = auth.uid());

drop policy if exists campaigns_insert_own on public.campaigns;
create policy campaigns_insert_own
  on public.campaigns for insert
  to authenticated
  with check (advertiser = auth.uid());

drop policy if exists campaigns_update_own on public.campaigns;
create policy campaigns_update_own
  on public.campaigns for update
  to authenticated
  using (advertiser = auth.uid())
  with check (advertiser = auth.uid());

drop policy if exists campaigns_delete_own on public.campaigns;
create policy campaigns_delete_own
  on public.campaigns for delete
  to authenticated
  using (advertiser = auth.uid());

-- Admins: full access.
drop policy if exists campaigns_all_admin on public.campaigns;
create policy campaigns_all_admin
  on public.campaigns for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---- ad_creatives -----------------------------------------------------------
-- Advertiser can CRUD creatives that belong to their own campaigns.
drop policy if exists ad_creatives_select_own on public.ad_creatives;
create policy ad_creatives_select_own
  on public.ad_creatives for select
  to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = ad_creatives.campaign
        and c.advertiser = auth.uid()
    )
  );

drop policy if exists ad_creatives_insert_own on public.ad_creatives;
create policy ad_creatives_insert_own
  on public.ad_creatives for insert
  to authenticated
  with check (
    exists (
      select 1 from public.campaigns c
      where c.id = ad_creatives.campaign
        and c.advertiser = auth.uid()
    )
  );

drop policy if exists ad_creatives_update_own on public.ad_creatives;
create policy ad_creatives_update_own
  on public.ad_creatives for update
  to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = ad_creatives.campaign
        and c.advertiser = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.campaigns c
      where c.id = ad_creatives.campaign
        and c.advertiser = auth.uid()
    )
  );

drop policy if exists ad_creatives_delete_own on public.ad_creatives;
create policy ad_creatives_delete_own
  on public.ad_creatives for delete
  to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = ad_creatives.campaign
        and c.advertiser = auth.uid()
    )
  );

-- Any authenticated user can read creatives whose campaign is active (ad serving).
drop policy if exists ad_creatives_select_active on public.ad_creatives;
create policy ad_creatives_select_active
  on public.ad_creatives for select
  to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = ad_creatives.campaign
        and c.status = 'active'
    )
  );

-- Admins: full access.
drop policy if exists ad_creatives_all_admin on public.ad_creatives;
create policy ad_creatives_all_admin
  on public.ad_creatives for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---- ad_events --------------------------------------------------------------
-- Any authenticated user can INSERT events (log impressions/clicks).
drop policy if exists ad_events_insert_authenticated on public.ad_events;
create policy ad_events_insert_authenticated
  on public.ad_events for insert
  to authenticated
  with check (true);

-- Advertisers can SELECT events for creatives in their own campaigns.
drop policy if exists ad_events_select_own on public.ad_events;
create policy ad_events_select_own
  on public.ad_events for select
  to authenticated
  using (
    exists (
      select 1
      from public.ad_creatives cr
      join public.campaigns c on c.id = cr.campaign
      where cr.id = ad_events.creative
        and c.advertiser = auth.uid()
    )
  );

-- Admins: full access. (No public update/delete — only admins.)
drop policy if exists ad_events_all_admin on public.ad_events;
create policy ad_events_all_admin
  on public.ad_events for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---- bookmarks --------------------------------------------------------------
-- Owner-only for every operation.
drop policy if exists bookmarks_select_own on public.bookmarks;
create policy bookmarks_select_own
  on public.bookmarks for select
  to authenticated
  using (owner = auth.uid());

drop policy if exists bookmarks_insert_own on public.bookmarks;
create policy bookmarks_insert_own
  on public.bookmarks for insert
  to authenticated
  with check (owner = auth.uid());

drop policy if exists bookmarks_update_own on public.bookmarks;
create policy bookmarks_update_own
  on public.bookmarks for update
  to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid());

drop policy if exists bookmarks_delete_own on public.bookmarks;
create policy bookmarks_delete_own
  on public.bookmarks for delete
  to authenticated
  using (owner = auth.uid());

-- =============================================================================
-- end 0001_init.sql
-- =============================================================================
