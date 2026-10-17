-- Verifies the v1 sync migration and the v6 friends migration against a plain PostgreSQL with a
-- stub Supabase auth layer. Run by scripts/verify-friends-sql.sh. Every check prints "ok <name>";
-- the first failure stops the script (ON_ERROR_STOP).
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

-- ---- stub Supabase: roles, auth.users, auth.uid() from a GUC, default privileges --------------
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

\i frontend/supabase/migrations/20261015000000_em_time_sync.sql
\i frontend/supabase/migrations/20261017000000_em_time_friends.sql
-- the friends migration must be re-runnable
\i frontend/supabase/migrations/20261017000000_em_time_friends.sql

-- ---- test helpers (callable by everyone) -----------------------------------------------------
create schema t;
grant usage on schema t to public;
create function t.ok(name text, cond boolean) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL %', name; end if;
  raise notice 'ok %', name;
end $$;
create function t.eq(name text, got anyelement, want anyelement) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL %: got % want %', name, got, want; end if;
  raise notice 'ok %', name;
end $$;
-- runs sql as the current role and expects an error with this SQLSTATE
create function t.denied(name text, q text, state text) returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    if sqlstate = state then raise notice 'ok % (%)', name, state; return; end if;
    raise exception 'FAIL %: wrong error % %', name, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL %: no error', name;
end $$;
create function t.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), false);
end $$;
grant execute on all functions in schema t to public;

-- six users and a pile of data for them
insert into auth.users (id)
select ('00000000-0000-4000-8000-00000000000' || n)::uuid from generate_series(1, 7) n;
\set a '''00000000-0000-4000-8000-000000000001'''
\set b '''00000000-0000-4000-8000-000000000002'''
\set c '''00000000-0000-4000-8000-000000000003'''
\set d '''00000000-0000-4000-8000-000000000004'''

-- ---- 1. catalog: RLS, no policies, no table privileges, function flags and grants --------------
select t.eq('rls on friend_shares', (select relrowsecurity from pg_class where oid = 'public.friend_shares'::regclass), true);
select t.eq('rls on friend_links',  (select relrowsecurity from pg_class where oid = 'public.friend_links'::regclass), true);
select t.eq('no policies on the friends tables',
  (select count(*) from pg_policies where tablename in ('friend_shares', 'friend_links')), 0::bigint);
select t.eq('anon and authenticated have no table privileges',
  (select count(*) from information_schema.role_table_grants
    where table_name in ('friend_shares', 'friend_links') and grantee in ('anon', 'authenticated', 'PUBLIC')), 0::bigint);
select t.eq('every em_ friends function is security definer with an empty search_path',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'em\_share\_%' or p.proname like 'em\_friend%')
      and p.prosecdef and p.proconfig = array['search_path=""']), 11::bigint);
select t.eq('eleven friends functions exist (eight api, three helpers)',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'em\_share\_%' or p.proname like 'em\_friend%')), 11::bigint);
select t.eq('authenticated can execute the eight api functions',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('em_share_get','em_share_enable','em_share_rotate','em_share_disable',
                      'em_friend_add','em_friend_rename','em_friend_remove','em_friends_week')
    and has_function_privilege('authenticated', p.oid, 'execute')), 8::bigint);
select t.eq('anon can execute none of the friends functions',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
    and (p.proname like 'em\_share\_%' or p.proname like 'em\_friend%')
    and has_function_privilege('anon', p.oid, 'execute')), 0::bigint);
select t.eq('PUBLIC can execute none of the friends functions',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
    and (p.proname like 'em\_share\_%' or p.proname like 'em\_friend%')
    and has_function_privilege('public', p.oid, 'execute')), 0::bigint);
select t.eq('authenticated cannot execute the helpers',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('em_friend_code_new', 'em_friend_code_norm', 'em_friend_nickname')
    and has_function_privilege('authenticated', p.oid, 'execute')), 0::bigint);

-- ---- 2. generated codes -------------------------------------------------------------------
select t.eq('2000 generated codes all match the format',
  (select count(*) from generate_series(1, 2000) g where public.em_friend_code_new() ~ '^[0-9A-HJKMNP-TV-Z]{8}$'), 2000::bigint);
select t.ok('generated codes use the whole alphabet and do not repeat',
  (select count(distinct ch) = 32 from (select regexp_split_to_table(string_agg(public.em_friend_code_new(), ''), '') ch from generate_series(1, 400)) s)
  and (select count(distinct c) = 1000 from (select public.em_friend_code_new() c from generate_series(1, 1000)) s));
select t.eq('normalize: case, dashes, spaces, O to 0, I and L to 1',
  public.em_friend_code_norm(' lolo-ozzz '), '10100ZZZ');
select t.eq('normalize drops non-ASCII (no sharp-s expansion)', public.em_friend_code_norm(U&'ab\00dfcd'), 'ABCD');

-- ---- 3. signed out and anon ---------------------------------------------------------------
set role authenticated;
select t.as_user(null);
select t.denied('signed-out em_share_get',    'select public.em_share_get()', '42501');
select t.denied('signed-out em_share_enable', 'select public.em_share_enable()', '42501');
select t.denied('signed-out em_friend_add',   $$select public.em_friend_add('ABCDEFGH', null)$$, '42501');
select t.denied('signed-out em_friends_week', $$select public.em_friends_week(current_date, current_date)$$, '42501');
set role anon;
select t.denied('anon em_share_get has no execute', 'select public.em_share_get()', '42501');
select t.denied('anon em_friends_week has no execute', $$select public.em_friends_week(current_date, current_date)$$, '42501');
select t.denied('anon cannot read friend_shares', 'select * from public.friend_shares', '42501');
reset role;

-- ---- 4. direct table access is denied ---------------------------------------------------------
set role authenticated;
select t.as_user(:a);
select t.denied('authenticated cannot select friend_shares', 'select * from public.friend_shares', '42501');
select t.denied('authenticated cannot select friend_links',  'select * from public.friend_links', '42501');
select t.denied('authenticated cannot insert friend_shares', $$insert into public.friend_shares (user_id, code) values (auth.uid(), 'ABCDEFGH')$$, '42501');
select t.denied('authenticated cannot insert friend_links',  $$insert into public.friend_links (user_id, code, color) values (auth.uid(), 'ABCDEFGH', 1)$$, '42501');
select t.denied('authenticated cannot update friend_shares', $$update public.friend_shares set code = 'ABCDEFGH'$$, '42501');
select t.denied('authenticated cannot delete friend_links',  'delete from public.friend_links', '42501');
reset role;

-- ---- 5. sharing -------------------------------------------------------------------------------
set role authenticated;
select t.as_user(:a);
select t.eq('share_get is null before enabling', public.em_share_get(), null::text);
create temp table codes as select 'a'::text who, public.em_share_enable() code;
select t.ok('enable returns a well-formed code', (select code ~ '^[0-9A-HJKMNP-TV-Z]{8}$' from codes where who = 'a'));
select t.eq('enable twice returns the same code', public.em_share_enable(), (select code from codes where who = 'a'));
select t.eq('share_get returns it', public.em_share_get(), (select code from codes where who = 'a'));
select t.as_user(:b);
insert into codes select 'b', public.em_share_enable();
select t.as_user(:c);
insert into codes select 'c', public.em_share_enable();
select t.ok('three users have three different codes', (select count(distinct code) = 3 from codes));
select t.as_user(:d);
select t.eq('a user cannot see another user''s share', public.em_share_get(), null::text);
reset role;

-- ---- 6. adding friends -------------------------------------------------------------------------
set role authenticated;
select t.as_user(:a);
select t.eq('add: too short',        public.em_friend_add('ABC', null), 'invalid');
select t.eq('add: empty',            public.em_friend_add('', null), 'invalid');
select t.eq('add: null',             public.em_friend_add(null, null), 'invalid');
select t.eq('add: U is not in the alphabet', public.em_friend_add('UUUUUUUU', null), 'invalid');
select t.eq('add: nine characters', public.em_friend_add('ABCDEFGHJ', null), 'invalid');
select t.eq('add: own code',         public.em_friend_add((select code from codes where who = 'a'), null), 'own_code');
select t.eq('add: own code, dashed and lower case',
  public.em_friend_add(lower(substr((select code from codes where who = 'a'), 1, 4) || '-' || substr((select code from codes where who = 'a'), 5)), null), 'own_code');
select t.eq('add: nobody has this code', public.em_friend_add('ZZZZZZZZ', null), 'not_found');
select t.eq('add: friend B, nickname trimmed', public.em_friend_add(' ' || (select code from codes where who = 'b') || ' ', E'  Bee \t'), 'ok');
select t.eq('add: duplicate',        public.em_friend_add((select code from codes where who = 'b'), null), 'duplicate');
select t.eq('add: friend C with a long multibyte nickname', public.em_friend_add((select code from codes where who = 'c'), repeat(E'\U0001F600', 30)), 'ok');
reset role;
select t.eq('first friend got color 1', (select color from public.friend_links where user_id = :a and code = (select code from codes where who = 'b')), 1::smallint);
select t.eq('second friend got color 2', (select color from public.friend_links where user_id = :a and code = (select code from codes where who = 'c')), 2::smallint);
select t.eq('nickname trimmed', (select nickname from public.friend_links where user_id = :a and code = (select code from codes where who = 'b')), 'Bee');
select t.eq('nickname cut to 24 code points', (select char_length(nickname) from public.friend_links where user_id = :a and code = (select code from codes where who = 'c')), 24);

-- rename: trim, empty clears, normalizes the code
set role authenticated;
select t.as_user(:a);
select public.em_friend_rename(lower((select code from codes where who = 'b')), '  Bea  ');
reset role;
select t.eq('rename trims', (select nickname from public.friend_links where user_id = :a and code = (select code from codes where who = 'b')), 'Bea');
set role authenticated;
select t.as_user(:a);
select public.em_friend_rename((select code from codes where who = 'b'), '   ');
reset role;
select t.eq('rename to blank clears the nickname', (select nickname from public.friend_links where user_id = :a and code = (select code from codes where who = 'b')), null::text);
set role authenticated;
select t.as_user(:a);
select public.em_friend_rename('ZZZZZZZZ', 'Nobody'); -- no such link: no error
-- remove frees the lowest color, which the next friend takes
select public.em_friend_remove((select code from codes where who = 'b'));
reset role;
select t.eq('remove deleted the link', (select count(*) from public.friend_links where user_id = :a), 1::bigint);

-- the limit: friends 3..7 (users 4..7 plus b again); a sixth is refused
insert into public.friend_shares (user_id, code)
select ('00000000-0000-4000-8000-00000000000' || n)::uuid, 'DDDD000' || n from generate_series(4, 7) n;
set role authenticated;
select t.as_user(:a);
select t.eq('re-add B gets the free color 1', public.em_friend_add((select code from codes where who = 'b'), 'B again'), 'ok');
select t.eq('add 3', public.em_friend_add('DDDD0004', null), 'ok');
select t.eq('add 4', public.em_friend_add('DDDD0005', null), 'ok');
select t.eq('add 5', public.em_friend_add('DDDD0006', null), 'ok');
select t.eq('add 6 is over the limit', public.em_friend_add('DDDD0007', null), 'limit');
select t.eq('a duplicate at the limit is still reported as duplicate', public.em_friend_add('DDDD0004', null), 'duplicate');
select t.eq('an unknown code at the limit is reported as not_found', public.em_friend_add('ZZZZZZZZ', null), 'not_found');
reset role;
select t.eq('five links, colors 1..5 each once', (select array_agg(color order by color) from public.friend_links where user_id = :a), array[1,2,3,4,5]::smallint[]);

-- ---- 7. the week --------------------------------------------------------------------------------
-- B: sessions in and out of the window, a deleted one, two on one day; settings with a name.
insert into public.settings (user_id, data, updated_at) values (:b, '{"displayName":"Bea"}', 1);
insert into public.sessions (user_id, id, started_at, ended_at, day, tz_offset_min, planned_ms, focused_ms, task_id, task_name, category_id, created_at, updated_at, deleted_at)
values
 (:b, gen_random_uuid(), 1, 2, '2026-10-12', -420, 1500000, 1500000, null, 'secret task', null, 1, 1, null),
 (:b, gen_random_uuid(), 1, 2, '2026-10-12', -420, 1500000, 600000,  null, null, null, 1, 1, null),
 (:b, gen_random_uuid(), 1, 2, '2026-10-14', -420, 1500000, 900000,  null, null, null, 1, 1, null),
 (:b, gen_random_uuid(), 1, 2, '2026-10-13', -420, 1500000, 1500000, null, null, null, 1, 1, 5),
 (:b, gen_random_uuid(), 1, 2, '2026-10-07', -420, 1500000, 1500000, null, null, null, 1, 1, null),
 (:b, gen_random_uuid(), 1, 2, '2026-10-15', -420, 1500000, 1500000, null, null, null, 1, 1, null),
 (:a, gen_random_uuid(), 1, 2, '2026-10-12', -420, 1500000, 1500000, null, null, null, 1, 1, null);
create temp table wk as
  select public.em_friends_week('2026-10-08', '2026-10-14') j
  from (select set_config('request.jwt.claim.sub', :a, false)) x;
-- (the call above ran as the owner with the GUC set; auth.uid() reads the GUC)
select t.eq('five entries', jsonb_array_length((select j from wk)), 5);
select t.eq('entry order is by when I added them (B again was added after C)',
  (select array_agg(e ->> 'code' order by ord) from wk, jsonb_array_elements(j) with ordinality x(e, ord)),
  array[(select code from codes where who = 'c'), (select code from codes where who = 'b'), 'DDDD0004', 'DDDD0005', 'DDDD0006']);
select t.eq('B: days sum per study day, deleted and out-of-window sessions left out',
  (select e -> 'days' from wk, jsonb_array_elements(j) e where e ->> 'code' = (select code from codes where who = 'b')),
  '{"2026-10-12": 2100000, "2026-10-14": 900000}'::jsonb);
select t.eq('B: display name, nickname, color, active',
  (select (e - 'days' - 'code') from wk, jsonb_array_elements(j) e where e ->> 'code' = (select code from codes where who = 'b')),
  '{"color": 1, "active": true, "nickname": "B again", "displayName": "Bea"}'::jsonb);
select t.eq('only the six documented keys leave the server',
  (select array_agg(k order by k) from (select distinct jsonb_object_keys(e) k from wk, jsonb_array_elements(j) e) s),
  array['active','code','color','days','displayName','nickname']);
select t.eq('a friend with no settings row has a null display name',
  (select e -> 'displayName' from wk, jsonb_array_elements(j) e where e ->> 'code' = 'DDDD0004'), 'null'::jsonb);
select t.eq('a friend with no sessions has empty days',
  (select e -> 'days' from wk, jsonb_array_elements(j) e where e ->> 'code' = 'DDDD0004'), '{}'::jsonb);
select t.ok('nothing about task names appears in the result', (select position('secret' in j::text) = 0 from wk));

set role authenticated;
select t.as_user(:a);
select t.eq('as authenticated: same answer through the real grants',
  (select jsonb_array_length(public.em_friends_week('2026-10-08', '2026-10-14'))), 5);
select t.eq('window of 14 days is allowed (13 days apart)', jsonb_typeof(public.em_friends_week('2026-10-01', '2026-10-14')), 'array');
select t.denied('window of 15 days is refused', $$select public.em_friends_week('2026-10-01', '2026-10-15')$$, '22023');
select t.denied('to before from is refused', $$select public.em_friends_week('2026-10-14', '2026-10-13')$$, '22023');
select t.denied('null window is refused', $$select public.em_friends_week(null, '2026-10-13')$$, '22023');
select t.eq('one-day window works', jsonb_typeof(public.em_friends_week('2026-10-12', '2026-10-12')), 'array');
select t.eq('a user with no friends gets an empty array', (select public.em_friends_week('2026-10-12', '2026-10-12') from (select t.as_user(:d)) x), '[]'::jsonb);
reset role;

-- two users see each other: B adds A
set role authenticated;
select t.as_user(:b);
select t.eq('B adds A', public.em_friend_add((select code from codes where who = 'a'), 'Ay'), 'ok');
select t.eq('B sees only A, with A''s minutes (not their own)',
  (select e -> 'days' from jsonb_array_elements(public.em_friends_week('2026-10-08', '2026-10-14')) e), '{"2026-10-12": 1500000}'::jsonb);
select t.eq('B has one friend', jsonb_array_length(public.em_friends_week('2026-10-08', '2026-10-14')), 1);
select t.eq('B cannot read A''s sessions directly (sync RLS)', (select count(*) from public.sessions where user_id = :a), 0::bigint);
reset role;

-- ---- 8. rotate and disable ---------------------------------------------------------------------
set role authenticated;
select t.as_user(:b);
create temp table rot as select public.em_share_rotate() code;
select t.ok('rotate gives a new well-formed code', (select code ~ '^[0-9A-HJKMNP-TV-Z]{8}$' and code <> (select code from codes where who = 'b') from rot));
select t.eq('share_get shows the new code', public.em_share_get(), (select code from rot));
select t.as_user(:a);
select t.eq('A now sees B as inactive with no days and no name',
  (select e - 'code' - 'nickname' from jsonb_array_elements(public.em_friends_week('2026-10-08', '2026-10-14')) e where e ->> 'code' = (select code from codes where who = 'b')),
  '{"color": 1, "active": false, "days": {}, "displayName": null}'::jsonb);
select t.eq('A cannot add B''s old code any more as new, it is just a dead link (duplicate)', public.em_friend_add((select code from codes where who = 'b'), null), 'duplicate');
select public.em_friend_remove((select code from codes where who = 'b'));
select t.eq('removed dead link; old code is not_found now', public.em_friend_add((select code from codes where who = 'b'), null), 'not_found');
select t.eq('A adds B''s new code', public.em_friend_add((select code from rot), null), 'ok');
select t.as_user(:b);
select public.em_share_disable();
select t.eq('disable clears the share', public.em_share_get(), null::text);
select t.as_user(:a);
select t.eq('A sees B inactive again',
  (select (e ->> 'active')::boolean from jsonb_array_elements(public.em_friends_week('2026-10-08', '2026-10-14')) e where e ->> 'code' = (select code from rot)), false);
select t.as_user(:b);
select t.eq('B turns sharing on again: a different code', public.em_share_enable() <> (select code from rot), true);
select t.as_user(:a);
select t.eq('the old link stays inactive after re-enabling',
  (select (e ->> 'active')::boolean from jsonb_array_elements(public.em_friends_week('2026-10-08', '2026-10-14')) e where e ->> 'code' = (select code from rot)), false);
reset role;

-- ---- 9. cascade --------------------------------------------------------------------------------
delete from auth.users where id = :a;
select t.eq('deleting a user removes their share and links',
  (select count(*) from public.friend_shares where user_id = :a) + (select count(*) from public.friend_links where user_id = :a), 0::bigint);
select t.eq('B keeps a (now dead) link to the deleted user''s code',
  (select count(*) from public.friend_links where user_id = :b), 1::bigint);
select 'ALL CHECKS PASSED';
