// Regenerates stub-data.json. Run: node frontend/src/core/fixtures/generate-stub-data.mjs
// The fixture stores day OFFSETS (calendar days before the stub's "today"), never absolute dates;
// stub.ts turns them into timestamps relative to `now` when the stub core is created.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(1337);
const pick = (weights) => {
  const total = weights.reduce((n, w) => n + w[1], 0);
  let r = rnd() * total;
  for (const [v, w] of weights) {
    r -= w;
    if (r <= 0) return v;
  }
  return weights[weights.length - 1][0];
};

const id = (n) => `a1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tasks = [
  {
    id: id(1),
    name: 'Organic chemistry ch. 7',
    category: 1,
    createdOff: 69,
    done: false,
    deleted: false,
    minOff: 0,
    maxOff: 69,
    w: 3,
  },
  {
    id: id(2),
    name: 'Read: Thinking, Fast and Slow',
    category: 2,
    createdOff: 60,
    done: false,
    deleted: false,
    minOff: 0,
    maxOff: 60,
    w: 2,
  },
  {
    id: id(3),
    name: 'Stats problem set 4',
    category: 3,
    createdOff: 41,
    done: false,
    deleted: false,
    minOff: 0,
    maxOff: 41,
    w: 3,
  },
  {
    id: id(4),
    name: 'Lab report draft',
    category: 4,
    createdOff: 30,
    done: false,
    deleted: false,
    minOff: 0,
    maxOff: 30,
    w: 2.5,
  },
  {
    id: id(5),
    name: 'Anatomy flashcards',
    category: 5,
    createdOff: 66,
    done: true,
    doneOff: 26,
    deleted: false,
    minOff: 26,
    maxOff: 66,
    w: 1.5,
  },
  {
    id: id(6),
    name: 'Spanish vocab',
    category: 2,
    createdOff: 64,
    done: false,
    deleted: true,
    deletedOff: 38,
    minOff: 38,
    maxOff: 64,
    w: 1.2,
  },
];

const taskFor = (off) => {
  if (rnd() < 0.1) return null;
  const avail = tasks.filter((t) => off >= t.minOff && off <= t.maxOff);
  return pick(avail.map((t) => [t.id, t.w]));
};

const HISTORY_DAYS = 70;
const streakDays = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8]); // current 9-day streak (day 9 is empty)
const emptyDays = new Set([9, 12, 13, 33, 34, 36, 40, 41, 47, 55, 61, 62]); // 36: only the 05:30 session lands here
const sessions = [];
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

for (let off = 0; off < HISTORY_DAYS; off++) {
  const active = streakDays.has(off) || (!emptyDays.has(off) && rnd() > 0.22);
  if (!active) continue;
  const n = pick([
    [1, 12],
    [2, 20],
    [3, 22],
    [4, 18],
    [5, 14],
    [6, 8],
    [7, 6],
  ]);
  let t = off === 0 ? 390 : 390 + Math.floor(rnd() * 240); // first start 06:30 .. 10:30 (today starts at 06:30)
  for (let k = 0; k < n; k++) {
    const mins = pick([
      [25, 80],
      [50, 17],
      [90, 3],
    ]);
    if (t + mins > 23 * 60 + 10) break;
    sessions.push({ off, at: hhmm(t), mins, task: taskFor(off) });
    t += mins + (k % 4 === 3 ? 15 : 5) + (rnd() < 0.5 ? Math.floor(rnd() * 90) : 0);
  }
}

// Special cases (calendar offsets; study day = date unless the start is before 06:00)
sessions.push({
  off: 2,
  at: '23:45',
  mins: 25,
  task: id(3),
  note: 'crosses midnight, counts for its start day',
});
sessions.push({
  off: 35,
  at: '05:30',
  mins: 25,
  task: id(1),
  note: 'before 06:00, belongs to the previous study day (off 36)',
});
sessions.push({
  off: 31,
  at: '01:30',
  mins: 25,
  task: id(1),
  note: 'late night, belongs to the previous study day (off 32)',
});
sessions.push({
  off: 48,
  at: '06:00',
  mins: 25,
  task: id(1),
  note: 'exactly 06:00, starts the new study day',
});
sessions.push({
  off: 52,
  at: '05:59',
  mins: 25,
  task: id(2),
  note: 'one minute before rollover, previous study day (off 53)',
});

// chronological: oldest first (larger offset first, then time of day)
const key = (s) => s.off * 10000 - Number(s.at.replace(':', ''));
sessions.sort((a, b) => key(b) - key(a));

const fixture = {
  description:
    'Em Time stub fixture. Offsets are calendar days before the stub\'s "today"; stub.ts converts to timestamps. emptyWeek is a week offset (-3 = three weeks back) with every session removed.',
  emptyWeek: -3,
  tasks,
  sessions,
};

const lines = [];
lines.push('{');
lines.push(`  "description": ${JSON.stringify(fixture.description)},`);
lines.push(`  "emptyWeek": ${fixture.emptyWeek},`);
lines.push('  "tasks": [');
const clean = (t) => {
  const rest = { ...t };
  delete rest.minOff;
  delete rest.maxOff;
  delete rest.w;
  return rest;
};
lines.push(tasks.map((t) => '    ' + JSON.stringify(clean(t))).join(',\n'));
lines.push('  ],');
lines.push('  "sessions": [');
lines.push(sessions.map((s) => '    ' + JSON.stringify(s)).join(',\n'));
lines.push('  ]');
lines.push('}');
const out = fileURLToPath(new URL('./stub-data.json', import.meta.url));
writeFileSync(out, lines.join('\n') + '\n');
console.log(`wrote ${out}: ${tasks.length} tasks, ${sessions.length} sessions`);
