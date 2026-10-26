/**
 * Order globe palette: black, white and silver only. The sphere is a lit
 * near-black, land is a silver dot matrix, order dots glow silver-white.
 */
export const GLOBE_COLORS = {
  sphereLight: '#1A1B1D',
  sphereDark: '#040404',
  rim: 'rgba(214,217,222,0.22)',
  haloInner: 'rgba(214,217,222,0.16)',
  /** Land dots, as "r,g,b" for per-dot alpha. */
  landRgb: '196,199,205',
  /** Order glow, as "r,g,b". */
  glowRgb: '228,231,236',
  core: '#FFFFFF',
  /** Captions and popover meta on the black frame. */
  mutedText: '#9A9CA1',
  text: '#D9DBDF',
} as const;
