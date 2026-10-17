import { describe, expect, it, vi } from 'vitest';
import { withDemoFallback } from './demoFallback';

describe('withDemoFallback', () => {
  it('keeps an empty live result empty outside demo mode', () => {
    const sample = vi.fn(() => ['fake']);
    expect(withDemoFallback([], false, sample)).toEqual([]);
    expect(sample).not.toHaveBeenCalled();
  });

  it('uses the sample only in demo mode when live is empty', () => {
    expect(withDemoFallback([], true, () => ['fake'])).toEqual(['fake']);
  });

  it('always prefers live results', () => {
    expect(withDemoFallback(['real'], true, () => ['fake'])).toEqual(['real']);
  });
});
