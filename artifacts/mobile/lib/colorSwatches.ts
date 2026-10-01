/**
 * Product colour names -> swatch fill. These are the product's own colours
 * (content, like avatar colours), not app chrome, so they sit outside the
 * black/white/silver UI palette. theme-exempt.
 */
const SWATCHES: Record<string, string> = {
  black: '#121214', white: '#FAFAF7', grey: '#8E8E93', gray: '#8E8E93', silver: '#C0C0C0',
  charcoal: '#36363A', cream: '#F3EAD7', ivory: '#F5F0E1', beige: '#D8C8A8', tan: '#C49A6C',
  brown: '#6B4A2F', camel: '#B98B55', navy: '#1B2A49', blue: '#2F5DA8', green: '#3C7A4E',
  olive: '#6B6B3A', red: '#B3262B', burgundy: '#6E1F2E', pink: '#E7A4B8', orange: '#D9782D',
  yellow: '#E6C84A', purple: '#6C4AA0', gold: '#C9A24B',
};

export function swatchFor(name: string): string | null {
  return SWATCHES[name.trim().toLowerCase()] ?? null;
}
