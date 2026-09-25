/**
 * colorModel.ts — color math + palette/recents persistence helpers for the
 * Design Studio color picker (disc + classic modes, hex input, eyedropper,
 * brand palettes, recent colors).
 *
 * Pure functions only — no AsyncStorage/React Native imports — so this file
 * is fully unit-testable. Persistence (ColorPicker.tsx) injects a storage
 * adapter and calls the pure helpers here to compute the next state.
 */

// ─── RGB <-> HSV ──────────────────────────────────────────────────────────────

export interface RGB { r: number; g: number; b: number; } // 0..255
export interface HSV { h: number; s: number; v: number; } // h: 0..360, s/v: 0..1

export function rgbToHsv({ r, g, b }: RGB): HSV {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
  const hh = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = v - c;
  let r1 = 0, g1 = 0, b1 = 0;
  if (hh < 60) { r1 = c; g1 = x; b1 = 0; }
  else if (hh < 120) { r1 = x; g1 = c; b1 = 0; }
  else if (hh < 180) { r1 = 0; g1 = c; b1 = x; }
  else if (hh < 240) { r1 = 0; g1 = x; b1 = c; }
  else if (hh < 300) { r1 = x; g1 = 0; b1 = c; }
  else { r1 = c; g1 = 0; b1 = x; }
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

// ─── Hex <-> RGB ──────────────────────────────────────────────────────────────

/** Parses a hex color string (#RGB, #RRGGBB, with or without leading #). Returns null if invalid. */
export function parseHex(input: string): RGB | null {
  const s = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    const r = parseInt(s[0] + s[0], 16);
    const g = parseInt(s[1] + s[1], 16);
    const b = parseInt(s[2] + s[2], 16);
    return { r, g, b };
  }
  if (/^[0-9a-fA-F]{6}$/.test(s)) {
    return {
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16),
    };
  }
  return null;
}

export function rgbToHex({ r, g, b }: RGB): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const h = (v: number) => clamp(v).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

export function isValidHex(input: string): boolean {
  return parseHex(input) !== null;
}

export function hsvToHex(hsv: HSV): string {
  return rgbToHex(hsvToRgb(hsv));
}

export function hexToHsv(hex: string): HSV | null {
  const rgb = parseHex(hex);
  return rgb ? rgbToHsv(rgb) : null;
}

// ─── Disc (polar) picker math ─────────────────────────────────────────────────
//
// Procreate/classic "disc" color picker: hue is the angle around a circle
// (0° = right, increasing counter-clockwise to match standard math convention
// flipped for screen Y-down), saturation is the radial distance from center
// (0 = center/white, 1 = edge/full saturation). Value/brightness is a
// separate linear slider, not part of the disc itself.

export interface DiscPoint { x: number; y: number; } // normalized, -1..1, origin at disc center

/** Converts a normalized disc point to {h, s} (v is controlled separately). */
export function discPointToHs(p: DiscPoint): { h: number; s: number } {
  const dist = Math.hypot(p.x, p.y);
  const s = Math.max(0, Math.min(1, dist));
  let angleDeg = (Math.atan2(-p.y, p.x) * 180) / Math.PI; // -y so hue increases counter-clockwise visually
  if (angleDeg < 0) angleDeg += 360;
  return { h: angleDeg, s };
}

/** Converts {h, s} to a normalized disc point (inverse of discPointToHs). */
export function hsToDiscPoint(h: number, s: number): DiscPoint {
  const rad = (h * Math.PI) / 180;
  const r = Math.max(0, Math.min(1, s));
  return { x: Math.cos(rad) * r, y: -Math.sin(rad) * r };
}

// ─── Palettes & recent colors (pure state transitions) ────────────────────────

export const MAX_RECENT_COLORS = 20;

/** Pushes a hex color to the front of a recents list, de-duped, capped at MAX_RECENT_COLORS. */
export function pushRecentColor(recents: string[], hex: string): string[] {
  const normalized = hex.toUpperCase();
  const withoutDupe = recents.filter(c => c.toUpperCase() !== normalized);
  return [normalized, ...withoutDupe].slice(0, MAX_RECENT_COLORS);
}

export interface BrandPalette {
  id: string;
  name: string;
  colors: string[]; // hex
}

/** Adds a color to a named palette, de-duped, returning a new palette list. */
export function addColorToPalette(palettes: BrandPalette[], paletteId: string, hex: string): BrandPalette[] {
  const normalized = hex.toUpperCase();
  return palettes.map(p => {
    if (p.id !== paletteId) return p;
    if (p.colors.some(c => c.toUpperCase() === normalized)) return p;
    return { ...p, colors: [...p.colors, normalized] };
  });
}

export function removeColorFromPalette(palettes: BrandPalette[], paletteId: string, hex: string): BrandPalette[] {
  const normalized = hex.toUpperCase();
  return palettes.map(p => p.id === paletteId
    ? { ...p, colors: p.colors.filter(c => c.toUpperCase() !== normalized) }
    : p);
}

export function createPalette(palettes: BrandPalette[], name: string): BrandPalette[] {
  const id = `palette_${Date.now()}_${Math.round(Math.random() * 1e6)}`;
  return [...palettes, { id, name, colors: [] }];
}

// ─── Relative luminance (for contrast-safe UI, e.g. picking cursor color) ─────

export function relativeLuminance({ r, g, b }: RGB): number {
  const lin = (c: number) => {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Returns '#000000' or '#FFFFFF', whichever contrasts better against the given hex. */
export function contrastingBW(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return '#000000';
  return relativeLuminance(rgb) > 0.5 ? '#000000' : '#FFFFFF';
}
