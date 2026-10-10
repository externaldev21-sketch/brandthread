/**
 * Design choices for the seller's store website (brandthread.app/@handle).
 *
 * Deliberately small (Linktree's "Theme" + "Style" sheets, cut down): seven
 * curated themes, two button shapes, three fonts. Every font is a system
 * stack, so the page never fetches a web font. The mobile editor keeps a copy
 * of THEMES in artifacts/mobile/lib/storeSiteDesign.ts; a test there checks
 * the two stay identical.
 */

export type StoreSiteTheme = {
  key: string;
  label: string;
  /** Page background. */
  bg: string;
  /** Primary text, icons. */
  fg: string;
  /** Secondary text (bio, prices). */
  muted: string;
  /** Hairlines, empty image tiles. */
  line: string;
  /** Link buttons and the Buy button. */
  buttonBg: string;
  buttonFg: string;
};

export const STORE_SITE_THEMES: readonly StoreSiteTheme[] = [
  { key: "black",    label: "Black",    bg: "#000000", fg: "#FFFFFF", muted: "#C0C0C0", line: "#1C1C1E", buttonBg: "#FFFFFF", buttonFg: "#000000" },
  { key: "white",    label: "White",    bg: "#FFFFFF", fg: "#000000", muted: "#6E6E73", line: "#E5E5EA", buttonBg: "#000000", buttonFg: "#FFFFFF" },
  { key: "silver",   label: "Silver",   bg: "#D1D1D6", fg: "#000000", muted: "#3A3A3C", line: "#C0C0C0", buttonBg: "#000000", buttonFg: "#FFFFFF" },
  { key: "graphite", label: "Graphite", bg: "#1C1C1E", fg: "#FFFFFF", muted: "#AEAEB2", line: "#2C2C2E", buttonBg: "#C0C0C0", buttonFg: "#000000" },
  { key: "bone",     label: "Bone",     bg: "#F2EFE9", fg: "#1C1C1E", muted: "#6E6A64", line: "#E2DDD4", buttonBg: "#1C1C1E", buttonFg: "#F2EFE9" },
  { key: "navy",     label: "Navy",     bg: "#0B1A2E", fg: "#FFFFFF", muted: "#A9B4C2", line: "#1B2B42", buttonBg: "#FFFFFF", buttonFg: "#0B1A2E" },
  { key: "oxblood",  label: "Oxblood",  bg: "#3A0C12", fg: "#FFFFFF", muted: "#D9B8BC", line: "#4E1820", buttonBg: "#FFFFFF", buttonFg: "#3A0C12" },
] as const;

export const DEFAULT_STORE_SITE_THEME = "black";

export const BUTTON_STYLES = ["rounded", "square"] as const;
export type ButtonStyle = (typeof BUTTON_STYLES)[number];

export const STORE_SITE_FONTS = {
  system: { label: "Classic", stack: '-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Helvetica,Arial,sans-serif' },
  serif:  { label: "Editorial", stack: '"New York",ui-serif,Georgia,"Times New Roman",serif' },
  mono:   { label: "Mono", stack: 'ui-monospace,"SF Mono",Menlo,Consolas,monospace' },
} as const;
export type StoreSiteFont = keyof typeof STORE_SITE_FONTS;

/** Most link buttons a store website shows (Dev: "up to 5 buttons"). */
export const MAX_STORE_SITE_LINKS = 5;
/** Most products the grid shows; featured ones come first. */
export const MAX_STORE_SITE_PRODUCTS = 24;

/**
 * Theme key for a stored value. Pages saved before the store website used
 * "mono" (light) and "dark"; they keep their look as White and Black.
 */
export function resolveStoreSiteThemeKey(raw: unknown): string {
  if (raw === "mono") return "white";
  if (raw === "dark") return "black";
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
