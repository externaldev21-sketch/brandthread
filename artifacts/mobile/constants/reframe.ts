/**
 * X-style "reframe" design rules — Phase 1.
 *
 * One shared set of spacing, type, divider and color tokens modelled on X
 * (Twitter) iOS in dark mode: tight 15pt body copy, bold white names, gray
 * meta, hairline dividers between full-width rows, one 16pt gutter and one
 * left text column every row's copy aligns to.
 *
 * Font family is NOT changed here — every role uses the app's existing
 * `FONT` faces from lib/theme.ts. Only size, weight, line-height and spacing
 * are defined.
 *
 * Primitives that consume these live in components/reframe/ (ScreenHeader,
 * SegmentTabs, SectionHeader, ListRow, Divider, EmptyState). Pilot screens:
 * Activity, Messages, Discover. Phase 2 rolls the same tokens out to every
 * other buyer, seller and onboarding screen.
 */
import { StyleSheet, type TextStyle } from 'react-native';
import { FONT } from '@/lib/theme';
import type { AppThemePreset } from '@/contexts/AppThemeContext';

/** Spacing scale. Nothing outside these seven values in reframed screens. */
export const X_SPACE = {
  4: 4,
  8: 8,
  12: 12,
  16: 16,
  20: 20,
  24: 24,
  32: 32,
} as const;

/** The one screen gutter, used by every header, tab row, list row and rail. */
export const X_GUTTER = 16;

/** Leading avatar sizes: 40 for dense rows (Activity), 48 for people/DM rows. */
export const X_AVATAR = { sm: 40, md: 48 } as const;

/** Gap between a row's leading avatar and its text column. */
export const X_AVATAR_GAP = 12;

/**
 * Left edge of the shared text column for a row with a leading avatar:
 * gutter + avatar + gap. Section headers, dividers and secondary lines that
 * should line up with row copy use this as their left inset.
 */
export function xTextColumn(avatar: number = X_AVATAR.sm): number {
  return X_GUTTER + avatar + X_AVATAR_GAP;
}

/** Hairline divider thickness. */
export const X_HAIRLINE = StyleSheet.hairlineWidth;

/** Compact header row height (below the safe-area inset). */
export const X_HEADER_HEIGHT = 44;

/** Segment-tab row height and its active underline. */
export const X_TAB_HEIGHT = 44;
export const X_TAB_INDICATOR = { height: 3, radius: 2, minWidth: 24 } as const;

/** Row heights: single-line rows and two-line person/DM rows. */
export const X_ROW_MIN_HEIGHT = { single: 52, double: 64 } as const;

type XTypeRole = Pick<TextStyle, 'fontSize' | 'lineHeight' | 'fontFamily' | 'letterSpacing'>;

/**
 * Type scale (same font family). Tight line-heights, X-style:
 * 13 meta · 15 body/names · 17 section · 20 screen title · 28/34 hero.
 */
export const X_TYPE = {
  /** Timestamps, counts, captions, tab-row badges. Gray. */
  meta: { fontSize: 13, lineHeight: 16, fontFamily: FONT.regular },
  /** Body copy and secondary lines (handles, previews). */
  body: { fontSize: 15, lineHeight: 20, fontFamily: FONT.regular },
  /** Names / primary row label: bold white 15. */
  name: { fontSize: 15, lineHeight: 20, fontFamily: FONT.bold },
  /** Segment tab label (active = bold white, inactive = medium gray). */
  tab: { fontSize: 15, lineHeight: 20, fontFamily: FONT.medium },
  /** Section header inside a screen ("Today", "Suggested"). */
  section: { fontSize: 17, lineHeight: 22, fontFamily: FONT.bold, letterSpacing: -0.2 },
  /** Centered header title on pushed/modal screens. */
  titleCentered: { fontSize: 17, lineHeight: 22, fontFamily: FONT.bold, letterSpacing: -0.2 },
  /** Left-aligned screen title on tab pages and pushed screens. */
  title: { fontSize: 20, lineHeight: 24, fontFamily: FONT.bold, letterSpacing: -0.4 },
  /** Hero numbers (stats, balances). */
  heroSm: { fontSize: 28, lineHeight: 32, fontFamily: FONT.bold, letterSpacing: -0.5 },
  hero: { fontSize: 34, lineHeight: 38, fontFamily: FONT.bold, letterSpacing: -0.6 },
} as const satisfies Record<string, XTypeRole>;

/** X's dark-mode neutrals, used on the default (Monochrome) theme. */
export const X_GRAY = '#71767B';
export const X_DIVIDER = '#2F3336';

export interface XColors {
  /** Names, titles, active tab label + underline. */
  text: string;
  /** Handles, meta, previews, inactive tab labels. */
  secondary: string;
  /** Hairline dividers between rows and under tab rows. */
  divider: string;
  /** Screen + row background. */
  background: string;
}

/**
 * Colors for reframed screens. On the default black/white/silver theme
 * these are X's own gray (#71767B) and divider (#2F3336); on the other
 * Appearance themes (all dark, but tinted) they fall back to that theme's
 * own muted text and border so nothing reads as a gray stain on purple/navy.
 */
export function xColors(theme: AppThemePreset): XColors {
  const mono = theme.id === 'monochrome';
  return {
    text: theme.text,
    secondary: mono ? X_GRAY : theme.muted,
    divider: mono ? X_DIVIDER : theme.border,
    background: theme.background,
  };
}
