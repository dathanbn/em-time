// Public barrel: everything in docs/contract.md section 1, plus the type-only interfaces of
// section 3 (api.ts) and a few additions listed in HANDOFF.md. The frontend imports only from here.
export * from './types';
export * from './constants';
export type * from './api';
export { createEmCore } from './core';
export { createStubCore } from './stub';
export { createTimerEngine, timerReducer, initialTimerState } from './timer/engine';
export { dayKey, todayKey, addDays, diffDays, weekStart, isoWeekdayIndex, parseDay } from './time/calendar';
export {
  formatDuration,
  formatDayLabel,
  formatShortDate,
  formatRange,
  formatClock,
  numberWord,
} from './time/format';
export {
  dailyStats,
  todaySummary,
  streakInfo,
  trendSeries,
  heatmapCells,
  heatLevel,
  weekSummary,
  firstSessionDay,
  statsSessions,
} from './stats';
export { milestonesReached } from './stats/milestones';
export { createLocalStorageAdapter, createMemoryAdapter, loadData, saveData } from './storage/persist';
export { migrate, MIGRATIONS } from './storage/migrate';
export { exportData, parseImport, mergeData, applyRemoteRow } from './storage/exportImport';
export { createBag, nextFromBag, renderMessage } from './copy/picker';
export {
  createDefaultData,
  createDefaultSettings,
  createDefaultCategories,
  sessionId,
  uuid,
} from './store/defaults';
export { isSyncConfigured, readSyncEnv, hasStoredAuth } from './sync/env';
export type { SyncEngine } from './sync/engine'; // implementation lazy-loaded: import('./sync/engine')
export { toRow, fromRow } from './sync/rows';

// Additions beyond contract.md section 1 (see HANDOFF.md)
export { ValidationError } from './store/errors';
export type { ValidationReason } from './store/errors';
export { MigrationError } from './storage/migrate';
export { timerConfigFromSettings } from './timer/config';
