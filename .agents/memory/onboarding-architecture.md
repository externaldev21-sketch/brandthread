---
name: Onboarding flow decisions
description: Durable Brandthread onboarding progression and draft-compatibility rules.
---

Clerk account creation is the literal first onboarding step after account-type selection for both roles. Buyer order is Auth, Name, Style, Loading, Notifications, Success. Seller order is Auth, Name, Brand Name, Brand Stage, Goals, Loading, Notifications, Success. Product-model selection belongs later in product or store setup.

**Why:** The user explicitly requires account ownership to exist before any personal or brand questionnaire data is collected, and prior attempts left Name and Brand Name before Auth.

**How to apply:** Keep Auth at index 0 for both roles. Preserve the six-step buyer and eight-step seller totals, migrate older draft indexes to equivalent screens, keep buyer Style and seller Goals skippable, and only persist drafts under the signed-in Clerk user's immutable ID.

For a brand-new local session, the first-run path is the animated splash, then account-type choice, then authentication before profile prompts. The splash can be skipped with its CTA but also auto-advances quickly; do not route through the legacy marketing welcome page in this flow.

**Why:** The logo moment sets the brand tone without adding another decision or marketing screen before sign-up.

**How to apply:** Preserve direct splash-to-account-type replace navigation and keep account type as the first non-backtracking decision before Auth begins the role-specific onboarding flow.
