import { describe, expect, it } from 'vitest';
import { errorMessageOr } from './errorMessage';

describe('errorMessageOr', () => {
  it("returns an Error's message", () => {
    expect(errorMessageOr(new Error('Card declined'), 'fallback')).toBe('Card declined');
  });

  it('returns a plain object message', () => {
    expect(errorMessageOr({ message: 'Not enough points' }, 'fallback')).toBe('Not enough points');
  });

  it('keeps an empty message (same as `e?.message ?? fallback`)', () => {
    expect(errorMessageOr(new Error(''), 'fallback')).toBe('');
  });

  it('falls back when there is no message', () => {
    expect(errorMessageOr(undefined, 'fallback')).toBe('fallback');
    expect(errorMessageOr(null, 'fallback')).toBe('fallback');
    expect(errorMessageOr('boom', 'fallback')).toBe('fallback');
    expect(errorMessageOr({}, 'fallback')).toBe('fallback');
  });
});
