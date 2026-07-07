---
name: Brandthread theme — purple
description: Purple/black dual-mode theme replacing the original gold palette
---

The app switched from a gold luxury palette to a purple/black professional palette with genuine light and dark mode support.

**Dark mode** (`colors.dark`):
- background: #08080F (near-black with purple tint)
- card: #111118
- primary: #9F7AEA (vivid violet)
- primaryForeground: #FFFFFF
- secondary: #1C1C2E
- border: #252535
- foreground: #F0EEFF
- mutedForeground: #6B6B8A

**Light mode** (`colors.light`):
- background: #F8F7FF (light lavender)
- card: #FFFFFF
- primary: #7C3AED (deeper purple for contrast on white)
- primaryForeground: #FFFFFF
- secondary: #EDE9FE
- border: #DDD6FE
- foreground: #1A1035
- mutedForeground: #6D6892

**Hardcoded purple equivalents** (used in gradient/special cards):
- Hero gradient dark: ['#2A1060', '#130828', '#08080F']
- Hero gradient light: ['#EDE9FE', '#C4B5FD', '#F4F0FF']
- Purple tints: #9F7AEA22, #9F7AEA44, #9F7AEA33 etc.
- Dark card bg: #0F0A1E (replaces old #1A1500 gold card)

**Why:** User requested a professional purple + black theme with light/dark mode support. Gold (#C9A96E) was fully removed via global sed across all files. Both `colors.light` and `colors.dark` are now genuinely distinct palettes.

**How to apply:** Always use `colors.primary` from `useColors()` for purple accents. For gradients, use `useColorScheme()` to branch between dark/light gradient arrays. Hardcoded opacity variants follow the `#9F7AEA` hex base.
