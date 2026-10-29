import { describe, expect, it } from 'vitest';
import { formatCentsCompact } from './compactFormat';

describe('formatCentsCompact unit rollover', () => {
  it('never renders "1000K": a value that rounds to 1000 in K moves up to M', () => {
    expect(formatCentsCompact(999_600 * 100)).toBe('$1.0M');
    expect(formatCentsCompact(-999_600 * 100)).toBe('-$1.0M');
  });

  it('keeps the existing forms', () => {
    expect(formatCentsCompact(12_400 * 100)).toBe('$12.4K');
    expect(formatCentsCompact(250_000 * 100)).toBe('$250K');
    expect(formatCentsCompact(1_200_000 * 100)).toBe('$1.2M');
  });
});
