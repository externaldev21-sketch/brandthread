---
name: Fresh seller preview
description: Owner's standing requirement for an empty, new-account development preview and nonpersistent web demo mode.
---

The seller preview must look like a brand-new seller who just signed up: zero products, zero orders, zero revenue, empty messages, an empty profile grid, and zero followers. Skipping onboarding in Expo Go selects the seller role; it must never select or seed a populated demo account.

**Why:** The owner repeated: “I told you I wanted my app to be in a state on how it would be when somebody first downloads and creates an account.” Populated products, orders and dashboard money were explicitly rejected.

Demo fixtures are permitted only in a web preview whose current URL explicitly contains `demo=1`. Demo mode must never persist in device storage, browser storage or a session-wide fallback. A new load without that parameter must be fresh even after a prior demo visit.

**How to apply:** Keep role/onboarding bypass separate from data mode. Test native platforms with the seller bypass enabled and demo mode disabled; test a demo URL followed by a plain URL in the same browser. Clear the obsolete demo flag, not account data or onboarding state. Preserve explicit URL parameters through boot-time route corrections without saving demo intent.

The first-product card begins with its title, then explanatory text, then its button. Do not reintroduce an icon tile above the title.

**Why:** The owner explicitly rejected the top circled-plus tile. This does not apply to the existing plus icon inside the button.

**How to apply:** Preserve this content order when importing future Dashboard styling; do not reserve blank space for the removed tile.
