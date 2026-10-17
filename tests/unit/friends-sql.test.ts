import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Static checks of the v6 friends migration (docs/friends-spec.md section 1). The behaviour itself is
// exercised against a real PostgreSQL by scripts/verify-friends-sql.sh.
const root = new URL('../../', import.meta.url);
const sql = readFileSync(new URL('frontend/supabase/migrations/20261017000000_em_time_friends.sql', root), 'utf8');
const v1 = readFileSync(new URL('frontend/supabase/migrations/20261015000000_em_time_sync.sql', root), 'utf8');

const API = [
  ['em_share_get', ''],
  ['em_share_enable', ''],
  ['em_share_rotate', ''],
  ['em_share_disable', ''],
  ['em_friend_add', 'text, text'],
  ['em_friend_rename', 'text, text'],
  ['em_friend_remove', 'text'],
  ['em_friends_week', 'date, date'],
] as const;
const HELPERS = [
  ['em_friend_code_new', ''],
  ['em_friend_code_norm', 'text'],
  ['em_friend_nickname', 'text'],
] as const;

/** The text of one `create or replace function public.<name>(` ... `$$;` block. */
function fn(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  const end = sql.indexOf('$$;', sql.indexOf('as $$', start));
  return sql.slice(start, end + 3);
}

describe('friends migration (static checks)', () => {
  it('is additive: the v1 migration is untouched and this one never alters or drops v1 objects', () => {
    expect(v1).not.toMatch(/friend/i);
    expect(sql).not.toMatch(/\bdrop\s+(table|function|trigger|policy)\b/i);
    expect(sql).not.toMatch(/\balter\s+table\s+public\.(categories|tasks|sessions|settings)\b/i);
    expect(sql).not.toMatch(/\bcreate\s+policy\b/i);
  });

  it.each(['friend_shares', 'friend_links'])('%s: RLS on, no policies, no client privileges', (t) => {
    expect(sql).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`));
    expect(sql).toMatch(/revoke all on public\.friend_shares, public\.friend_links from anon, authenticated;/);
    expect(sql).not.toMatch(new RegExp(`grant [^;]*on public\\.${t}`));
  });

  it('codes are constrained to 8 characters of Crockford base32 in both tables', () => {
    const checks = sql.match(/code !?~ '\^\[0-9A-HJKMNP-TV-Z\]\{8\}\$'/g) ?? [];
    expect(checks.length).toBeGreaterThanOrEqual(3); // two table checks and the add function
    expect(sql).toMatch(/code\s+text\s+not null unique check/);
    expect(sql).toMatch(/color\s+smallint\s+not null check \(color between 1 and 5\)/);
    expect(sql).toMatch(/unique \(user_id, color\)/);
    expect(sql).toMatch(/primary key \(user_id, code\)/);
    expect(sql).toMatch(/nickname is null or char_length\(nickname\) between 1 and 24/);
    expect(sql).toMatch(/user_id\s+uuid\s+primary key references auth\.users \(id\) on delete cascade/);
  });

  it.each([...API, ...HELPERS])('%s: security definer with an empty search_path', (name) => {
    const body = fn(name);
    expect(body).toMatch(/security definer/);
    expect(body).toMatch(/set search_path = ''/);
  });

  it.each(API)('%s: language plpgsql, starts with the signed-in check (42501)', (name) => {
    const body = fn(name);
    expect(body).toMatch(/language plpgsql/);
    const first = body.slice(body.indexOf('begin'));
    expect(first).toMatch(
      /^begin\s+if auth\.uid\(\) is null then raise exception 'not signed in' using errcode = '42501'; end if;/,
    );
  });

  it('every table reference in a function is schema qualified', () => {
    const bodies = [...API, ...HELPERS].map(([n]) => fn(n)).join('\n');
    expect(bodies).not.toMatch(/\b(from|join|into|update|delete from|insert into)\s+(friend_|sessions\b|settings\b)/);
    expect(bodies).toMatch(/public\.friend_shares/);
    expect(bodies).toMatch(/public\.sessions/);
    expect(bodies).toMatch(/public\.settings/);
  });

  it('the api functions are executable by authenticated only; the helpers by nobody', () => {
    for (const [n, args] of API) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${n}\\(${args}\\)\\s+from public, anon;`));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${n}\\(${args}\\)\\s+to authenticated;`));
    }
    for (const [n, args] of HELPERS) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${n}\\(${args}\\)\\s+from public, anon, authenticated;`));
      expect(sql).not.toMatch(new RegExp(`grant execute on function public\\.${n}\\b`));
    }
    const grants = sql.match(/^grant .*$/gm) ?? [];
    expect(grants).toHaveLength(API.length);
    for (const g of grants) expect(g).toMatch(/ to authenticated;$/);
    expect(sql).not.toMatch(/\bto (anon|public)\b/i);
  });

  it('generates codes from uuid bytes 0-5 and 9-10 with no pgcrypto and no random()', () => {
    const body = fn('em_friend_code_new');
    expect(body).toContain("'0123456789ABCDEFGHJKMNPQRSTVWXYZ'");
    expect(body).toContain('uuid_send(gen_random_uuid())');
    expect(body).toContain('array[0, 1, 2, 3, 4, 5, 9, 10]');
    expect(body).toMatch(/get_byte\(b, i\) % 32/);
    expect(sql).not.toMatch(/pgcrypto|gen_random_bytes|\brandom\(\)/);
  });

  it('em_friends_week validates the window, skips deleted sessions and exposes only the documented keys', () => {
    const body = fn('em_friends_week');
    expect(body).toMatch(/p_to < p_from or p_to - p_from > 13/);
    expect(body).toMatch(/errcode = '22023'/);
    expect(body).toMatch(/se\.deleted_at is null/);
    expect(body).toMatch(/se\.day between p_from and p_to/);
    expect(body).toMatch(/order by l\.created_at/);
    const keys = [...body.matchAll(/^\s+'(\w+)',/gm)].map((m) => m[1]);
    expect(keys).toEqual(['code', 'nickname', 'displayName', 'color', 'active', 'days']);
    expect(body).not.toMatch(/task_name|task_id|category_id|started_at|ended_at/);
  });

  it('the add function checks, in order: invalid, own code, duplicate, not found, limit', () => {
    const body = fn('em_friend_add');
    const order = ["return 'invalid'", "return 'own_code'", "return 'duplicate'", "return 'not_found'", "return 'limit'", "return 'ok'"].map(
      (s) => body.indexOf(s),
    );
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(body).toMatch(/pg_advisory_xact_lock/);
  });
});
