---
name: Onboarding flow decisions
description: Durable Brandthread onboarding progression and draft-compatibility rules.
---

Onboarding starts with authentication for both account types, then collects buyer identity/style or seller identity/brand context; seller goals remain optional and product-model selection belongs later in product or store setup.

**Why:** Account creation should happen immediately after the buyer/seller choice so the rest of the onboarding draft can resume against a known Clerk identity, while product-model selection remains a later product/store decision.

**How to apply:** Preserve the eight-step seller total and one-time draft-step translation whenever the flow order changes. Keep buyer style interests and seller goals skippable. Pre-auth answers stay in memory; write and restore drafts only under the signed-in Clerk user's immutable ID.

For a brand-new local session, the first-run path is the animated splash, then account-type choice, then authentication. The splash can be skipped with its CTA but also auto-advances quickly; do not route through the legacy marketing welcome page in this flow.

**Why:** The logo moment sets the brand tone without adding another decision or marketing screen before sign-up.

**How to apply:** Preserve direct splash-to-account-type replace navigation and keep account type as the first non-backtracking decision before the authenticated onboarding steps.