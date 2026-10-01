import { describe, expect, it } from 'vitest';
import { middleTruncate } from '@/lib/middleTruncate';

describe('middleTruncate', () => {
  it('returns short strings unchanged', () => {
    expect(middleTruncate('brandthread.app/u/bob')).toBe('brandthread.app/u/bob');
  });

  it('truncates a long string with an ellipsis in the middle, never at the end', () => {
    const result = middleTruncate('brandthread.app/u/a-very-long-store-handle-name');
    expect(result).toContain('…');
    expect(result.length).toBeLessThan('brandthread.app/u/a-very-long-store-handle-name'.length);
    expect(result.endsWith('…')).toBe(false);
    expect(result.startsWith('…')).toBe(false);
  });

  it('respects a custom maxLength', () => {
    const result = middleTruncate('0123456789abcdefghij', 10);
    expect(result.length).toBe(10);
  });
});
