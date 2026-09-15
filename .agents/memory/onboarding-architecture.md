---
name: Onboarding flow decisions
description: Durable Brandthread onboarding progression and draft-compatibility rules.
---

Path selection precedes Clerk account creation. Buyer and seller use the same stacked-field Clerk account form at Auth. Buyer then continues through Name, Style, Loading, Notifications, Success, and a one-time Thread explainer. Seller continues through Name, Brand Name, Brand Stage, Goals, Plan, Loading, Notifications, and Success. Product-model selection belongs later in product or store setup.

**Why:** The user explicitly requires buyers and sellers to choose their path first but see one identical account-creation experience; divergence starts only after account creation.

**How to apply:** Keep Account Type at index 0 and shared Auth at index 1. Keep Google and Apple as one-tap options on that shared form, independent of manual-field validity. Preserve later questions, migrate older drafts to equivalent screens, keep buyer Style and seller Goals skippable, persist only the pre-auth role as ephemeral pending state, and move durable drafts under the signed-in Clerk user.

For a brand-new local session, the first-run path is a brief auto-advancing logo-only splash, then Account Type, then the shared Clerk account form.

**Why:** The user explicitly requires branding to appear before any choice or form while keeping account creation visually and functionally identical across roles.

**How to apply:** Route create-account entry through onboarding Account Type, never the legacy standalone route. Preserve the pending role across Clerk redirects, and require an owner-matched buyer role before showing the Thread explainer.

Onboarding completion is a final server-authoritative transition shared by buyer and seller flows. Required profile/brand writes must succeed first; only then may the server persist completion and the client bind local routing state to the Clerk user.

**Why:** Marking completion during an earlier sync can let a username collision, interrupted profile write, or app exit leave a partially configured account that skips onboarding on its next sign-in.

**How to apply:** Keep generic identity sync idempotent but incomplete. Commit completion through the dedicated final operation, restore completed roles from the server on new devices, and use same-user local completion only to upgrade older installs.
