/**
 * Order globe palette: black, white and silver only. The sphere is a lit
 * near-black, land is solid silver shaded toward the limb, activity dots and
 * arcs glow silver-white.
 */
export const GLOBE_COLORS = {
  sphereLight: '#1A1B1D',
  sphereDark: '#040404',
  rim: 'rgba(214,217,222,0.22)',
  haloInner: 'rgba(214,217,222,0.16)',
  /** Land silver, as "r,g,b" for per-use alpha. */
  landRgb: '196,199,205',
  /** Land fill: lit side (upper left) to the limb. */
  landLit: 'rgba(206,209,214,0.94)',
  landMid: 'rgba(160,163,169,0.86)',
  landShade: 'rgba(92,95,100,0.80)',
  /** Thin coastline sheen on the land fill. */
  coast: 'rgba(236,238,242,0.28)',
  /** Night side over land and sea, so the ball reads round. */
  limbShadow: 'rgba(0,0,0,0.62)',
  limbClear: 'rgba(0,0,0,0)',
  /** Order glow, as "r,g,b". */
  glowRgb: '228,231,236',
  /** Session (visitor) dots: a softer, cooler silver, as "r,g,b". */
  sessionRgb: '176,180,187',
  /** Arcs, as "r,g,b". */
  arcRgb: '238,240,244',
  core: '#FFFFFF',
  /** Outer edge of the halo gradient. */
  clear: 'rgba(0,0,0,0)',
  /** Captions and popover meta on the black frame. */
  mutedText: '#9A9CA1',
  text: '#D9DBDF',
} as const;
