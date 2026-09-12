/**
 * Brandthread design tokens — Chrome/Silver neutral theme.
 *
 * These values are consumed by the legacy `useColors()` hook used in
 * secondary/settings screens. They must match the canonical tokens in
 * `lib/theme.ts` so the whole app is visually consistent.
 *
 * Key mappings to lib/theme constants:
 *   background      → BG           #07070F
 *   foreground      → FG           #F8FAFC
 *   card            → CARD         #17191D
 *   primary         → Chrome       #C7CDD5
 *   tint            → Chrome       #C7CDD5
 *   mutedForeground → MUTED        rgba(248,250,252,0.50)
 *   border          → BORDER       rgba(255,255,255,0.07)
 *   success         → SUCCESS      #10B981
 *   destructive     → RED          #F87171
 */

const colors = {
  /** Light palette — not used in the app (forced dark), kept for completeness. */
  light: {
    text:                '#17191D',
    tint:                '#727A84',
    background:          '#F8FAFC',
    foreground:          '#17191D',
    card:                '#FFFFFF',
    cardForeground:      '#17191D',
    primary:             '#727A84',
    primaryForeground:   '#FFFFFF',
    secondary:           '#E5E7EB',
    secondaryForeground: '#34383E',
    muted:               '#F1F5F9',
    mutedForeground:     '#6B7280',
    accent:              '#DDE2E8',
    accentForeground:    '#34383E',
    destructive:         '#EF4444',
    destructiveForeground: '#FFFFFF',
    border:              'rgba(0,0,0,0.08)',
    input:               '#F1F5F9',
    success:             '#10B981',
    warning:             '#F59E0B',
    info:                '#22D3EE',
  },

  /** Dark palette — the active Brandthread theme. */
  dark: {
    text:                '#F8FAFC',
    tint:                '#C7CDD5',
    background:          '#07070F',
    foreground:          '#F8FAFC',
    card:                '#17191D',
    cardForeground:      '#F8FAFC',
    primary:             '#C7CDD5',
    primaryForeground:   '#FFFFFF',
    secondary:           '#34383E',
    secondaryForeground: '#F8FAFC',
    muted:               '#34383E',
    mutedForeground:     'rgba(248,250,252,0.50)',
    accent:              '#34383E',
    accentForeground:    '#F8FAFC',
    destructive:         '#F87171',
    destructiveForeground: '#FFFFFF',
    border:              'rgba(255,255,255,0.07)',
    input:               '#17191D',
    success:             '#10B981',
    warning:             '#F59E0B',
    info:                '#22D3EE',
  },

  /** Shared shape token — matches RADIUS.lg in lib/theme. */
  radius: 12,
};

export default colors;
