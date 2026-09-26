/**
 * animationUtils — blurry-text-prevention helpers for animated transforms.
 *
 * See lib/animationUtils.ts's own header comment for the underlying bug:
 * a `transform` style left at its identity value (e.g. `[{ translateY: 0 }]`)
 * still forces a permanent, possibly-fractional-pixel compositing layer on
 * react-native-web, softening subpixel-antialiased text beneath it.
 */
import { describe, it, expect } from 'vitest';
import { identityOrNone, isIdentityTransform } from '@/lib/animationUtils';

describe('isIdentityTransform', () => {
  it('treats undefined/empty as identity', () => {
    expect(isIdentityTransform(undefined)).toBe(true);
    expect(isIdentityTransform([])).toBe(true);
  });

  it('treats translateX/Y at (or extremely near) 0 as identity', () => {
    expect(isIdentityTransform([{ translateY: 0 }])).toBe(true);
    expect(isIdentityTransform([{ translateX: 0.001 }])).toBe(true);
  });

  it('treats scale at (or extremely near) 1 as identity', () => {
    expect(isIdentityTransform([{ scale: 1 }])).toBe(true);
    expect(isIdentityTransform([{ scaleX: 0.999 }])).toBe(true);
  });

  it('treats rotate at 0deg as identity', () => {
    expect(isIdentityTransform([{ rotate: 0 }])).toBe(true);
  });

  it('is false for a translate/scale that has not settled yet', () => {
    expect(isIdentityTransform([{ translateY: 14 }])).toBe(false);
    expect(isIdentityTransform([{ scale: 1.3 }])).toBe(false);
  });

  it('is false when any entry in a multi-entry transform is non-identity', () => {
    expect(isIdentityTransform([{ translateY: 0 }, { scale: 1.1 }])).toBe(false);
  });
});

describe('identityOrNone', () => {
  it('returns undefined once every entry is at rest, dropping the transform key', () => {
    expect(identityOrNone([{ translateY: 0 }])).toBeUndefined();
    expect(identityOrNone([{ scale: 1 }])).toBeUndefined();
  });

  it('returns the transform array unchanged while still animating', () => {
    const t = [{ translateY: 22 }];
    expect(identityOrNone(t)).toBe(t);
  });
});
