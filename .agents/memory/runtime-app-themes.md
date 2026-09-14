---
name: Runtime app themes
description: Legacy persisted theme IDs remain valid while every preset resolves to the canonical visual system
---

**Rule:** Keep existing persisted theme IDs readable, but every preset resolves to `#5B5CFF`, neutral graphite dim fills, and the same near-black shell. Runtime selection no longer changes the buyer/seller chrome hue.

**Why:** Removing IDs would break saved settings, while retaining multicolor output would violate the one-accent app-wide direction.

**How to apply:** Continue using the shared provider so existing screens and stored values work, but do not introduce new preset hues or recolor the shared shell. Explicit semantic colors and deliberate content/color-picker/storefront colors remain untouched.