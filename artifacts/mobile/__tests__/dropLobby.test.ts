import { describe, expect, it } from 'vitest';
import { countdownText, lobbyDateLabel, msUntilNextTick, notifyCountLabel, splitCountdown } from '@/lib/dropLobby';

describe('drop lobby helpers', () => {
  it('splits a countdown and never goes negative', () => {
    expect(splitCountdown(90_061_000)).toEqual({ days: 1, hours: 1, minutes: 1, seconds: 1 });
    expect(splitCountdown(-5000)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  });

  it('reads 00:00:01 for the final second, with days only when needed', () => {
    expect(countdownText(400)).toBe('Starts in 00:00:01');
    expect(countdownText(0)).toBe('Starts in 00:00:00');
    expect(countdownText(4 * 3600_000 + 12 * 60_000 + 9_000)).toBe('Starts in 04:12:09');
    expect(countdownText(2 * 86_400_000 + 3_000)).toBe('Starts in 2d 00:00:03');
    expect(countdownText(3600_000 + 60_000, true)).toBe('Starts in 1 hour 1 minute');
  });

  it('labels the launch like SNKRS in the given timezone', () => {
    expect(lobbyDateLabel('2026-10-16T17:00:00Z', 'en-US', 'America/Los_Angeles')).toBe('Available 10/16 at 10:00 AM');
  });

  it('shows only the real notify count, nothing at zero', () => {
    expect(notifyCountLabel(0)).toBeNull();
    expect(notifyCountLabel(-3)).toBeNull();
    expect(notifyCountLabel(Number.NaN)).toBeNull();
    expect(notifyCountLabel(1)).toBe('1 person has notifications on');
    expect(notifyCountLabel(1240)).toBe('1,240 people have notifications on');
  });

  it('ticks on the second boundary and lands the last tick on the launch instant', () => {
    expect(msUntilNextTick(10_250, 60_000)).toBe(750);
    expect(msUntilNextTick(10_000, 60_000)).toBe(1000);
    // Launch 300ms away: the next tick is the launch itself, not the next second.
    expect(msUntilNextTick(59_700, 60_000)).toBe(300);
    // Never a zero-delay spin.
    expect(msUntilNextTick(59_995, 60_000)).toBe(16);
  });
});
