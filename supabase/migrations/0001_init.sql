-- XR Search platform schema.
--
-- Tables are namespaced with an `xros_` prefix so the app can share a database
-- with other projects (e.g. mounted inside luvlab's Supabase) without colliding
-- and without needing a separate paid project. If you self-host in a dedicated
-- Supabase project this migration works unchanged.
--
-- Deliberately NO trigger on auth.users — in a shared database another app may
-- own that. Profiles are created app-side on first sign-in (see src/auth.js),
-- permitted by the xros_profiles_insert_self policy.

create extension if not exists pgcrypto;

-- ---- profiles ----
create table if not exists public.xros_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role text not null default 'consumer'
    check (role in ('consumer','creator','advertiser','moderator','admin')),
  created_at timestamptz not null default now()
);
alter table public.xros_profiles enable row level security;

-- role helpers (security definer so policies can read role without recursion)
create or replace function public.xros_current_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.xros_profiles where id = auth.uid()), 'guest');
$$;
create or replace function public.xros_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.xros_current_role() = 'admin';
$$;

-- lock role changes to admins only
create or replace function public.xros_prevent_role_escalation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not public.xros_is_admin() then
    raise exception 'insufficient_privilege: only admins may change role';
  end if;
  return new;
end;
$$;
drop trigger if exists xros_role_lock on public.xros_profiles;
create trigger xros_role_lock before update on public.xros_profiles
  for each row execute function public.xros_prevent_role_escalation();

drop policy if exists xros_profiles_select on public.xros_profiles;
create policy xros_profiles_select on public.xros_profiles for select to authenticated
  using (id = auth.uid() or public.xros_is_admin());
drop policy if exists xros_profiles_insert_self on public.xros_profiles;
create policy xros_profiles_insert_self on public.xros_profiles for insert to authenticated
  with check (id = auth.uid() and role = 'consumer');
drop policy if exists xros_profiles_update_own on public.xros_profiles;
create policy xros_profiles_update_own on public.xros_profiles for update to authenticated
  using (id = auth.uid() or public.xros_is_admin())
  with check (id = auth.uid() or public.xros_is_admin());

-- ---- apps (XR OS app store) ----
create table if not exists public.xros_apps (
  id uuid primary key default gen_random_uuid(),
  owner uuid references public.xros_profiles(id) on delete cascade,
  slug text unique,
  title text not null,
  description text,
  url text,
  thumbnail_url text,
  category text,
  status text not null default 'draft'
    check (status in ('draft','pending','published','rejected')),
  created_at timestamptz not null default now()
);
alter table public.xros_apps enable row level security;
create index if not exists xros_apps_status_idx on public.xros_apps(status);
drop policy if exists xros_apps_read_published on public.xros_apps;
create policy xros_apps_read_published on public.xros_apps for select
  using (status = 'published');
drop policy if exists xros_apps_owner_all on public.xros_apps;
create policy xros_apps_owner_all on public.xros_apps for all to authenticated
  using (owner = auth.uid() or public.xros_current_role() in ('moderator','admin'))
  with check (owner = auth.uid() or public.xros_current_role() in ('moderator','admin'));

-- ---- campaigns ----
create table if not exists public.xros_campaigns (
  id uuid primary key default gen_random_uuid(),
  advertiser uuid references public.xros_profiles(id) on delete cascade,
  name text not null,
  status text not null default 'draft'
    check (status in ('draft','active','paused','ended')),
  budget_cents bigint not null default 0,
  spend_cents bigint not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.xros_campaigns enable row level security;
create index if not exists xros_campaigns_advertiser_idx on public.xros_campaigns(advertiser);
drop policy if exists xros_campaigns_owner on public.xros_campaigns;
create policy xros_campaigns_owner on public.xros_campaigns for all to authenticated
  using (advertiser = auth.uid() or public.xros_is_admin())
  with check (advertiser = auth.uid() or public.xros_is_admin());

-- ---- ad creatives ----
create table if not exists public.xros_ad_creatives (
  id uuid primary key default gen_random_uuid(),
  campaign uuid references public.xros_campaigns(id) on delete cascade,
  format text not null default 'billboard'
    check (format in ('billboard','skybox','portal')),
  title text,
  body text,
  media_url text,
  click_url text,
  created_at timestamptz not null default now()
);
alter table public.xros_ad_creatives enable row level security;
create index if not exists xros_ad_creatives_campaign_idx on public.xros_ad_creatives(campaign);
drop policy if exists xros_creatives_owner on public.xros_ad_creatives;
create policy xros_creatives_owner on public.xros_ad_creatives for all to authenticated
  using (exists (select 1 from public.xros_campaigns c
                 where c.id = campaign and (c.advertiser = auth.uid() or public.xros_is_admin())))
  with check (exists (select 1 from public.xros_campaigns c
                 where c.id = campaign and (c.advertiser = auth.uid() or public.xros_is_admin())));
drop policy if exists xros_creatives_serve_active on public.xros_ad_creatives;
create policy xros_creatives_serve_active on public.xros_ad_creatives for select to authenticated
  using (exists (select 1 from public.xros_campaigns c
                 where c.id = campaign and c.status = 'active'));

-- ---- ad events ----
create table if not exists public.xros_ad_events (
  id bigint generated always as identity primary key,
  creative uuid references public.xros_ad_creatives(id) on delete cascade,
  event_type text not null check (event_type in ('impression','click')),
  user_id uuid references public.xros_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.xros_ad_events enable row level security;
create index if not exists xros_ad_events_creative_idx on public.xros_ad_events(creative);
drop policy if exists xros_events_insert on public.xros_ad_events;
create policy xros_events_insert on public.xros_ad_events for insert to authenticated
  with check (true);
drop policy if exists xros_events_owner_read on public.xros_ad_events;
create policy xros_events_owner_read on public.xros_ad_events for select to authenticated
  using (exists (select 1 from public.xros_ad_creatives cr
                 join public.xros_campaigns c on c.id = cr.campaign
                 where cr.id = creative and (c.advertiser = auth.uid() or public.xros_is_admin())));

-- ---- bookmarks ----
create table if not exists public.xros_bookmarks (
  id uuid primary key default gen_random_uuid(),
  owner uuid references public.xros_profiles(id) on delete cascade,
  title text,
  url text not null,
  created_at timestamptz not null default now()
);
alter table public.xros_bookmarks enable row level security;
create index if not exists xros_bookmarks_owner_idx on public.xros_bookmarks(owner);
drop policy if exists xros_bookmarks_owner on public.xros_bookmarks;
create policy xros_bookmarks_owner on public.xros_bookmarks for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
