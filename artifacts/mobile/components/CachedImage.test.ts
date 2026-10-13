import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-image', () => ({ Image: () => null }));
vi.mock('@/contexts/AppThemeContext', () => ({ useAppTheme: () => ({ theme: {} }) }));
vi.mock('@/lib/theme', () => ({ FONT: {} }));
vi.mock('react-native', () => ({ StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s }, Text: 'Text', View: 'View' }));

import { initialFor } from './CachedImage';

describe('initialFor', () => {
  it('uses the first letter, uppercased', () => {
    expect(initialFor('field notes')).toBe('F');
    expect(initialFor('  Élan Studio')).toBe('É');
  });

  it('skips leading punctuation and handles', () => {
    expect(initialFor('@maya.k')).toBe('M');
    expect(initialFor('"Linen" shirt')).toBe('L');
  });

  it('keeps digits', () => {
    expect(initialFor('90s denim')).toBe('9');
  });

  it('falls back to ? for empty labels', () => {
    expect(initialFor('')).toBe('?');
    expect(initialFor(' -- ')).toBe('?');
  });
});
