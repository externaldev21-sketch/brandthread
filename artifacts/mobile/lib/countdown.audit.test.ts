import { describe, expect, it } from 'vitest';
import { formatTimeRemaining, formatTimeUntil } from './countdown';

describe('countdown labels at the edges', () => {
  it('shows minutes, not "In 0h", for a start under half an hour away', () => {
    expect(formatTimeUntil(new Date(Date.now() + 20 * 60_000).toISOString())).toBe('In 20m');
  });

  it('shows no badge for an unparseable date instead of "NaN"', () => {
    expect(formatTimeUntil('not a date')).toBe('');
    expect(formatTimeRemaining('not a date')).toBeNull();
  });
});
