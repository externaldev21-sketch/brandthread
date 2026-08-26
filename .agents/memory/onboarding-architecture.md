---
name: Onboarding flow decisions
description: Durable Brandthread onboarding progression and draft-compatibility rules.
---

Seller onboarding should collect identity and brand context before authentication, then continue with brand stage and optional goals; product-model selection belongs later in product or store setup.

**Why:** Brandthread's seller onboarding is intended to get a new seller into their workspace quickly, and requiring a product model at account creation introduced a decision that is better made once they are ready to create products.

**How to apply:** Preserve the eight-step seller total and one-time draft-step translation whenever the flow order changes. Keep buyer style interests and seller goals skippable. Pre-auth answers stay in memory; write and restore drafts only under the signed-in Clerk user's immutable ID.

For a brand-new local session, the first-run path is the animated splash, then account-type choice and the pre-auth profile prompts, then authentication. The splash can be skipped with its CTA but also auto-advances quickly; do not route through the legacy marketing welcome page in this flow.

**Why:** The logo moment sets the brand tone without adding another decision or marketing screen before sign-up.

**How to apply:** Preserve direct splash-to-account-type replace navigation and keep account type as the first non-backtracking decision before the pre-auth profile prompts and authenticated onboarding steps.
