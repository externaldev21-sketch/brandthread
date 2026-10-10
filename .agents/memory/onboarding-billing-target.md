---
name: Onboarding billing target
description: Owner's expected seller plan placement and trial terms
---

**Rule:** The owner expects plan selection after the store preview, with a seven-day trial requiring a payment method.

**Why:** The owner explicitly described this as the intended new seller onboarding experience. A fetched implementation or its description is not proof that these billing requirements are present.

**How to apply:** Verify the actual flow and provider configuration before reporting this target as implemented. Preserve native RevenueCat and web Stripe boundaries. Do not merely advertise seven days while the provider or server still enforces five, or collect raw card details in native onboarding.
