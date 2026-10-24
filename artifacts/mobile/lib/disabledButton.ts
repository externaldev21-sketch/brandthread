/**
 * Disabled fill for filled (primary/destructive) buttons.
 *
 * Disabled primaries used to paint `palette.elevated`, which on the default
 * Monochrome theme is `#000000` — black on a black screen, so a disabled
 * "Continue" read as bare grey text with no container. These tokens give the
 * disabled state a subtle silver-wash surface plus a hairline silver border
 * and a muted label, so it still reads as a (switched-off) button on every
 * Appearance theme. Theme tokens only — no hardcoded colors.
 */
import type { AppThemePreset } from '@/contexts/AppThemeContext';

export interface DisabledFilledButtonColors {
  bg: string;
  border: string;
  fg: string;
}

export function getDisabledFilledButtonColors(theme: Pick<AppThemePreset, 'borderSubtle' | 'border' | 'muted'>): DisabledFilledButtonColors {
  return { bg: theme.borderSubtle, border: theme.border, fg: theme.muted };
}
