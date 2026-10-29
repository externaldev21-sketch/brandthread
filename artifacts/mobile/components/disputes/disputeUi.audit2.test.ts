/**
 * daysLeft ceiled the hours left, so a deadline later today read "Due in 1
 * day" and "Due today" could never show. It now counts local calendar days.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dueChipLabel } from './disputeUi';

let prevTz: string | undefined;
beforeEach(() => { prevTz = process.env.TZ; process.env.TZ = 'UTC'; });
afterEach(() => { if (prevTz === undefined) delete process.env.TZ; else process.env.TZ = prevTz; });

const now = Date.parse('2026-10-10T12:00:00Z');

describe('dueChipLabel by calendar day', () => {
  it('reads "Due today" for a deadline later today', () => {
    expect(dueChipLabel('2026-10-10T14:00:00Z', now)).toBe('Due today');
    expect(dueChipLabel('2026-10-10T23:59:00Z', now)).toBe('Due today');
  });
  it('reads "Due in 1 day" for a deadline tomorrow, even under 24 hours away', () => {
    expect(dueChipLabel('2026-10-11T01:00:00Z', now)).toBe('Due in 1 day');
    expect(dueChipLabel('2026-10-11T23:00:00Z', now)).toBe('Due in 1 day');
  });
  it('counts later days by date', () => {
    expect(dueChipLabel('2026-10-12T01:00:00Z', now)).toBe('Due in 2 days');
  });
  it('keeps past-due handling', () => {
    expect(dueChipLabel('2026-10-10T10:00:00Z', now)).toBe('Past due');
  });
});
