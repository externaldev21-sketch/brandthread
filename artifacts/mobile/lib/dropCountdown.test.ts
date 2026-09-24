import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeCountdownParts } from '@/lib/dropCountdown';

describe('computeCountdownParts', () => {
  const target = '2026-06-15T12:00:00.000Z';

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('breaks down days/hours/minutes/seconds correctly well before the target', () => {
    // Exactly 2 days, 3 hours, 4 minutes, 5 seconds before target.
    vi.setSystemTime(new Date('2026-06-13T08:55:55.000Z'));
    const parts = computeCountdownParts(target);
    expect(parts.isLive).toBe(false);
    expect(parts.days).toBe(2);
    expect(parts.hours).toBe(3);
    expect(parts.minutes).toBe(4);
    expect(parts.seconds).toBe(5);
  });

  it('counts down through the final minute', () => {
    vi.setSystemTime(new Date('2026-06-15T11:59:30.000Z'));
    const parts = computeCountdownParts(target);
    expect(parts.isLive).toBe(false);
    expect(parts.days).toBe(0);
    expect(parts.hours).toBe(0);
    expect(parts.minutes).toBe(0);
    expect(parts.seconds).toBe(30);
    expect(parts.totalSeconds).toBe(30);
  });

  it('flips to live exactly at the target instant', () => {
    vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'));
    const parts = computeCountdownParts(target);
    expect(parts.isLive).toBe(true);
    expect(parts.days).toBe(0);
    expect(parts.hours).toBe(0);
    expect(parts.minutes).toBe(0);
    expect(parts.seconds).toBe(0);
  });

  it('stays live after the target has passed', () => {
    vi.setSystemTime(new Date('2026-06-16T00:00:00.000Z'));
    const parts = computeCountdownParts(target);
    expect(parts.isLive).toBe(true);
  });

  it('is live when no target is given (no release date set)', () => {
    vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'));
    const parts = computeCountdownParts(null);
    expect(parts.isLive).toBe(true);
  });

  it('one second before the target is not yet live', () => {
    vi.setSystemTime(new Date('2026-06-15T11:59:59.000Z'));
    const parts = computeCountdownParts(target);
    expect(parts.isLive).toBe(false);
    expect(parts.totalSeconds).toBe(1);
  });
});
