/**
 * Account display preferences (server: api-server lib/displayPreferences.ts,
 * GET/PATCH /api/display-preferences, migration 120) and the pure helpers
 * that apply them app-wide:
 *
 *   • textSize          → scaleTextStyle(), used by every <Text> through the
 *                         JSX runtime in lib/jsx (see lib/jsx/displayElements.ts)
 *   • highContrastIcons → contrastIconColor(), used by every vector-icon glyph
 *                         (Feather, Ionicons, …) through the same runtime and
 *                         by BuyerNavIcon (tab bars)
 *   • translationLanguage / autoTranslateCaptions → components/translation
 *
 * No React or React Native imports: this module is loaded by the JSX runtime.
 */

export type TextSize = 'default' | 'large' | 'larger';

export interface DisplayPrefs {
  translationLanguage: string;
  autoTranslateCaptions: boolean;
  textSize: TextSize;
  highContrastIcons: boolean;
}

/** What the server stores for an account that never changed anything. */
export const DEFAULT_DISPLAY_PREFS: DisplayPrefs = {
  translationLanguage: 'en',
  autoTranslateCaptions: false,
  textSize: 'default',
  highContrastIcons: false,
};

/** Local cache (AsyncStorage) so the app opens at the saved size before the API answers. */
export const DISPLAY_PREFS_STORAGE_KEY = 'bt_display_prefs_v1';

export const TEXT_SIZE_OPTIONS: Array<{ id: TextSize; label: string; description: string; scale: number }> = [
  { id: 'default', label: 'Default', description: 'Standard size', scale: 1 },
  { id: 'large', label: 'Large', description: '15% larger text', scale: 1.15 },
  { id: 'larger', label: 'Larger', description: '30% larger text', scale: 1.3 },
];

export function textScaleFor(size: TextSize | string | undefined): number {
  return TEXT_SIZE_OPTIONS.find(option => option.id === size)?.scale ?? 1;
}

export function textSizeLabel(size: TextSize | string | undefined): string {
  return TEXT_SIZE_OPTIONS.find(option => option.id === size)?.label ?? 'Default';
}

const TEXT_SIZES = new Set<string>(TEXT_SIZE_OPTIONS.map(option => option.id));

/** Parses a stored / served value; anything unknown falls back to the defaults. */
export function normalizeDisplayPrefs(value: unknown): DisplayPrefs {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const d = DEFAULT_DISPLAY_PREFS;
  return {
    translationLanguage: typeof v.translationLanguage === 'string' && /^[a-z]{2,3}$/.test(v.translationLanguage)
      ? v.translationLanguage : d.translationLanguage,
    autoTranslateCaptions: typeof v.autoTranslateCaptions === 'boolean' ? v.autoTranslateCaptions : d.autoTranslateCaptions,
    textSize: typeof v.textSize === 'string' && TEXT_SIZES.has(v.textSize) ? v.textSize as TextSize : d.textSize,
    highContrastIcons: typeof v.highContrastIcons === 'boolean' ? v.highContrastIcons : d.highContrastIcons,
  };
}

// ─── Text scaling ────────────────────────────────────────────────────────────

/** Display type (≥ 28pt) grows half as much so big headings don't wrap off screen. */
const DISPLAY_TYPE_MIN = 28;

export function scaledFontSize(fontSize: number, scale: number): number {
  if (scale === 1) return fontSize;
  const factor = fontSize >= DISPLAY_TYPE_MIN ? 1 + (scale - 1) / 2 : scale;
  return Math.round(fontSize * factor * 2) / 2;
}

type StyleLike = Record<string, unknown> | null | undefined | false;

/** Flattens RN style arrays (nested, with falsy holes) without importing React Native. */
export function flattenStyle(style: unknown): Record<string, unknown> {
  if (!style) return {};
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>((acc, item) => Object.assign(acc, flattenStyle(item)), {});
  }
  return typeof style === 'object' ? style as Record<string, unknown> : {};
}

/**
 * The style a <Text> renders with at `scale`: the original style plus an
 * override for its own fontSize / lineHeight. Text without its own fontSize
 * inherits from its parent Text, which is already scaled, so it is left alone.
 */
export function scaleTextStyle(style: unknown, scale: number): unknown {
  if (scale === 1 || !style) return style;
  const flat = flattenStyle(style);
  const fontSize = flat.fontSize;
  if (typeof fontSize !== 'number' || !(fontSize > 0)) return style;
  const nextSize = scaledFontSize(fontSize, scale);
  const override: Record<string, number> = { fontSize: nextSize };
  if (typeof flat.lineHeight === 'number' && flat.lineHeight > 0) {
    override.lineHeight = Math.round(flat.lineHeight * (nextSize / fontSize) * 2) / 2;
  }
  return [style as StyleLike, override];
}

// ─── High-contrast icons ─────────────────────────────────────────────────────

type Rgba = { r: number; g: number; b: number; a: number };

const NAMED: Record<string, string> = {
  gray: '#808080', grey: '#808080', silver: '#C0C0C0', darkgray: '#A9A9A9', darkgrey: '#A9A9A9',
  lightgray: '#D3D3D3', lightgrey: '#D3D3D3', dimgray: '#696969', dimgrey: '#696969', white: '#FFFFFF',
};

export function parseColor(input: unknown): Rgba | null {
  if (typeof input !== 'string') return null;
  const value = (NAMED[input.trim().toLowerCase()] ?? input).trim();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
  if (hex) {
    let h = hex[1]!;
    if (h.length <= 4) h = h.split('').map(c => c + c).join('');
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+%?)\s*)?\)$/i.exec(value);
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
    return { r: +rgb[1]!, g: +rgb[2]!, b: +rgb[3]!, a: alpha };
  }
  return null;
}

/**
 * A "muted" icon tint in this black/white/silver app: an opaque silver/grey
 * (#707070 – #E0E0E0, e.g. MUTED #C0C0C0, SUBTLE #B0B0B0, theme.muted) or a
 * see-through white/silver (e.g. `${ON_DARK}E6`). Pure white, black and
 * coloured tints (accent, error, success, gold) are left alone.
 */
export function isMutedIconColor(color: unknown): boolean {
  const c = parseColor(color);
  if (!c) return false;
  const spread = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
  if (spread > 20) return false;
  const level = (c.r + c.g + c.b) / 3;
  if (c.a < 0.98) return level >= 0xA0 && c.a >= 0.3;
  return level >= 0x70 && level <= 0xE0;
}

/** The colour an icon renders with when high-contrast icons are on. */
export function contrastIconColor(color: unknown, foreground: string): unknown {
  return isMutedIconColor(color) ? foreground : color;
}

/** Extra SVG stroke weight for line icons (BuyerNavIcon) when high-contrast icons are on. */
export const HIGH_CONTRAST_STROKE_BONUS = 0.6;
