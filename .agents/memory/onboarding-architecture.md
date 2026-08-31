---
name: Onboarding flow decisions
description: Durable Brandthread onboarding progression and draft-compatibility rules.
---

Clerk account creation is the literal first onboarding step for both roles. Account type is chosen only after authentication. Buyer order is Auth, Account Type, Name, Style, Loading, Notifications, Success. Seller order is Auth, Account Type, Name, Brand Name, Brand Stage, Goals, Loading, Notifications, Success. Product-model selection belongs later in product or store setup.

**Why:** The user explicitly requires account ownership to exist before role choice or any personal or brand questionnaire data is collected.

**How to apply:** Keep Auth at index 0 and Account Type at index 1. Preserve the seven-step buyer and nine-step seller totals, migrate older drafts to equivalent screens, keep buyer Style and seller Goals skippable, and only persist drafts under the signed-in Clerk user's immutable ID.

For a brand-new local session, the first-run path is one animated Splash/Get Started screen, then generic Clerk account creation, then Account Type.

**Why:** The user explicitly requires one deliberate Get Started action before account creation and requires the buyer/seller decision immediately after the account exists.

**How to apply:** Route all create-account entry points to onboarding Auth, never to the legacy standalone account-type route. Role-specific questions begin only after the authenticated user chooses Buyer or Seller.

Onboarding completion is a final server-authoritative transition shared by buyer and seller flows. Required profile/brand writes must succeed first; only then may the server persist completion and the client bind local routing state to the Clerk user.

**Why:** Marking completion during an earlier sync can let a username collision, interrupted profile write, or app exit leave a partially configured account that skips onboarding on its next sign-in.

**How to apply:** Keep generic identity sync idempotent but incomplete. Commit completion through the dedicated final operation, restore completed roles from the server on new devices, and use same-user local completion only to upgrade older installs.
