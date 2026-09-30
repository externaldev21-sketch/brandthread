---
name: Persistent seller navigation
description: User-confirmed rule for seller tab-bar visibility and screen back navigation.
---

The seller tab bar belongs to the signed-in seller app shell and remains visible on ordinary seller routes, including details, plans, Design Studio, and seller visits to shared/public screens. Explicit full-screen flows with their own bottom controls are exceptions. In particular, the owner decided that Brandthread AI is a full-screen chat with no seller tab bar; its composer clears only the safe-area inset, not the tab bar's height.

**Why:** The user found Design Studio without either a back arrow or the seller tab bar and initially required the bar on “every single screen, no matter what.” The owner later explicitly chose full-screen AI: reserving the seller bar beneath its composer left about 94px of dead space in the live preview.

**How to apply:** Mount exactly one bar outside child tab navigators, derive active state from the current route, and keep navigation-critical labels visible without depending solely on icon fonts. Hide it for boot, auth, onboarding, legal, the buyer app shell, and explicitly designated full-screen flows such as Brandthread AI. Normal root screens should still provide a clear back action.

For a Studio-launched tool, “the previous screen” can mean the Studio selection overlay rather than its underlying dashboard route.

**Why:** The user clarified this for Payouts and repeated the same request for Analytics: leaving a Studio tool should restore the selection menu so they can choose another item, not expose the dashboard.

**How to apply:** Preserve the launch origin when restoring a selection overlay. Returning should allow a new choice without restarting auto-entry; do not change back behavior for launches from unrelated screens.