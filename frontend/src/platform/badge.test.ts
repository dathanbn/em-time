import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyBadge, badgeFor } from './badge';

const MIN = 60_000;

describe('badgeFor', () => {
  it('is null while idle, whatever is left', () => {
    expect(badgeFor('idle', 25 * MIN)).toBeNull();
    expect(badgeFor('idle', 0)).toBeNull();
  });
  it('rounds the minutes left up, so 16:42 badges as 17 and 0:30 as 1', () => {
    expect(badgeFor('running', 25 * MIN)).toBe(25);
    expect(badgeFor('running', 16 * MIN + 42_000)).toBe(17);
    expect(badgeFor('paused', 30_000)).toBe(1);
  });
  it('never shows 0: the last second still badges 1', () => {
    expect(badgeFor('running', 1)).toBe(1);
    expect(badgeFor('running', 0)).toBe(1);
  });
});

describe('applyBadge', () => {
  const nav = navigator as unknown as { setAppBadge?: unknown; clearAppBadge?: unknown };
  afterEach(() => {
    delete nav.setAppBadge;
    delete nav.clearAppBadge;
  });
  it('does nothing without the API', () => {
    expect(() => applyBadge(5)).not.toThrow();
  });
  it('sets, repeats for free, and clears', async () => {
    const set = vi.fn(() => Promise.resolve());
    const clear = vi.fn(() => Promise.resolve());
    nav.setAppBadge = set;
    nav.clearAppBadge = clear;
    applyBadge(12);
    applyBadge(12);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(12);
    applyBadge(11);
    expect(set).toHaveBeenCalledTimes(2);
    applyBadge(null);
    expect(clear).toHaveBeenCalledTimes(1);
  });
  it('swallows a rejection', async () => {
    nav.setAppBadge = () => Promise.reject(new Error('no'));
    nav.clearAppBadge = () => Promise.resolve();
    expect(() => applyBadge(3)).not.toThrow();
    await Promise.resolve();
  });
});
