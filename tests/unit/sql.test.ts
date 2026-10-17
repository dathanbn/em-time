import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const contract = readFileSync(new URL('docs/contract.md', root), 'utf8');
const migration = readFileSync(new URL('frontend/supabase/migrations/20261015000000_em_time_sync.sql', root), 'utf8');

function contractSql(): string {
  const s = contract.indexOf('## 10. SQL migration');
  const open = contract.indexOf('```sql\n', s) + '```sql\n'.length;
  const close = contract.indexOf('\n```', open);
  return contract.slice(open, close + 1);
}

describe('SYNC-10 migration (static checks)', () => {
  it('is byte-identical to contract.md section 10', () => {
    expect(migration).toBe(contractSql());
  });

  it.each(['categories', 'tasks', 'sessions', 'settings'])('%s: RLS enabled with select, insert and update policies and no delete policy', (t) => {
    expect(migration).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`));
    for (const verb of ['select', 'insert', 'update']) {
      expect(migration).toMatch(new RegExp(`create policy ${t}_${verb}_own on public\\.${t} for ${verb} to authenticated`));
    }
    expect(migration).not.toMatch(new RegExp(`on public\\.${t} for delete`));
  });

  it('policies never apply to anon and the grants exclude delete', () => {
    expect(migration).not.toMatch(/for \w+ to anon/);
    expect(migration).toMatch(/revoke all on .* from anon/);
    expect(migration).toMatch(/revoke delete, truncate on .* from authenticated/);
    expect(migration).not.toMatch(/grant [^;]*\bdelete\b/);
    expect(migration).not.toMatch(/using \(true\)|with check \(true\)/);
  });

  it('every policy compares auth.uid() with user_id', () => {
    const policies = migration.split('create policy').slice(1);
    expect(policies).toHaveLength(12);
    for (const p of policies) expect(p).toMatch(/\(select auth\.uid\(\)\) = user_id/);
  });

  it('LWW triggers exist on every table', () => {
    for (const t of ['categories', 'tasks', 'sessions', 'settings']) {
      expect(migration).toMatch(new RegExp(`create trigger ${t}_lww before insert or update on public\\.${t}`));
    }
  });
});
