---
name: Promote objective boundary
description: Defines what the current Boost objective supports and what requires a later delivery system.
---

Boost creation defaults to the persisted `views` objective and does not ask sellers to choose Likes, Followers, or Profile visits. Do not claim that current delivery is objective-optimized.

**Why:** Sellers asked for a simpler existing-post → budget/duration → payment flow. The delivery engine still lacks reliable exposure-to-like/follow/profile-visit attribution, so additional objective choices would imply unsupported optimization.

**How to apply:** Preserve the objective field for stored-data and API compatibility, but default new Boosts to Views. Add objective choices only after exposure attribution and objective-specific ranking weights are implemented.