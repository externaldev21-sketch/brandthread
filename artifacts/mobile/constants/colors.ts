/**
 * Brandthread design tokens — true black with one blue-violet accent.
 *
 * These values are consumed by the legacy `useColors()` hook used in
 * secondary/settings screens. They must match the canonical tokens in
 * `lib/theme.ts` so the whole app is visually consistent.
 *
 * Key mappings to lib/theme constants:
 *   background      → BG           #0A0A0B
 *   foreground      → FG           #F7F7FA
 *   card            → CARD         neutral graphite
 *   primary/tint    → ACCENT       #5B5CFF
 *   mutedForeground → MUTED        rgba(248,250,252,0.50)
 *   border          → BORDER       rgba(255,255,255,0.07)
 *   success         → SUCCESS      #10B981
 *   destructive     → RED          #F87171
 */

const colors = {
  /** Light palette — not used in the app (forced dark), kept for completeness. */
  light: {
    text:                '#17191D',
    tint:                '#5B5CFF',
    background:          '#F8FAFC',
    foreground:          '#17191D',
    card:                '#FFFFFF',
    cardForeground:      '#17191D',
    primary:             '#5B5CFF',
    primaryForeground:   '#FFFFFF',
    secondary:           '#E5E7EB',
    secondaryForeground: '#34383E',
    muted:               '#F1F5F9',
    mutedForeground:     '#6B7280',
    accent:              '#5B5CFF',
    accentForeground:    '#34383E',
    destructive:         '#EF4444',
    destructiveForeground: '#FFFFFF',
    border:              'rgba(0,0,0,0.08)',
    input:               '#F1F5F9',
    success:             '#10B981',
    warning:             '#F59E0B',
    info:                '#5B5CFF',
  },

  /** Dark palette — the active Brandthread theme. */
  dark: {
    text:                '#F7F7FA',
    tint:                '#5B5CFF',
    background:          '#0A0A0B',
    foreground:          '#F7F7FA',
    card:                'rgba(24,24,27,0.58)',
    cardForeground:      '#F7F7FA',
    primary:             '#5B5CFF',
    primaryForeground:   '#FFFFFF',
    secondary:           'rgba(24,24,27,0.72)',
    secondaryForeground: '#F7F7FA',
    muted:               'rgba(24,24,27,0.72)',
    mutedForeground:     'rgba(247,247,250,0.58)',
    accent:              '#5B5CFF',
    accentForeground:    '#FFFFFF',
    destructive:         '#F87171',
    destructiveForeground: '#FFFFFF',
    border:              'rgba(255,255,255,0.07)',
    input:               'rgba(24,24,27,0.58)',
    success:             '#10B981',
    warning:             '#F59E0B',
    info:                '#5B5CFF',
  },

  /** Shared shape token — matches RADIUS.lg in lib/theme. */
  radius: 12,
};

export default colors;
