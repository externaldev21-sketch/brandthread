/**
 * White at `alpha` laid over `background`, returned as the solid colour it
 * renders as. Secondary text is "white at 60%" on every theme (never a fixed
 * grey that turns to grey-on-grey on a tinted background), but stays an
 * opaque colour so small glyphs keep crisp edges.
 */
export function whiteOver(background: string, alpha: number): string {
  const hex = background.replace('#', '').slice(0, 6);
  const mix = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16);
    return Math.round(c + (255 - c) * alpha).toString(16).padStart(2, '0').toUpperCase();
  };
  return `#${mix(0)}${mix(2)}${mix(4)}`;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '').slice(0, 6);
  const ch = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Secondary-text colour for a theme: white at `alpha` over its base, raised
 * just enough on the lighter tinted themes to keep 4.5 : 1 against every
 * surface it sits on (`surfaces`). On the black base it is exactly #999999.
 */
export function secondaryText(base: string, surfaces: string[], alpha: number, minRatio = 4.6): string {
  let a = alpha;
  let color = whiteOver(base, a);
  while (a < 1 && surfaces.some((s) => contrast(s, color) < minRatio)) {
    a = Math.min(1, a + 0.01);
    color = whiteOver(base, a);
  }
  return color;
}
