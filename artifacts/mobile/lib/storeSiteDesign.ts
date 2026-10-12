/**
 * The store's design presets (brandthread.app/@handle), for the in-app
 * previews. Copy of artifacts/api-server/src/lib/growth/storeSiteDesign.ts —
 * tests/store-site-design-parity.test.ts fails if the two drift apart.
 *
 * Stan Store's "Edit Design": each preset is a background and an accent
 * (the product buttons). Black, white and silver only; system font.
 */
export type StoreSiteTheme = {
  key: string;
  label: string;
  bg: string;
  fg: string;
  muted: string;
  line: string;
  card: string;
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

export const DEFAULT_STORE_SITE_THEME = "black";

/** Themes from the first store website editor, shown as their nearest preset. */
const LEGACY_THEMES: Record<string, string> = { mono: "white", dark: "black", bone: "white", navy: "black", oxblood: "black" };

/** A QR code must stay dark-on-light to scan, whatever the app or site theme. */
export const QR_LIGHT = "#FFFFFF";
export const QR_DARK = "#000000";

export function storeSiteTheme(key: string | null | undefined): StoreSiteTheme {
  const k = key && LEGACY_THEMES[key] ? LEGACY_THEMES[key] : key;
  return STORE_SITE_THEMES.find((t) => t.key === k) ?? STORE_SITE_THEMES[0];
}
