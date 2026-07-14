/**
 * Brandthread design tokens — "Deep Purple" premium theme.
 *
 * These values are consumed by the legacy `useColors()` hook used in
 * secondary/settings screens. They must match the canonical tokens in
 * `lib/theme.ts` so the whole app is visually consistent.
 *
 * Key mappings to lib/theme constants:
 *   background      → BG           #07070F
 *   foreground      → FG           #F4F4FF
 *   card            → CARD         #12121F
 *   primary         → PURPLE       #8B5CF6
 *   tint            → PURPLE       #8B5CF6
 *   mutedForeground → MUTED        rgba(244,244,255,0.50)
 *   border          → BORDER       rgba(255,255,255,0.07)
 *   success         → SUCCESS      #10B981
 *   destructive     → RED          #F87171
 */

const colors = {
  /** Light palette — not used in the app (forced dark), kept for completeness. */
  light: {
    text:                '#0B0B1A',
    tint:                '#8B5CF6',
    background:          '#F6F4FF',
    foreground:          '#0B0B1A',
    card:                '#FFFFFF',
    cardForeground:      '#0B0B1A',
    primary:             '#8B5CF6',
    primaryForeground:   '#FFFFFF',
    secondary:           '#EDE9FE',
    secondaryForeground: '#3B1FA3',
    muted:               '#F3F0FE',
    mutedForeground:     '#6B7280',
    accent:              '#DDD6FE',
    accentForeground:    '#4C1D95',
    destructive:         '#EF4444',
    destructiveForeground: '#FFFFFF',
    border:              'rgba(0,0,0,0.08)',
    input:               '#F3F0FE',
    success:             '#10B981',
    warning:             '#F59E0B',
    info:                '#22D3EE',
  },

  /** Dark palette — the active Brandthread theme. */
  dark: {
    text:                '#F4F4FF',
    tint:                '#8B5CF6',
    background:          '#07070F',
    foreground:          '#F4F4FF',
    card:                '#12121F',
    cardForeground:      '#F4F4FF',
    primary:             '#8B5CF6',
    primaryForeground:   '#FFFFFF',
    secondary:           '#18182E',
    secondaryForeground: '#F4F4FF',
    muted:               '#18182E',
    mutedForeground:     'rgba(244,244,255,0.50)',
    accent:              '#2D1B6B',
    accentForeground:    '#A78BFA',
    destructive:         '#F87171',
    destructiveForeground: '#FFFFFF',
    border:              'rgba(255,255,255,0.07)',
    input:               '#12121F',
    success:             '#10B981',
    warning:             '#F59E0B',
    info:                '#22D3EE',
  },

  /** Shared shape token — matches RADIUS.lg in lib/theme. */
  radius: 12,
};

export default colors;
