/**
 * Design choices for the seller's store (brandthread.app/@handle).
 *
 * Stan Store's "Edit Design": a handful of preset themes, each just a
 * background and an accent (the colour of every product button). Black,
 * white and silver only; the page always uses the system font. The mobile
 * app keeps a copy of THEMES in artifacts/mobile/lib/storeSiteDesign.ts; a
 * test there checks the two stay identical.
 */

export type StoreSiteTheme = {
  key: string;
  label: string;
  /** Page background. */
  bg: string;
  /** Primary text, icons. */
  fg: string;
  /** Secondary text (bio, subtitles, ship-by dates). */
  muted: string;
  /** Hairlines, empty image tiles, form field borders. */
  line: string;
  /** Product block and form field background. */
  card: string;
  /** Accent: product buttons and the checkout button. */
  buttonBg: string;
  buttonFg: string;
};

export const STORE_SITE_THEMES: readonly StoreSiteTheme[] = [
  { key: "black",    label: "Black",    bg: "#000000", fg: "#FFFFFF", muted: "#AEAEB2", line: "#2C2C2E", card: "#1C1C1E", buttonBg: "#FFFFFF", buttonFg: "#000000" },
  { key: "white",    label: "White",    bg: "#FFFFFF", fg: "#000000", muted: "#6E6E73", line: "#E5E5EA", card: "#F2F2F7", buttonBg: "#000000", buttonFg: "#FFFFFF" },
  { key: "silver",   label: "Silver",   bg: "#D1D1D6", fg: "#000000", muted: "#3A3A3C", line: "#C7C7CC", card: "#F2F2F7", buttonBg: "#000000", buttonFg: "#FFFFFF" },
  { key: "graphite", label: "Graphite", bg: "#1C1C1E", fg: "#FFFFFF", muted: "#AEAEB2", line: "#3A3A3C", card: "#2C2C2E", buttonBg: "#C0C0C0", buttonFg: "#000000" },
  { key: "onyx",     label: "Onyx",     bg: "#000000", fg: "#FFFFFF", muted: "#8E8E93", line: "#2C2C2E", card: "#1C1C1E", buttonBg: "#C0C0C0", buttonFg: "#000000" },
] as const;

/** Themes from the first store website editor, shown as their nearest preset. */
const LEGACY_THEMES: Record<string, string> = { mono: "white", dark: "black", bone: "white", navy: "black", oxblood: "black" };

export const DEFAULT_STORE_SITE_THEME = "black";

/**
 * Button shape and font from the first editor. Still accepted and stored so
 * older app builds keep saving, but the store page no longer uses them.
 */
export const BUTTON_STYLES = ["rounded", "square"] as const;
export type ButtonStyle = (typeof BUTTON_STYLES)[number];

export const STORE_SITE_FONTS = {
  system: { label: "Classic", stack: '-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Helvetica,Arial,sans-serif' },
  serif:  { label: "Editorial", stack: '"New York",ui-serif,Georgia,"Times New Roman",serif' },
  mono:   { label: "Mono", stack: 'ui-monospace,"SF Mono",Menlo,Consolas,monospace' },
} as const;
export type StoreSiteFont = keyof typeof STORE_SITE_FONTS;

/** Most link buttons the older link-in-bio editor keeps (the store page no longer shows them). */
export const MAX_STORE_SITE_LINKS = 5;
/** Most product blocks a store shows. */
export const MAX_STORE_SITE_PRODUCTS = 24;

/**
 * Theme key for a stored value. Older pages used "mono" (light), "dark" and
 * a few coloured themes; they show as the nearest preset.
 */
export function resolveStoreSiteThemeKey(raw: unknown): string {
  if (typeof raw === "string" && LEGACY_THEMES[raw]) return LEGACY_THEMES[raw];
  return typeof raw === "string" && STORE_SITE_THEMES.some((t) => t.key === raw) ? raw : DEFAULT_STORE_SITE_THEME;
}

export function storeSiteTheme(raw: unknown): StoreSiteTheme {
  const key = resolveStoreSiteThemeKey(raw);
  return STORE_SITE_THEMES.find((t) => t.key === key) ?? STORE_SITE_THEMES[0];
}

/** Validated theme key for a write, or null when it isn't one we offer. */
export function normalizeStoreSiteTheme(raw: unknown): string | null {
  if (raw === "mono" || raw === "dark") return raw;
  return typeof raw === "string" && STORE_SITE_THEMES.some((t) => t.key === raw) ? raw : null;
}

export function normalizeButtonStyle(raw: unknown): ButtonStyle | null {
  return (BUTTON_STYLES as readonly unknown[]).includes(raw) ? (raw as ButtonStyle) : null;
}

export function normalizeStoreSiteFont(raw: unknown): StoreSiteFont | null {
  return typeof raw === "string" && Object.prototype.hasOwnProperty.call(STORE_SITE_FONTS, raw) ? (raw as StoreSiteFont) : null;
}

export function buttonStyleOf(raw: unknown): ButtonStyle {
  return normalizeButtonStyle(raw) ?? "rounded";
}

export function fontOf(raw: unknown): StoreSiteFont {
  return normalizeStoreSiteFont(raw) ?? "system";
}

/** An https image URL safe to put in an attribute, or null. */
export function normalizeImageUrl(raw: unknown): string | null {
  return typeof raw === "string" && /^https:\/\/\S{1,1000}$/.test(raw) && !/[<>"'\\]/.test(raw) ? raw : null;
}

/** "@Nova_Goods" / "nova_goods" → "nova_goods"; null if it can't be a username (auth.ts USERNAME_REGEX). */
export function normalizeStoreHandle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().replace(/^@/, "").toLowerCase();
  return /^[a-z0-9_]{3,30}$/.test(v) ? v : null;
}
