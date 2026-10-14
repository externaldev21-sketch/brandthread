import { describe, expect, it } from 'vitest';
import { LEVEL_LABEL, levelRank, parseDollars, wholeDollars } from '@/lib/membershipLevels';

describe('membership level helpers', () => {
  it('labels and ranks the three levels', () => {
    expect(LEVEL_LABEL.inner_circle).toBe('Inner Circle');
    expect([null, 'member', 'insider', 'inner_circle'].map((l) => levelRank(l as any))).toEqual([-1, 0, 1, 2]);
  });

  it('formats and parses whole-dollar thresholds', () => {
    expect(wholeDollars(100_000)).toBe('$1,000');
    expect(parseDollars('$1,000')).toBe(100_000);
    expect(parseDollars('250')).toBe(25_000);
    expect(parseDollars('0')).toBeNull();
    expect(parseDollars('12.5')).toBeNull();
    expect(parseDollars('')).toBeNull();
  });
});
