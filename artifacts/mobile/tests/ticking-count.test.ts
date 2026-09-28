/**
 * TickingCount — pure diffing logic tests.
 *
 * `diffCount` (lib/engagementUtils.ts) is what decides *how* the roll
 * happens (per-character vs. whole-label) and *which direction* (up on
 * like/save, down on unlike/unsave) for components/ui/TickingCount.tsx —
 * kept alongside formatCount specifically so it's unit-testable without a
 * react-native import / render tree.
 */
import { describe, it, expect } from 'vitest';
import { diffCount } from '@/lib/engagementUtils';

describe('diffCount', () => {
  it('returns "none" when the formatted string does not change', () => {
    expect(diffCount(42, 42)).toEqual({ kind: 'none', text: '42' });
    // 12,400 and 12,499 both format to "12.4K" — no visible change either.
    expect(diffCount(12_499, 12_400)).toEqual({ kind: 'none', text: '12.4K' });
  });

  it('rolls only the last digit for a same-length +1 (the ordinary like case)', () => {
    const diff = diffCount(43, 42);
    expect(diff.kind).toBe('chars');
    if (diff.kind !== 'chars') throw new Error('expected chars');
    expect(diff.text).toBe('43');
    expect(diff.prevText).toBe('42');
    expect(diff.direction).toBe(1);
    expect(diff.diffs).toEqual([false, true]);
  });

  it('rolls only the last digit for a same-length -1 (the ordinary unlike case)', () => {
    const diff = diffCount(41, 42);
    expect(diff.kind).toBe('chars');
    if (diff.kind !== 'chars') throw new Error('expected chars');
    expect(diff.direction).toBe(-1);
    expect(diff.diffs).toEqual([false, true]);
  });

  it('rolls only the changed digit inside a comma-grouped count', () => {
    // "1,203" -> "1,204": only the trailing "3" -> "4" changes.
    const diff = diffCount(1204, 1203);
    expect(diff.kind).toBe('chars');
    if (diff.kind !== 'chars') throw new Error('expected chars');
    expect(diff.diffs).toEqual([false, false, false, false, true]);
  });

  it('rolls only the changed digit crossing a K threshold\'s own tenths digit', () => {
    // "12.3K" -> "12.4K": only the tenths digit changes, not the whole label.
    const diff = diffCount(12_400, 12_300);
    expect(diff.kind).toBe('chars');
    if (diff.kind !== 'chars') throw new Error('expected chars');
    expect(diff.text).toBe('12.4K');
    expect(diff.prevText).toBe('12.3K');
    expect(diff.diffs).toEqual([false, false, false, true, false]);
  });

  it('rolls the whole label when the formatted string\'s length changes ("999" -> "1,000")', () => {
    const diff = diffCount(1000, 999);
    expect(diff.kind).toBe('whole');
    if (diff.kind !== 'whole') throw new Error('expected whole');
    expect(diff.text).toBe('1,000');
    expect(diff.prevText).toBe('999');
    expect(diff.direction).toBe(1);
  });

  it('rolls the whole label down when a save count drops from 1 to 0 (blank)', () => {
    const diff = diffCount(0, 1);
    expect(diff.kind).toBe('whole');
    if (diff.kind !== 'whole') throw new Error('expected whole');
    expect(diff.text).toBe('');
    expect(diff.prevText).toBe('1');
    expect(diff.direction).toBe(-1);
  });

  it('rolls the whole label up when a like count appears from 0 (blank) to 1', () => {
    const diff = diffCount(1, 0);
    expect(diff.kind).toBe('whole');
    if (diff.kind !== 'whole') throw new Error('expected whole');
    expect(diff.text).toBe('1');
    expect(diff.prevText).toBe('');
    expect(diff.direction).toBe(1);
  });
});
