import { describe, expect, it } from 'vitest';
import { formatCompactCount } from '@/lib/compactFormat';

describe('formatCompactCount', () => {
  it('shows exact values with commas under 10,000', () => {
    expect(formatCompactCount(0)).toBe('0');
    expect(formatCompactCount(999)).toBe('999');
    expect(formatCompactCount(1000)).toBe('1,000');
    expect(formatCompactCount(9999)).toBe('9,999');
  });

  it('switches to K at 10,000, dropping a trailing .0', () => {
    expect(formatCompactCount(10000)).toBe('10K');
    expect(formatCompactCount(12500)).toBe('12.5K');
    expect(formatCompactCount(999000)).toBe('999K');
  });

  it('promotes to the next unit instead of overflowing e.g. "1000.0K"', () => {
    expect(formatCompactCount(999950)).toBe('1M');
  });

  it('formats millions with one decimal, trailing .0 dropped', () => {
    expect(formatCompactCount(1e6)).toBe('1M');
    expect(formatCompactCount(1.25e6)).toBe('1.3M');
    expect(formatCompactCount(12_500_000)).toBe('12.5M');
    expect(formatCompactCount(999_900_000)).toBe('999.9M');
  });

  it('formats billions with one decimal, trailing .0 dropped', () => {
    expect(formatCompactCount(1e9)).toBe('1B');
    expect(formatCompactCount(1_200_000_000)).toBe('1.2B');
  });

  it('treats null/undefined/negative/non-finite input as 0', () => {
    expect(formatCompactCount(null)).toBe('0');
    expect(formatCompactCount(undefined)).toBe('0');
    expect(formatCompactCount(NaN)).toBe('0');
    expect(formatCompactCount(-5)).toBe('-5');
  });
});
