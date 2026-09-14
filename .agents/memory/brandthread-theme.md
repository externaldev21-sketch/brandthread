---
name: Brandthread theme — canonical palette
description: The authoritative app-wide palette, accent boundary, and exclusions for buyer and seller UI
---

**Rule:** Buyer and seller chrome use a true near-black `#0A0A0B` base, neutral graphite surfaces, white/muted-grey text, and one saturated `#5B5CFF` accent. Compatibility dim tokens resolve to a subtle neutral graphite—not an accent tint—so selected states remain visible without broad colored washes.

**Why:** The user replaced earlier navy, chrome, multicolor runtime, and Woven directions with one consistent system. Broad translucent blue-violet backgrounds made the app read navy instead of black.

**How to apply:** Use the accent only for primary actions, selected states, links, badges, live/status indicators, focus rings, and key chart data. Keep the shared route shell neutral near-black. Preserve semantic red/green/orange, seller-authored storefront palettes, product/canvas colors, creative-tool swatches, and third-party provider colors.

**Rule:** Inter is the UI family: 700/600 for titles and actions, 400/500 for body and labels. Thin/light/extrabold aliases resolve to supported regular/bold weights.

**Why:** This provides a bold sans hierarchy without destabilizing the Expo font setup.

**How to apply:** Do not reintroduce condensed display or serif UI fonts into app chrome. Seller-authored typography inside storefront content remains user data.
