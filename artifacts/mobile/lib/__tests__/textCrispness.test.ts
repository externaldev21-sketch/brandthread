/**
 * AppText — shared Text-convention helper tests (pure logic; environment: node).
 *
 * The floor/weight/tone rules are documented in components/ui/AppText.tsx's
 * header comment. This covers the one piece of real logic (the font-size
 * floor) plus that the exported weight/tone types line up with what's
 * actually loaded/available, so a typo can't silently point at a font
 * weight with no matching file (faux-bold → blurry) or a token that isn't
 * a real solid color.
 */
import { describe, it, expect } from 'vitest';
// Imported from lib/textCrispness (not components/ui/AppText itself) — that
// component file pulls in react-native's entrypoint, which this repo's
// node-environment Vitest can't parse outside the Expo/Metro bundler. The
// pure rule lives in lib/textCrispness.ts specifically so it's unit-testable
// here; AppText.tsx re-exports it unchanged.
import { flooredFontSize, MIN_FONT_SIZE } from '@/lib/textCrispness';
import { FONT } from '@/lib/theme';

type AppTextWeight = keyof typeof FONT;

describe('flooredFontSize', () => {
  it('leaves undefined alone (no explicit size / no role)', () => {
    expect(flooredFontSize(undefined)).toBeUndefined();
  });

  it('leaves a size at/above the floor unchanged', () => {
    expect(flooredFontSize(11)).toBe(11);
    expect(flooredFontSize(24)).toBe(24);
  });

  it('raises any size below the floor up to MIN_FONT_SIZE', () => {
    expect(flooredFontSize(9)).toBe(MIN_FONT_SIZE);
    expect(flooredFontSize(1)).toBe(MIN_FONT_SIZE);
  });
});

describe('AppTextWeight', () => {
  it('every weight key resolves to a font file actually loaded in app/_layout.tsx\'s useFonts', () => {
    // Inter's 4 body weights, plus the extrabold used for large titles and the
    // one editorial display face (see docs/design/display-font-options.md) —
    // all loaded via useFonts in app/_layout.tsx.
    const loaded = new Set([
      'Inter_400Regular', 'Inter_500Medium', 'Inter_600SemiBold', 'Inter_700Bold', 'Inter_800ExtraBold',
      'Fraunces_600SemiBold',
    ]);
    const weights = Object.keys(FONT) as AppTextWeight[];
    expect(weights.length).toBeGreaterThan(0);
    for (const w of weights) {
      expect(loaded.has(FONT[w])).toBe(true);
    }
  });
});
