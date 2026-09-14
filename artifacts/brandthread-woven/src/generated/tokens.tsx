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
      "primary": "#5B5CFF",
      "primaryForeground": "#FFFFFF",
      "secondary": "#24211E",
      "secondaryForeground": "#FFFFFF",
      "muted": "#E4DED5",
      "mutedForeground": "#675F57",
      "accent": "#5B5CFF",
      "accentForeground": "#0A0908",
      "destructive": "#C92A2A",
      "destructiveForeground": "#FFFFFF",
      "input": "#CFC6BA",
      "ring": "#5B5CFF",
      "chart1": "#5B5CFF",
      "chart2": "#9B5DE5",
      "chart3": "#0E9488",
      "chart4": "#E8A317",
      "chart5": "#B43A66",
      "sidebar": "#171513",
      "sidebarForeground": "#F6F3EE",
      "sidebarBorder": "#39332E",
      "sidebarPrimary": "#5B5CFF",
      "sidebarPrimaryForeground": "#0A0908",
      "sidebarAccent": "#2A2622",
      "sidebarAccentForeground": "#F6F3EE",
      "sidebarRing": "#5B5CFF"
    },
    "dark": {
      "background": "#0A0A0B",
      "foreground": "#F7F7FA",
      "border": "#2A2A2F",
      "card": "#18181B",
      "cardForeground": "#F7F7FA",
      "popover": "#222226",
      "popoverForeground": "#F7F7FA",
      "primary": "#5B5CFF",
      "primaryForeground": "#FFFFFF",
      "secondary": "#222226",
      "secondaryForeground": "#F7F7FA",
      "muted": "#18181B",
      "mutedForeground": "#A1A1AA",
      "accent": "#5B5CFF",
      "accentForeground": "#FFFFFF",
      "destructive": "#E5484D",
      "destructiveForeground": "#FFFFFF",
      "input": "#2A2A2F",
      "ring": "#5B5CFF",
      "chart1": "#5B5CFF",
      "chart2": "#8B8CFF",
      "chart3": "#5B5CFF",
      "chart4": "#F1B943",
      "chart5": "#E66B9A",
      "sidebar": "#0A0A0B",
      "sidebarForeground": "#F7F7FA",
      "sidebarBorder": "#2A2A2F",
      "sidebarPrimary": "#5B5CFF",
      "sidebarPrimaryForeground": "#FFFFFF",
      "sidebarAccent": "#18181B",
      "sidebarAccentForeground": "#F7F7FA",
      "sidebarRing": "#5B5CFF"
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
