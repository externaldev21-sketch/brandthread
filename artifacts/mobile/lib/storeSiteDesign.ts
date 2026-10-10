/**
 * The store website's design choices (brandthread.app/@handle), for the
 * in-app previews. Copy of artifacts/api-server/src/lib/growth/storeSiteDesign.ts
 * — tests/store-site-design-parity.test.ts fails if the two drift apart.
 */
export type StoreSiteTheme = {
  key: string;
  label: string;
  bg: string;
  fg: string;
  muted: string;
  line: string;
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

/** A QR code must stay dark-on-light to scan, whatever the app or site theme. */
export const QR_LIGHT = "#FFFFFF";
export const QR_DARK = "#000000";

export type ButtonStyle = "rounded" | "square";
export type StoreSiteFont = "system" | "serif" | "mono";

/** Labels match the server's STORE_SITE_FONTS; families are the native equivalents of its CSS stacks. */
export const STORE_SITE_FONTS: readonly { key: StoreSiteFont; label: string }[] = [
  { key: "system", label: "Classic" },
  { key: "serif", label: "Editorial" },
  { key: "mono", label: "Mono" },
];

export const MAX_STORE_SITE_LINKS = 5;

export function storeSiteTheme(key: string | null | undefined): StoreSiteTheme {
  const k = key === "mono" ? "white" : key === "dark" ? "black" : key;
  return STORE_SITE_THEMES.find((t) => t.key === k) ?? STORE_SITE_THEMES[0];
}

/** Font family for a site font on this platform (undefined = the system font). */
export function storeSiteFontFamily(font: StoreSiteFont, os: string): string | undefined {
  if (font === "serif") return os === "ios" ? "New York" : os === "web" ? 'ui-serif, Georgia, "Times New Roman", serif' : "serif";
  if (font === "mono") return os === "ios" ? "Menlo" : os === "web" ? 'ui-monospace, Menlo, Consolas, monospace' : "monospace";
  return undefined;
}
