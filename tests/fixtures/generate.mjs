/* global console */
// Regenerates the QA fixtures deterministically: `node tests/fixtures/generate.mjs`.
// All timestamps are built from Date.UTC with the PDT offset (-420), so the output is the same
// on every machine. Dates run 2026-06-17 .. 2026-10-14 (all inside daylight time).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const MIN = 60_000;
const DEVICE = 'd2a9b6c4-0f3e-4d8a-9e21-5c7b8a6d4e33';
const CATS = [
  ['5e5e0000-0000-4000-8000-000000000001', 'Study', 1],
  ['5e5e0000-0000-4000-8000-000000000002', 'Reading', 2],
  ['5e5e0000-0000-4000-8000-000000000003', 'Problem sets', 3],
  ['5e5e0000-0000-4000-8000-000000000004', 'Writing', 4],
  ['5e5e0000-0000-4000-8000-000000000005', 'Review', 5],
];
const T = (n) => `4b0e2f8a-77c2-4a8e-8b7d-2a3c1e9f0b${String(n).padStart(2, '0')}`;
const TASKS = [
  [T(11), 'Orgo chapter 7 problems', 0, false, 3],
  [T(12), 'Read The Selfish Gene', 1, false, 2],
  [T(13), 'Lab report draft', 2, false, 4],
  [T(14), 'Flashcards: metabolism', 0, true, 5],
  [T(15), 'Old essay outline', 3, false, 4], // tombstoned below
];

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261014);
const pad = (n, w = 2) => String(n).padStart(w, '0');
const dayStr = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const sessionId = (startedAt) => DEVICE.slice(0, 24) + startedAt.toString(16).padStart(12, '0');
const utcOfLocal = (y, m, d, h, mi, offsetMin = -420) => Date.UTC(y, m - 1, d, h, mi) - offsetMin * MIN;

function session(y, m, d, h, mi, taskIdx, plannedMin = 25) {
  const startedAt = utcOfLocal(y, m, d, h, mi);
  const task = taskIdx === null ? null : TASKS[taskIdx];
  const hourForDay = h < 6 ? -1 : 0; // study day: wall clock hour below 6 is the previous date
  const calendar = new Date(Date.UTC(y, m - 1, d + hourForDay));
  const endedAt = startedAt + plannedMin * MIN;
  return {
    id: sessionId(startedAt),
    startedAt, endedAt,
    day: dayStr(calendar.getTime()),
    tzOffsetMin: -420,
    plannedMs: plannedMin * MIN, focusedMs: plannedMin * MIN,
    taskId: task ? task[0] : null,
    taskName: task ? task[1] : null,
    categoryId: task ? CATS[task[2]][0] : null,
    createdAt: endedAt, updatedAt: endedAt, deletedAt: null,
  };
}

function baseDoc() {
  return {
    app: 'em-time',
    schemaVersion: 1,
    exportedAt: utcOfLocal(2026, 10, 14, 20, 0),
    settings: {
      preset: '25/5', focusMin: 25, shortMin: 5, longMin: 15, longEvery: 4, autoStart: true,
      dailyGoalMin: 120, weekStartsOn: 1, breakPrompts: true, encouragement: true, updatedAt: 0,
      theme: 'light', chime: 'glass', volume: 0.6, notifications: true, keepAwake: true,
    },
    categories: CATS.map(([id, name, color], i) => ({ id, name, color, order: i, createdAt: 0, updatedAt: 0, deletedAt: null })),
    tasks: TASKS.map(([id, name, cat, done], i) => ({
      id, name, categoryId: CATS[cat][0], done, doneAt: done ? utcOfLocal(2026, 10, 10, 12, 0) : null, order: i,
      createdAt: utcOfLocal(2026, 9, 1, 9, 0), updatedAt: utcOfLocal(2026, 9, 1, 9, 0),
      deletedAt: i === 4 ? utcOfLocal(2026, 10, 1, 9, 0) : null,
    })),
    sessions: [],
    timer: { phase: 'focus', status: 'idle', plannedMs: 25 * MIN, remainingMs: 25 * MIN, endsAt: null, phaseStartedAt: null, cycle: 0, updatedAt: 0 },
    meta: {
      deviceId: DEVICE, createdAt: utcOfLocal(2026, 6, 17, 8, 0), currentTaskId: null, lastCategoryId: null,
      milestonesShown: [], lastExportAt: null, exportReminderSnoozedUntil: null, notificationPromptedAt: null,
      persistRequestedAt: null, bags: { messages: [], prompts: [] },
      sync: {
        userId: null, email: null, lastUserId: null,
        cursors: { categories: null, tasks: null, sessions: null, settings: null },
        dirty: { categories: [], tasks: [], sessions: [], settings: false },
        lastSyncedAt: null, rejected: 0,
      },
    },
  };
}

// ---- backup-valid.json: 120 days ------------------------------------------------------------
const valid = baseDoc();
const skip = new Set(['2026-10-06', '2026-09-10', '2026-09-11', '2026-07-30']);
for (let d = 24; d <= 30; d++) skip.add(`2026-08-${pad(d)}`); // one fully empty week (Mon 24 to Sun 30)
const start = Date.UTC(2026, 5, 17);
for (let i = 0; i < 120; i++) {
  const t = new Date(start + i * 86_400_000);
  const y = t.getUTCFullYear(), m = t.getUTCMonth() + 1, d = t.getUTCDate();
  const key = `${y}-${pad(m)}-${pad(d)}`;
  if (skip.has(key)) continue;
  if (key < '2026-10-07' && rnd() < 0.18) continue;
  const count = key === '2026-10-14' ? 3 : 1 + Math.floor(rnd() * 5);
  for (let k = 0; k < count; k++) {
    const mins = 8 * 60 + 30 + k * 45;
    const r1 = rnd();
    const taskIdx = r1 < 0.15 ? null : r1 < 0.22 ? 4 : Math.floor(rnd() * 4);
    valid.sessions.push(session(y, m, d, Math.floor(mins / 60), mins % 60, taskIdx));
  }
}
// boundary cases: a 23:45 start (counts for its own evening) and a 05:30 start (previous day)
valid.sessions.push(session(2026, 10, 2, 23, 45, 0));
valid.sessions.push(session(2026, 10, 4, 5, 30, 1)); // study day = Oct 3
valid.sessions.sort((a, b) => a.startedAt - b.startedAt);
valid.meta.milestonesShown = ['sessions-10', 'sessions-50', 'sessions-100'];
const w = (name, doc) => writeFileSync(join(dir, name), typeof doc === 'string' ? doc : JSON.stringify(doc, null, 1) + '\n');
w('backup-valid.json', valid);

// ---- smaller siblings ---------------------------------------------------------------------
const small = () => {
  const d = baseDoc();
  for (const day of [8, 9, 10, 11, 12, 13, 14]) d.sessions.push(session(2026, 10, day, 9, 0, day % 3));
  return d;
};

const future = small();
for (const [i, day] of [1, 2, 3].entries()) future.sessions.push(session(2030, 1, day, 10 + i, 0, 0));
w('backup-future.json', future);

const v0 = small();
v0.schemaVersion = 0;
delete v0.exportedAt;
w('backup-v0.json', v0);

w('backup-not-json.txt', 'this is not json {{{ Em Time\n');
const wrong = small(); wrong.app = 'not-em-time';
w('backup-wrong-app.json', wrong);
const newer = small(); newer.schemaVersion = 99;
w('backup-newer.json', newer);
const damaged = small(); damaged.sessions = 'nope';
w('backup-damaged.json', damaged);
w('backup-empty.txt', '');

const bad = small();
const s0 = bad.sessions[0];
const endsBefore = session(2026, 10, 7, 9, 0, 0);
bad.sessions.push({ ...endsBefore, id: sessionId(s0.startedAt + 1), endedAt: endsBefore.startedAt - 1 }); // ends before it starts
bad.sessions.push({ ...session(2026, 10, 7, 11, 0, 0), id: sessionId(s0.startedAt + 2), focusedMs: 26 * MIN }); // focused > planned
bad.tasks.push({
  id: T(16), name: 'Orphan task', categoryId: '99999999-9999-4999-8999-999999999999', done: false, doneAt: null,
  order: 9, createdAt: 5, updatedAt: 5, deletedAt: null,
});
w('backup-bad-records.json', bad);

console.log(`valid: ${valid.sessions.length} sessions`);
