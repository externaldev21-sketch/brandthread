import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import { symbolFor } from '../AnimatedSymbol';

describe('symbolFor (animated SF Symbols)', () => {
  it('maps like and save to their outline / filled symbols on iOS', () => {
    expect(symbolFor('heart', false, 'ios')).toBe('heart');
    expect(symbolFor('heart', true, 'ios')).toBe('heart.fill');
    expect(symbolFor('bookmark', true, 'ios')).toBe('bookmark.fill');
  });
  it('has no symbol elsewhere or for other glyphs, so callers keep the static icon', () => {
    expect(symbolFor('heart', true, 'android')).toBeNull();
    expect(symbolFor('heart', true, 'web')).toBeNull();
    expect(symbolFor('share', true, 'ios')).toBeNull();
  });
});
