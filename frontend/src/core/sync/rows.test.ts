import { describe, expect, it } from 'vitest';
import { MIN, SYNCED_SETTINGS_KEYS } from '../constants';
import { createDefaultCategories, createDefaultSettings } from '../store/defaults';
import type { Category, Session, Task } from '../types';
import { fromRow, toRow } from './rows';

const UID = '9f1c2b3a-4d5e-4f60-8a7b-1c2d3e4f5a6b';
const cat: Category = {
  ...createDefaultCategories()[2]!,
  name: 'Problem sets',
  updatedAt: 1791990000123,
  createdAt: 5,
};
const task: Task = {
  id: '4b0e2f8a-77c2-4a8e-8b7d-2a3c1e9f0b11',
  name: 'Orgo chapter 7 problems',
  categoryId: cat.id,
  done: true,
  doneAt: 1791990100000,
  order: -3,
  createdAt: 1791950000000,
  updatedAt: 1791990100000,
  deletedAt: null,
};
const session: Session = {
  id: 'd2a9b6c4-0f3e-4d8a-9e21-01a13afb2520',
  startedAt: 1791990900000,
  endedAt: 1791992400000,
  day: '2026-10-14',
  tzOffsetMin: -420,
  plannedMs: 25 * MIN,
  focusedMs: 25 * MIN,
  taskId: task.id,
  taskName: task.name,
  categoryId: cat.id,
  createdAt: 1791992400000,
  updatedAt: 1791992400000,
  deletedAt: null,
};

describe('toRow / fromRow', () => {
  it('maps categories with order -> sort_order', () => {
    const row = toRow('categories', cat, UID);
    expect(row).toEqual({
      user_id: UID,
      id: cat.id,
      name: 'Problem sets',
      color: 3,
      sort_order: 2,
      created_at: 5,
      updated_at: 1791990000123,
      deleted_at: null,
    });
    expect(fromRow('categories', row)).toEqual(cat);
  });

  it('maps tasks, including done_at and tombstones', () => {
    const row = toRow('tasks', task, UID);
    expect(row).toMatchObject({
      category_id: cat.id,
      done: true,
      done_at: 1791990100000,
      sort_order: -3,
      deleted_at: null,
    });
    expect(fromRow('tasks', row)).toEqual(task);
    const dead = { ...task, deletedAt: 1791999999999, updatedAt: 1791999999999 };
    const deadRow = toRow('tasks', dead, UID);
    expect(deadRow.deleted_at).toBe(1791999999999);
    expect(fromRow('tasks', deadRow)).toEqual(dead);
  });

  it('maps sessions with an ISO date day and snake_case columns', () => {
    const row = toRow('sessions', session, UID);
    expect(row).toEqual({
      user_id: UID,
      id: session.id,
      started_at: 1791990900000,
      ended_at: 1791992400000,
      day: '2026-10-14',
      tz_offset_min: -420,
      planned_ms: 1_500_000,
      focused_ms: 1_500_000,
      task_id: task.id,
      task_name: task.name,
      category_id: cat.id,
      created_at: 1791992400000,
      updated_at: 1791992400000,
      deleted_at: null,
    });
    expect(Object.keys(row)).not.toContain('server_updated_at');
    expect(
      fromRow('sessions', { ...row, server_updated_at: '2026-10-14T15:40:00.123456+00:00', user_id: UID }),
    ).toEqual(session);
  });

  it('accepts bigint columns delivered as numeric strings', () => {
    const row = toRow('sessions', session, UID);
    const stringy = {
      ...row,
      started_at: String(row.started_at),
      ended_at: String(row.ended_at),
      updated_at: String(row.updated_at),
    };
    expect(fromRow('sessions', stringy)).toEqual(session);
  });

  it('round-trips settings as one jsonb object with only the synced keys', () => {
    const settings = {
      ...createDefaultSettings(),
      dailyGoalMin: 90,
      autoStart: false,
      theme: 'dark' as const,
      volume: 0.1,
      updatedAt: 1791991111111,
    };
    const row = toRow('settings', settings, UID);
    expect(Object.keys(row).sort()).toEqual(['data', 'updated_at', 'user_id']);
    expect(Object.keys(row.data as object).sort()).toEqual([...SYNCED_SETTINGS_KEYS].sort());
    expect(row.updated_at).toBe(1791991111111);
    const back = fromRow('settings', row)!;
    expect(back).toMatchObject({ dailyGoalMin: 90, autoStart: false, updatedAt: 1791991111111 });
    expect(back).not.toHaveProperty('theme');
    expect(back).not.toHaveProperty('volume');
  });

  it("returns only the settings keys the other device sent, clamped to this build's limits", () => {
    const back = fromRow('settings', {
      data: { dailyGoalMin: 5000, breakPrompts: false, rogue: 1 },
      updated_at: 7,
    })!;
    expect(back).toEqual({ dailyGoalMin: 720, breakPrompts: false, updatedAt: 7 });
  });

  it('returns null for invalid rows', () => {
    const ok = toRow('sessions', session, UID);
    expect(fromRow('sessions', { ...ok, id: 'not-a-uuid' })).toBeNull();
    expect(fromRow('sessions', { ...ok, ended_at: 1 })).toBeNull(); // ends before it starts
    expect(fromRow('sessions', { ...ok, focused_ms: (ok.planned_ms as number) + 1 })).toBeNull();
    expect(fromRow('tasks', { ...toRow('tasks', task, UID), name: '' })).toBeNull();
    expect(fromRow('categories', { ...toRow('categories', cat, UID), color: 9 })).toBeNull();
    expect(fromRow('settings', { data: 'nope', updated_at: 1 })).toBeNull();
    expect(fromRow('settings', { data: {}, updated_at: 'x' })).toBeNull();
  });
});
