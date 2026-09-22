/**
 * Legacy color shape for the `useColors()` hook.
 *
 * Values are aliases of the canonical dark-only tokens in `lib/theme.ts`.
 * Keep this compatibility object while older screens migrate; never add
 * independent palette values here.
 */
import {
  BG, CARD, CARD_GLASS, FG, ACCENT, MUTED, SUBTLE, BORDER,
  RED, SUCCESS, ORANGE, GOLD, RADIUS,
} from '@/lib/theme';

const colors = {
  /** The app is dark-only; the light shape remains for legacy callers. */
  light: {
    text: FG,
    tint: ACCENT,
    background: BG,
    foreground: FG,
    card: CARD,
    cardForeground: FG,
    primary: ACCENT,
    primaryForeground: BG,
    secondary: CARD,
    secondaryForeground: FG,
    muted: CARD_GLASS,
    mutedForeground: MUTED,
    accent: CARD_GLASS,
    accentForeground: FG,
    destructive: RED,
    destructiveForeground: FG,
    border: BORDER,
    input: CARD_GLASS,
    success: SUCCESS,
    warning: ORANGE,
    info: MUTED,
  },
  dark: {
    text: FG,
    tint: ACCENT,
    background: BG,
    foreground: FG,
    card: CARD_GLASS,
    cardForeground: FG,
    primary: ACCENT,
    primaryForeground: BG,
    secondary: CARD_GLASS,
    secondaryForeground: FG,
    muted: CARD_GLASS,
    mutedForeground: MUTED,
    accent: CARD,
    accentForeground: FG,
    destructive: RED,
    destructiveForeground: FG,
    border: BORDER,
    input: CARD_GLASS,
    success: SUCCESS,
    warning: ORANGE,
    info: SUBTLE,
  },
  radius: RADIUS.lg,
};

export default colors;