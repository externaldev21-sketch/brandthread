---
name: Temporary Growth gate bypass
description: Records the temporary testing policy for seller Growth-plan feature enforcement.
---

Seller Growth-plan feature enforcement is temporarily disabled through one shared switch. Keep Growth plan definitions, subscription state, pricing, feature metadata, and upsell components intact.

**Why:** Active seller testing needs unrestricted access to Studio tools regardless of the tester's current plan, without making a destructive or difficult-to-reverse billing change.

**How to apply:** New client-side Growth gates must honor the shared enforcement switch. Re-enable the switch when testing ends rather than reconstructing individual gate checks.