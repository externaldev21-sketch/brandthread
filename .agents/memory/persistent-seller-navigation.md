---
name: Persistent seller navigation
description: User-confirmed rule for seller tab-bar visibility and screen back navigation.
---

The seller tab bar belongs to the signed-in seller app shell and must remain visible on every seller route, including details, editors, media creation, live tools, plans, Design Studio, and seller visits to shared/public screens. Individual screens must not decide whether to hide it.

**Why:** The user found Design Studio without either a back arrow or the seller tab bar and explicitly required the bar on “every single screen, no matter what.”

**How to apply:** Mount exactly one bar outside child tab navigators, derive active state from the current route, and keep navigation-critical labels visible without depending solely on icon fonts. Exclude only boot, auth, onboarding, legal, and the buyer app shell, where no signed-in seller shell exists. Normal root screens should still provide a clear back action.