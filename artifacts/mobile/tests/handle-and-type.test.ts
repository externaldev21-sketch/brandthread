import { describe, expect, it } from 'vitest';
import { formatHandle } from '@/lib/handle';
import { whiteOver } from '@/lib/whiteOver';
import { TEXT_SECONDARY, TYPE } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';

/** Less-AI pass items 22, 24, 29. */
describe('formatHandle', () => {
  it('is lowercase with exactly one @', () => {
    expect(formatHandle('NorthLine')).toBe('@northline');
    expect(formatHandle('@@Ava')).toBe('@ava');
    expect(formatHandle('  ')).toBe('');
    expect(formatHandle(null)).toBe('');
  });
});

describe('secondary text is white at 60%', () => {
  it('renders as #999999 on the black base', () => {
    expect(whiteOver('#000000', 0.6)).toBe('#999999');
    expect(TEXT_SECONDARY).toBe('#999999');
  });

  it('follows a tinted background instead of a fixed grey', () => {
    expect(whiteOver('#281235', 0.6)).toBe('#A9A0AE');
  });
});

describe('big titles are tracked tight', () => {
  it('gets tighter as the size grows', () => {
    expect(TYPE.largeTitle.letterSpacing).toBeLessThan(TYPE.title.letterSpacing);
    expect(TYPE.title.letterSpacing).toBeLessThan(0);
    expect(TYPE_SCALE.display.letterSpacing!).toBeLessThan(TYPE_SCALE.title1.letterSpacing!);
    expect(TYPE_SCALE.title2.letterSpacing).toBe(-0.3);
  });
});
