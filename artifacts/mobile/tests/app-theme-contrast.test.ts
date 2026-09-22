import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppThemePreset } from '@/contexts/AppThemeContext';

vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: null }) }));
vi.mock('@/lib/api', () => ({ useApi: () => ({ auth: { me: async () => ({}) } }) }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

function luminance(color: string): number {
  const hex = color.replace('#', '').slice(0, 6);
  const channels = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(first: string, second: string): number {
  const light = Math.max(luminance(first), luminance(second));
  const dark = Math.min(luminance(first), luminance(second));
  return (light + 0.05) / (dark + 0.05);
}

describe('app theme accessibility palettes', () => {
  let presets: ReadonlyArray<AppThemePreset> = [];
  beforeAll(async () => {
    const module = await import('@/contexts/AppThemeContext');
    presets = module.APP_THEME_PRESETS;
  });

  it('keeps every preset readable', () => {
    expect(presets).toHaveLength(12);
    for (const theme of presets) {
      for (const surface of [theme.background, theme.surface, theme.card, theme.cardElevated]) {
        expect(contrast(surface, theme.text)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(surface, theme.muted)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(surface, theme.subtle)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(surface, theme.text)).toBeGreaterThan(contrast(surface, theme.muted));
        expect(contrast(surface, theme.muted)).toBeGreaterThan(contrast(surface, theme.subtle));
      }
      expect(contrast(theme.accent, theme.onAccent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.background, theme.success)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.background, theme.warning)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.background, theme.error)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps Leopard Red and Maroon visibly red across full-app surfaces', () => {
    const leopardRed = presets.find((theme) => theme.id === 'leopard-red');
    const maroon = presets.find((theme) => theme.id === 'maroon');

    expect(leopardRed).toMatchObject({
      background: '#4A080D',
      surface: '#5C0C12',
      card: '#70131A',
      accent: '#F0C36B',
    });
    expect(maroon).toMatchObject({
      background: '#310711',
      surface: '#460A18',
      card: '#5A1022',
    });
  });
});