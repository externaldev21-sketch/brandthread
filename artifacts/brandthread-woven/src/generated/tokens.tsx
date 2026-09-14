/* GENERATED FROM tokens.json -- DO NOT EDIT. Run scripts/build-tokens.mjs. */
// Portable design tokens (colors as hex). Web consumes the theme via
// src/index.css; mobile (Expo) and any other platform import this object so the
// whole product shares one source of truth.
export const tokens = {
  "color": {
    "light": {
      "background": "#F6F3EE",
      "foreground": "#11100F",
      "border": "#D8D1C7",
      "card": "#EEE9E2",
      "cardForeground": "#11100F",
      "popover": "#F6F3EE",
      "popoverForeground": "#11100F",
      "primary": "#17191D",
      "primaryForeground": "#FFFFFF",
      "secondary": "#24211E",
      "secondaryForeground": "#FFFFFF",
      "muted": "#E4DED5",
      "mutedForeground": "#675F57",
      "accent": "#E5E7EB",
      "accentForeground": "#0A0908",
      "destructive": "#C92A2A",
      "destructiveForeground": "#FFFFFF",
      "input": "#CFC6BA",
      "ring": "#34383E",
      "chart1": "#17191D",
      "chart2": "#34383E",
      "chart3": "#6B7280",
      "chart4": "#9CA3AF",
      "chart5": "#D1D5DB",
      "sidebar": "#171513",
      "sidebarForeground": "#F6F3EE",
      "sidebarBorder": "#39332E",
      "sidebarPrimary": "#F6F3EE",
      "sidebarPrimaryForeground": "#171513",
      "sidebarAccent": "#2A2622",
      "sidebarAccentForeground": "#F6F3EE",
      "sidebarRing": "#F6F3EE"
    },
    "dark": {
      "background": "#0A0A0B",
      "foreground": "#F7F7FA",
      "border": "#2A2A2F",
      "card": "#18181B",
      "cardForeground": "#F7F7FA",
      "popover": "#222226",
      "popoverForeground": "#F7F7FA",
      "primary": "#F7F7FA",
      "primaryForeground": "#0A0A0B",
      "secondary": "#222226",
      "secondaryForeground": "#F7F7FA",
      "muted": "#18181B",
      "mutedForeground": "#A1A1AA",
      "accent": "#27272A",
      "accentForeground": "#FFFFFF",
      "destructive": "#E5484D",
      "destructiveForeground": "#FFFFFF",
      "input": "#2A2A2F",
      "ring": "#F7F7FA",
      "chart1": "#F7F7FA",
      "chart2": "#D4D4D8",
      "chart3": "#A1A1AA",
      "chart4": "#71717A",
      "chart5": "#3F3F46",
      "sidebar": "#0A0A0B",
      "sidebarForeground": "#F7F7FA",
      "sidebarBorder": "#2A2A2F",
      "sidebarPrimary": "#F7F7FA",
      "sidebarPrimaryForeground": "#0A0A0B",
      "sidebarAccent": "#18181B",
      "sidebarAccentForeground": "#F7F7FA",
      "sidebarRing": "#F7F7FA"
    }
  },
  "fontFamily": {
    "sans": [
      "Inter",
      "ui-sans-serif",
      "system-ui",
      "sans-serif"
    ],
    "serif": [
      "Inter",
      "ui-sans-serif",
      "system-ui",
      "sans-serif"
    ],
    "mono": [
      "ui-monospace",
      "monospace"
    ]
  },
  "radius": "0.375rem",
  "spacing": "0.25rem"
} as const;

export type Tokens = typeof tokens;
export default tokens;
