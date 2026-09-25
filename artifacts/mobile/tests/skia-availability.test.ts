import { describe, it, expect } from 'vitest';
import { loadSkia, isSkiaAvailable, __resetSkiaCacheForTests } from '../lib/skiaAvailability';

describe('skiaAvailability — guarded loader', () => {
  it('never throws when probing for the native module', () => {
    __resetSkiaCacheForTests();
    expect(() => loadSkia()).not.toThrow();
  });

  it('isSkiaAvailable returns a boolean and matches loadSkia()', () => {
    __resetSkiaCacheForTests();
    const available = isSkiaAvailable();
    expect(typeof available).toBe('boolean');
    const mod = loadSkia();
    expect(available).toBe(mod !== null);
  });

  it('caches the result across repeated calls', () => {
    __resetSkiaCacheForTests();
    const a = loadSkia();
    const b = loadSkia();
    expect(a).toBe(b);
  });
});
