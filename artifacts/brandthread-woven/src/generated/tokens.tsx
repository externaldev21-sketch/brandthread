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
      "primary": "#E84624",
      "primaryForeground": "#FFFFFF",
      "secondary": "#24211E",
      "secondaryForeground": "#FFFFFF",
      "muted": "#E4DED5",
      "mutedForeground": "#675F57",
      "accent": "#FF5A36",
      "accentForeground": "#0A0908",
      "destructive": "#C92A2A",
      "destructiveForeground": "#FFFFFF",
      "input": "#CFC6BA",
      "ring": "#E84624",
      "chart1": "#E84624",
      "chart2": "#9B5DE5",
      "chart3": "#0E9488",
      "chart4": "#E8A317",
      "chart5": "#B43A66",
      "sidebar": "#171513",
      "sidebarForeground": "#F6F3EE",
      "sidebarBorder": "#39332E",
      "sidebarPrimary": "#FF5A36",
      "sidebarPrimaryForeground": "#0A0908",
      "sidebarAccent": "#2A2622",
      "sidebarAccentForeground": "#F6F3EE",
      "sidebarRing": "#FF5A36"
    },
    "dark": {
      "background": "#080808",
      "foreground": "#F4F1EC",
      "border": "#302D2A",
      "card": "#121110",
      "cardForeground": "#F4F1EC",
      "popover": "#171513",
      "popoverForeground": "#F4F1EC",
      "primary": "#FF5A36",
      "primaryForeground": "#0A0908",
      "secondary": "#23201D",
      "secondaryForeground": "#F4F1EC",
      "muted": "#1B1917",
      "mutedForeground": "#A49D95",
      "accent": "#FF5A36",
      "accentForeground": "#0A0908",
      "destructive": "#E5484D",
      "destructiveForeground": "#FFFFFF",
      "input": "#37322E",
      "ring": "#FF5A36",
      "chart1": "#FF5A36",
      "chart2": "#B27AF2",
      "chart3": "#24B5A9",
      "chart4": "#F1B943",
      "chart5": "#E66B9A",
      "sidebar": "#0D0C0B",
      "sidebarForeground": "#F4F1EC",
      "sidebarBorder": "#302D2A",
      "sidebarPrimary": "#FF5A36",
      "sidebarPrimaryForeground": "#0A0908",
      "sidebarAccent": "#211E1B",
      "sidebarAccentForeground": "#F4F1EC",
      "sidebarRing": "#FF5A36"
    }
  },
  "fontFamily": {
    "sans": [
      "Barlow Condensed",
      "Arial Narrow",
      "sans-serif"
    ],
    "serif": [
      "Cormorant Garamond",
      "Georgia",
      "serif"
    ],
    "mono": [
      "IBM Plex Mono",
      "monospace"
    ]
  },
  "radius": "0.375rem",
  "spacing": "0.25rem"
} as const;

export type Tokens = typeof tokens;
export default tokens;
