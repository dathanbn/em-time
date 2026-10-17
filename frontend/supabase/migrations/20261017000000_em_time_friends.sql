-- Em Time friends schema, v6
-- Additive only: the v1 sync migration is untouched. A signed-in user can share a read-only
-- friend code and add up to 5 friends' codes. Friends see only a display name and focused
-- minutes per study day. The friend code is NOT the sync code and cannot open or change data.
-- All access goes through the em_* functions below; the tables have RLS on and no policies.

-- 1. Tables -----------------------------------------------------------------

-- one row per user who shares; code is 8 chars of Crockford base32 (no I, L, O, U)
create table if not exists public.friend_shares (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  code       text        not null unique check (code ~ '^[0-9A-HJKMNP-TV-Z]{8}$'),
  created_at timestamptz not null default now()
);

-- the caller's list of friends' codes (max 5, enforced in em_friend_add)
create table if not exists public.friend_links (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  code       text        not null check (code ~ '^[0-9A-HJKMNP-TV-Z]{8}$'),
  nickname   text        check (nickname is null or char_length(nickname) between 1 and 24),
  color      smallint    not null check (color between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (user_id, code),
  unique (user_id, color)
);

-- 2. Row level security: no policies, no direct access ------------------------

alter table public.friend_shares enable row level security;
alter table public.friend_links  enable row level security;

revoke all on public.friend_shares, public.friend_links from anon, authenticated;

-- 3. Helpers (not callable by clients) ----------------------------------------

-- a fresh code from bytes 0-5 and 9-10 of a random uuid (bytes 6 and 8 carry version and variant bits)
create or replace function public.em_friend_code_new()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  b   bytea := uuid_send(gen_random_uuid());
  pos int[] := array[0, 1, 2, 3, 4, 5, 9, 10];
  v_out text := '';
  i   int;
begin
  foreach i in array pos loop
    v_out := v_out || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
  end loop;
  return v_out;
end;
$$;

-- upper case, keep only ASCII letters and digits, O to 0, I and L to 1 (same as the app)
create or replace function public.em_friend_code_norm(p_code text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select translate(upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g')), 'OIL', '011');
$$;

-- trim, empty becomes null, cut to 24 code points (same as the app)
create or replace function public.em_friend_nickname(p_nickname text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select nullif(left(nullif(btrim(coalesce(p_nickname, ''), E' \t\n\r\f\v'), ''), 24), '');
$$;

-- 4. Sharing: my own code ------------------------------------------------------

create or replace function public.em_share_get()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  return (select s.code from public.friend_shares s where s.user_id = v_uid);
end;
$$;

create or replace function public.em_share_enable()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_code text;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select s.code into v_code from public.friend_shares s where s.user_id = v_uid;
  if v_code is not null then return v_code; end if;
  loop
    begin
      insert into public.friend_shares (user_id, code)
      values (v_uid, public.em_friend_code_new())
      returning code into v_code;
      return v_code;
    exception when unique_violation then
      -- another request enabled sharing for this user, or the new code is taken: look, then retry
      select s.code into v_code from public.friend_shares s where s.user_id = v_uid;
      if v_code is not null then return v_code; end if;
    end;
  end loop;
end;
$$;

create or replace function public.em_share_rotate()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_code text;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  loop
    begin
      insert into public.friend_shares (user_id, code)
      values (v_uid, public.em_friend_code_new())
      on conflict (user_id) do update set code = excluded.code, created_at = now()
      returning code into v_code;
      return v_code;
    exception when unique_violation then
      null; -- the new code is taken by someone else: draw another
    end;
  end loop;
end;
$$;

create or replace function public.em_share_disable()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  delete from public.friend_shares s where s.user_id = auth.uid();
end;
$$;

-- 5. Friends: the codes I follow -------------------------------------------------

-- 'ok', 'invalid', 'own_code', 'duplicate', 'not_found' or 'limit' (checked in that order)
create or replace function public.em_friend_add(p_code text, p_nickname text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_code  text;
  v_color int;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  v_code := public.em_friend_code_norm(p_code);
  if v_code !~ '^[0-9A-HJKMNP-TV-Z]{8}$' then return 'invalid'; end if;
  -- one add at a time per user, so the limit and the colors cannot race
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  if exists (select 1 from public.friend_shares s where s.user_id = v_uid and s.code = v_code) then
    return 'own_code';
  end if;
  if exists (select 1 from public.friend_links l where l.user_id = v_uid and l.code = v_code) then
    return 'duplicate';
  end if;
  if not exists (select 1 from public.friend_shares s where s.code = v_code) then
    return 'not_found';
  end if;
  select min(c) into v_color
    from generate_series(1, 5) c
   where not exists (select 1 from public.friend_links l where l.user_id = v_uid and l.color = c);
  if v_color is null then return 'limit'; end if;
  insert into public.friend_links (user_id, code, nickname, color)
  values (v_uid, v_code, public.em_friend_nickname(p_nickname), v_color);
  return 'ok';
end;
$$;

create or replace function public.em_friend_rename(p_code text, p_nickname text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  update public.friend_links l
     set nickname = public.em_friend_nickname(p_nickname)
   where l.user_id = auth.uid() and l.code = public.em_friend_code_norm(p_code);
end;
$$;

create or replace function public.em_friend_remove(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  delete from public.friend_links l
   where l.user_id = auth.uid() and l.code = public.em_friend_code_norm(p_code);
end;
$$;

-- 6. Friends' minutes ------------------------------------------------------------

-- [{ code, nickname, displayName, color, active, days: { 'YYYY-MM-DD': focusedMs } }], oldest friend first.
-- Only a display name and focused milliseconds per study day leave the friend's account: never task
-- names, categories or times of day. A friend whose code is off or replaced is inactive with no days.
create or replace function public.em_friends_week(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 13 then
    raise exception 'bad date window' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'code',        l.code,
        'nickname',    l.nickname,
        'displayName', case when s.user_id is null then null else st.data ->> 'displayName' end,
        'color',       l.color,
        'active',      s.user_id is not null,
        'days',        case when s.user_id is null then '{}'::jsonb else coalesce((
                         select jsonb_object_agg(to_char(d.day, 'YYYY-MM-DD'), d.ms)
                           from (
                             select se.day, sum(se.focused_ms)::bigint as ms
                               from public.sessions se
                              where se.user_id = s.user_id
                                and se.deleted_at is null
                                and se.day between p_from and p_to
                              group by se.day
                           ) d
                       ), '{}'::jsonb) end
      )
      order by l.created_at, l.color
    )
    from public.friend_links l
    left join public.friend_shares s on s.code = l.code
    left join public.settings st on st.user_id = s.user_id
    where l.user_id = v_uid
  ), '[]'::jsonb);
end;
$$;

-- 7. Grants: signed-in users only, helpers for nobody -------------------------------

revoke all on function public.em_friend_code_new()           from public, anon, authenticated;
revoke all on function public.em_friend_code_norm(text)      from public, anon, authenticated;
revoke all on function public.em_friend_nickname(text)       from public, anon, authenticated;

revoke all on function public.em_share_get()                 from public, anon;
revoke all on function public.em_share_enable()              from public, anon;
revoke all on function public.em_share_rotate()              from public, anon;
revoke all on function public.em_share_disable()             from public, anon;
revoke all on function public.em_friend_add(text, text)      from public, anon;
revoke all on function public.em_friend_rename(text, text)   from public, anon;
revoke all on function public.em_friend_remove(text)         from public, anon;
revoke all on function public.em_friends_week(date, date)    from public, anon;

grant execute on function public.em_share_get()               to authenticated;
grant execute on function public.em_share_enable()            to authenticated;
grant execute on function public.em_share_rotate()            to authenticated;
grant execute on function public.em_share_disable()           to authenticated;
grant execute on function public.em_friend_add(text, text)    to authenticated;
grant execute on function public.em_friend_rename(text, text) to authenticated;
grant execute on function public.em_friend_remove(text)       to authenticated;
grant execute on function public.em_friends_week(date, date)  to authenticated;
