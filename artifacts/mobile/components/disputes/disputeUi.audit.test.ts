/**
 * A deadline that passed a few hours ago used to read "Due today": daysLeft
 * ceils -0.1 days to -0, which is not < 0, so the chip fell through to the
 * "today" branch while the seller could no longer respond.
 */
import { describe, expect, it } from 'vitest';
import { dueChipLabel } from './disputeUi';

const now = Date.parse('2026-10-10T12:00:00Z');
const inHours = (h: number) => new Date(now + h * 3_600_000).toISOString();

describe('dueChipLabel around the deadline', () => {
  it('is past due as soon as the deadline has passed', () => {
    expect(dueChipLabel(inHours(-2), now)).toBe('Past due');
    expect(dueChipLabel(inHours(-23), now)).toBe('Past due');
  });

  it('still reads "Due in 1 day" for a deadline later today', () => {
    expect(dueChipLabel(inHours(2), now)).toBe('Due in 1 day');
  });
});
