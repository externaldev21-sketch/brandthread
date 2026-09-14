---
name: Onboarding flow decisions
description: Durable Brandthread onboarding progression and draft-compatibility rules.
---

Path selection precedes Clerk account creation. Buyer order is Account Type, buyer-specific Auth, Name, Style, Loading, Notifications, Success, then a one-time Thread explainer. Seller order is Account Type, seller-specific Auth, Name, Brand Name, Brand Stage, Goals, Plan, Loading, Notifications, Success. Product-model selection belongs later in product or store setup.

**Why:** The user explicitly requires buyers and sellers to choose their path before seeing a role-specific account-creation experience.

**How to apply:** Keep Account Type at index 0 and Auth at index 1. Preserve later questions, migrate older drafts to equivalent screens, keep buyer Style and seller Goals skippable, persist only the pre-auth role as ephemeral pending state, and move durable drafts under the signed-in Clerk user.

For a brand-new local session, the first-run path is a brief auto-advancing logo-only splash, then Account Type, then role-specific Clerk account creation.

**Why:** The user explicitly requires branding to appear before any choice or form and the buyer/seller decision to shape the account-creation pattern.

**How to apply:** Route create-account entry through onboarding Account Type, never the legacy standalone route. Preserve the pending role across Clerk redirects, and require an owner-matched buyer role before showing the Thread explainer.

Onboarding completion is a final server-authoritative transition shared by buyer and seller flows. Required profile/brand writes must succeed first; only then may the server persist completion and the client bind local routing state to the Clerk user.

**Why:** Marking completion during an earlier sync can let a username collision, interrupted profile write, or app exit leave a partially configured account that skips onboarding on its next sign-in.

**How to apply:** Keep generic identity sync idempotent but incomplete. Commit completion through the dedicated final operation, restore completed roles from the server on new devices, and use same-user local completion only to upgrade older installs.
