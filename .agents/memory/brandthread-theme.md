---
name: Brandthread theme — canonical palette
description: The authoritative app-wide palette, accent boundary, and exclusions for buyer and seller UI
---

**Rule:** Buyer and seller chrome is strictly monochrome: a true near-black `#0A0A0B` base, neutral graphite surfaces, white primary emphasis, and muted-gray supporting text. Compatibility color aliases resolve to grayscale, and dim tokens remain neutral graphite.

**Why:** The user explicitly superseded the blue-violet direction with an app-wide black, white, and gray correction so decorative color never competes with products or status meaning.

**How to apply:** Use white or light gray for primary actions, selected states, links, focus rings, and key chart data; use black text on white primary fills. Preserve semantic red/green/orange only when the color communicates status or risk. Preserve seller-authored storefront palettes, product/canvas colors, creative-tool swatches, avatar seed colors, and third-party provider colors as content rather than app chrome.

**Rule:** Readable mobile text never drops below the 11px `FS.xs` token. `SUBTLE` is the lowest readable text contrast at 50% white on black, and light accent fills always use the dark `onAccent` foreground.

**Why:** Smaller labels, lower-opacity supporting text, and white text on the near-white accent made counts and controls unreadable.

**How to apply:** Use typography tokens instead of raw font sizes, reserve lower-opacity values for non-text decoration, and pair every accent-backed badge, pill, or button with its theme foreground token.

**Rule:** Inter is the UI family: 700/600 for titles and actions, 400/500 for body and labels. Thin/light/extrabold aliases resolve to supported regular/bold weights.

**Why:** This provides a bold sans hierarchy without destabilizing the Expo font setup.

**How to apply:** Do not reintroduce condensed display or serif UI fonts into app chrome. Seller-authored typography inside storefront content remains user data.
