---
name: Brandthread theme — Vault Archive
description: Editorial lookbook theme (bone/black ink + blood-orange accent) replacing the earlier purple/violet SaaS palette
---

The app was rebranded from a purple/violet gradient-heavy "AI SaaS" look to **Vault Archive**: an editorial fashion-lookbook aesthetic — bone/paper backgrounds, near-black ink text, a single blood-orange accent, warm hairline borders, sharper corners, and flattened (non-neon) gradients.

**Light mode** (`colors.light`): background `#F2EEE3` (bone), text/foreground `#17140F` (warm ink), card `#FFFFFF`, primary `#B33F1E`, secondary `#E8E1CF` (oat/tan), border `#DBD3C0`, mutedForeground `#6E6759`.

**Dark mode** (`colors.dark`): background `#121110` (warm near-black), card `#1B1917`, foreground `#EDE7D9` (cream), primary `#C94D1F`, secondary `#201D18`, border `#33302A`, mutedForeground `#8C8577`.

Shared `radius` token dropped from 12 → 6 for a flatter, less "rounded SaaS card" feel.

**Why:** User explicitly said the app "looked AI-made" — the tell was purple/violet gradients, heavy glow shadows, and generic rounded SaaS card style. Chose an editorial/fashion-lookbook direction to match the clothing-brand-management domain instead of a generic tech palette.

**How to apply:** Always source colors via `useColors()` / `constants/colors.ts` tokens, not new hardcoded hex. Multi-color "brand differentiator" chips (e.g. per-brand avatar rings: blue, teal, rose, amber) were intentionally left alone — only the *system-wide* purple/lavender tokens and neon story/tab gradients were converted to the warm rust/orange family. When adding new UI, keep gradients duotone/flat (e.g. `['#D9714B', '#C1440E', '#B33F1E']`) rather than multi-hue neon, and prefer hairline `border` dividers over heavy colored shadows/glows.

A global hex-remapping script (Node, longest-key-first substring replace) was used to convert ~34 files at once — a fast way to do consistent app-wide rebrands when a design-token system already exists, faster than hand-editing each file. Also watch for stray non-token hex values the automated pass misses (e.g. one-off colors in mock data or muted label text) — grep for old hue's hex range after any bulk rebrand and re-run a targeted architect review for leftovers + contrast regressions (e.g. white text on a newly-brightened accent color can drop below AA contrast).
