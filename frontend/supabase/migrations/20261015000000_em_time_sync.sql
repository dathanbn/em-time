-- Em Time sync schema, v1
-- Local-first: clients generate UUIDs and epoch-ms timestamps; the server enforces
-- ownership (RLS) and last-write-wins (triggers). No hard deletes.

-- 1. Tables -----------------------------------------------------------------

create table if not exists public.categories (
  user_id           uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id                uuid        not null,
  name              text        not null check (char_length(name) between 1 and 30),
  color             smallint    not null check (color between 1 and 8),
  sort_order        integer     not null default 0,
  created_at        bigint      not null,
  updated_at        bigint      not null,
  deleted_at        bigint,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);

create table if not exists public.tasks (
  user_id           uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id                uuid        not null,
  name              text        not null check (char_length(name) between 1 and 80),
  category_id       uuid        not null,
  done              boolean     not null default false,
  done_at           bigint,
  sort_order        integer     not null default 0,
  created_at        bigint      not null,
  updated_at        bigint      not null,
  deleted_at        bigint,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);

create table if not exists public.sessions (
  user_id           uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id                uuid        not null,
  started_at        bigint      not null,
  ended_at          bigint      not null,
  day               date        not null,
  tz_offset_min     smallint    not null check (tz_offset_min between -840 and 840),
  planned_ms        integer     not null check (planned_ms > 0),
  focused_ms        integer     not null check (focused_ms >= 0 and focused_ms <= planned_ms),
  task_id           uuid,
  task_name         text        check (task_name is null or char_length(task_name) <= 80),
  category_id       uuid,
  created_at        bigint      not null,
  updated_at        bigint      not null,
  deleted_at        bigint,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, id),
  check (ended_at >= started_at)
);

create table if not exists public.settings (
  user_id           uuid        primary key default auth.uid() references auth.users (id) on delete cascade,
  data              jsonb       not null check (jsonb_typeof(data) = 'object'),
  updated_at        bigint      not null,
  server_updated_at timestamptz not null default clock_timestamp()
);

create index if not exists categories_pull_idx on public.categories (user_id, server_updated_at);
create index if not exists tasks_pull_idx      on public.tasks      (user_id, server_updated_at);
create index if not exists sessions_pull_idx   on public.sessions   (user_id, server_updated_at);

-- 2. Last-write-wins guards -------------------------------------------------

create or replace function public.em_lww_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  server_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  -- a device with a fast clock cannot claim the future
  if new.updated_at > server_ms + 600000 then
    new.updated_at := server_ms;
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id then
      raise exception 'user_id is immutable';
    end if;
    -- older write loses: keep the stored row unchanged
    if new.updated_at < old.updated_at then
      return null;
    end if;
    -- tie: only a new tombstone over a live row is applied; otherwise no-op
    if new.updated_at = old.updated_at
       and not (new.deleted_at is not null and old.deleted_at is null) then
      return null;
    end if;
  end if;

  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

create or replace function public.em_lww_guard_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  server_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if new.updated_at > server_ms + 600000 then
    new.updated_at := server_ms;
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id then
      raise exception 'user_id is immutable';
    end if;
    if new.updated_at <= old.updated_at then
      return null;
    end if;
  end if;

  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists categories_lww on public.categories;
create trigger categories_lww before insert or update on public.categories
  for each row execute function public.em_lww_guard();

drop trigger if exists tasks_lww on public.tasks;
create trigger tasks_lww before insert or update on public.tasks
  for each row execute function public.em_lww_guard();

drop trigger if exists sessions_lww on public.sessions;
create trigger sessions_lww before insert or update on public.sessions
  for each row execute function public.em_lww_guard();

drop trigger if exists settings_lww on public.settings;
create trigger settings_lww before insert or update on public.settings
  for each row execute function public.em_lww_guard_settings();

-- 3. Row level security: own rows only, no deletes --------------------------

alter table public.categories enable row level security;
alter table public.tasks      enable row level security;
alter table public.sessions   enable row level security;
alter table public.settings   enable row level security;

create policy categories_select_own on public.categories for select to authenticated
  using ((select auth.uid()) = user_id);
create policy categories_insert_own on public.categories for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy categories_update_own on public.categories for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy tasks_select_own on public.tasks for select to authenticated
  using ((select auth.uid()) = user_id);
create policy tasks_insert_own on public.tasks for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy tasks_update_own on public.tasks for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy sessions_select_own on public.sessions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy sessions_insert_own on public.sessions for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy sessions_update_own on public.sessions for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy settings_select_own on public.settings for select to authenticated
  using ((select auth.uid()) = user_id);
create policy settings_insert_own on public.settings for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy settings_update_own on public.settings for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- 4. Grants: anon gets nothing; authenticated cannot delete ------------------

revoke all on public.categories, public.tasks, public.sessions, public.settings from anon;
revoke delete, truncate on public.categories, public.tasks, public.sessions, public.settings from authenticated;
grant select, insert, update on public.categories, public.tasks, public.sessions, public.settings to authenticated;
