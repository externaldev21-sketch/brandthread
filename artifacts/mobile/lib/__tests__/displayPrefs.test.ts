import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DISPLAY_PREFS, contrastIconColor, isMutedIconColor, normalizeDisplayPrefs, parseColor,
  scaleTextStyle, scaledFontSize, textScaleFor, textSizeLabel,
} from '../displayPrefs';

describe('text size', () => {
  it('maps sizes to multipliers and labels', () => {
    expect(textScaleFor('default')).toBe(1);
    expect(textScaleFor('large')).toBe(1.15);
    expect(textScaleFor('larger')).toBe(1.3);
    expect(textScaleFor('bogus')).toBe(1);
    expect(textSizeLabel('larger')).toBe('Larger');
    expect(textSizeLabel(undefined)).toBe('Default');
  });

  it('scales body text fully and display type by half', () => {
    expect(scaledFontSize(15, 1.3)).toBe(19.5);
    expect(scaledFontSize(36, 1.3)).toBe(41.5);
    expect(scaledFontSize(15, 1)).toBe(15);
  });

  it('appends a fontSize/lineHeight override to the original style', () => {
    const base = { fontSize: 14, lineHeight: 19, color: '#fff' };
    expect(scaleTextStyle(base, 1)).toBe(base);
    expect(scaleTextStyle(base, 1.3)).toEqual([base, { fontSize: 18 + 0.5, lineHeight: 24.5 }]);
    expect(scaleTextStyle([{ fontSize: 12 }, false, [{ lineHeight: 16 }]], 1.15)).toEqual([
      [{ fontSize: 12 }, false, [{ lineHeight: 16 }]], { fontSize: 14, lineHeight: 18.5 },
    ]);
  });

  it('leaves text without its own fontSize to inherit from its parent', () => {
    const style = { color: '#fff' };
    expect(scaleTextStyle(style, 1.3)).toBe(style);
    expect(scaleTextStyle(undefined, 1.3)).toBeUndefined();
  });
});

describe('high-contrast icons', () => {
  it('parses hex, rgba and named colours', () => {
    expect(parseColor('#C0C0C0')).toEqual({ r: 192, g: 192, b: 192, a: 1 });
    expect(parseColor('#FFFFFFE6')?.a).toBeCloseTo(0.9, 2);
    expect(parseColor('rgba(192,192,192,0.35)')).toEqual({ r: 192, g: 192, b: 192, a: 0.35 });
    expect(parseColor('silver')).toEqual({ r: 192, g: 192, b: 192, a: 1 });
    expect(parseColor(undefined)).toBeNull();
  });

  it('treats the silver/grey tokens and see-through white as muted', () => {
    for (const c of ['#C0C0C0', '#B0B0B0', '#888888', 'rgba(255,255,255,0.6)', '#FFFFFFE6']) {
      expect(isMutedIconColor(c), c).toBe(true);
    }
  });

  it('leaves full-contrast and coloured tints alone', () => {
    for (const c of ['#FFFFFF', '#fff', '#000000', '#111111', '#F87171', '#D990FF', '#10B981', 'rgba(0,0,0,0.5)', 'transparent']) {
      expect(isMutedIconColor(c), c).toBe(false);
    }
  });

  it('swaps only muted tints for the foreground', () => {
    expect(contrastIconColor('#C0C0C0', '#FFFFFF')).toBe('#FFFFFF');
    expect(contrastIconColor('#F87171', '#FFFFFF')).toBe('#F87171');
  });
});

describe('normalizeDisplayPrefs', () => {
  it('falls back to defaults for missing or unknown values', () => {
    expect(normalizeDisplayPrefs(null)).toEqual(DEFAULT_DISPLAY_PREFS);
    expect(normalizeDisplayPrefs({ textSize: 'huge', translationLanguage: 'Spanish', highContrastIcons: 'yes' })).toEqual(DEFAULT_DISPLAY_PREFS);
    expect(normalizeDisplayPrefs({ textSize: 'large', translationLanguage: 'es', autoTranslateCaptions: true, highContrastIcons: true }))
      .toEqual({ textSize: 'large', translationLanguage: 'es', autoTranslateCaptions: true, highContrastIcons: true });
  });
});
