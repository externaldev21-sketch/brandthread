---
name: Brandthread dark theme
description: Dark luxury color palette used throughout the Brandthread Expo app
---

The Brandthread app uses a fully dark luxury aesthetic. Both `light` and `dark` keys in `constants/colors.ts` are identical (dark mode by design).

Key tokens:
- background: #0D0D0D
- card: #181818
- primary: #C9A96E (warm gold)
- primaryForeground: #0D0D0D
- secondary: #222222
- border: #2A2A2A
- success: #22C55E, warning: #F59E0B, destructive: #EF4444, info: #3B82F6

**Why:** The brand is a luxury clothing platform — a dark premium aesthetic matches the positioning. Using identical light/dark palettes prevents jarring mode switches since the intended look is always dark.

**How to apply:** When adding new screens, always reference useColors() and never hardcode hex values. For gold accents use colors.primary; for elevated surfaces use '#1A1500' (dark amber) with borderColor '#C9A96E44'.
