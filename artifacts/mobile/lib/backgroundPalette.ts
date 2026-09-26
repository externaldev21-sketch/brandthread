import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { BG } from '@/lib/theme';

export type BackgroundPalette = {
  anchorStart: string;
  anchorEnd: string;
  base: string;
  deepHue: string;
  ribbonDark: string;
  ribbonMid: string;
  ribbonLight: string;
  sheen: string;
  trailSoft: string;
  trailStrong: string;
  particlePrimary: string;
  particleSecondary: string;
};

/**
 * Blends two solid hex colors by weight and returns another solid hex —
 * unlike an `opacity`/`rgba` value, this is safe to use for text color on a
 * KNOWN solid background (e.g. a flat accent-colored card): it pre-computes
 * the same visual result as translucency without leaving any alpha
 * compositing for the renderer to do, which is what causes soft/blurry text
 * on react-native-web. See components/ui/AppText.tsx's `tone` doc.
 */
export function mixHex(foreground: string, background: string, foregroundWeight: number): string {
  const parse = (value: string) => {
    const hex = value.replace('#', '');
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  };
  const front = parse(foreground);
  const back = parse(background);
  const channel = (index: number) =>
    Math.round(front[index] * foregroundWeight + back[index] * (1 - foregroundWeight))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

export function hexToRgba(hexValue: string, alpha: number): string {
  const hex = hexValue.replace('#', '');
  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  return `rgba(${red},${green},${blue},${alpha})`;
}

export function createBackgroundPalette(theme: AppThemePreset): BackgroundPalette {
  const hueBase = theme.heroGradient[0] ?? theme.accent;
  return {
    anchorStart: mixHex(hueBase, BG, 0.08),
    anchorEnd: mixHex(theme.accent, BG, 0.07),
    base: mixHex(hueBase, BG, 0.34),
    deepHue: mixHex(theme.accent, BG, 0.15),
    ribbonDark: mixHex(hueBase, BG, 0.58),
    ribbonMid: mixHex(theme.accent, BG, 0.38),
    ribbonLight: theme.accentLight,
    sheen: hexToRgba(theme.accentLight, 0.72),
    trailSoft: hexToRgba(theme.accentLight, 0.1),
    trailStrong: hexToRgba(theme.accentLight, 0.62),
    particlePrimary: theme.accentLight,
    particleSecondary: theme.secondary,
  };
}