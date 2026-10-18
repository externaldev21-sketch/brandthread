---
name: Fresh seller preview
description: Owner's standing requirement for an empty, new-account development preview and nonpersistent web demo mode.
---

## Buyer welcome-chat exception

The fresh buyer development preview includes the pinned official Brandthread assistant welcome thread. Ordinary seeded friends and conversations still require the current URL's explicit `demo=1`; do not add them to a fresh preview.

**Why:** The owner explicitly requested that the approved pinned Brandthread chat be visible in preview/demo mode too.

**How to apply:** Keep the official welcome thread available without loosening production authentication or populating the seller's fresh inbox. A zero-state account is not a reason to hide the app's own welcome chat.
The seller preview must look like a brand-new seller who just signed up: zero products, zero orders, zero revenue, empty messages, an empty profile grid, and zero followers. Skipping onboarding in Expo Go selects the explicitly requested preview role; it must never select or seed a populated demo account.

**Why:** The owner repeated: “I told you I wanted my app to be in a state on how it would be when somebody first downloads and creates an account.” Populated products, orders and dashboard money were explicitly rejected.

Demo fixtures are permitted only in a web preview whose current URL explicitly contains `demo=1`. Demo mode must never persist in device storage, browser storage or a session-wide fallback. A new load without that parameter must be fresh even after a prior demo visit.

**How to apply:** Keep role/onboarding bypass separate from data mode. Test native platforms with the seller bypass enabled and demo mode disabled; test a demo URL followed by a plain URL in the same browser. Clear the obsolete demo flag, not account data or onboarding state. Preserve explicit URL parameters through boot-time route corrections without saving demo intent.

The first-product card begins with its title, then explanatory text, then its button. Do not reintroduce an icon tile above the title.

**Why:** The owner explicitly rejected the top circled-plus tile. This does not apply to the existing plus icon inside the button.

**How to apply:** Preserve this content order when importing future Dashboard styling; do not reserve blank space for the removed tile.

Optional demo media must not introduce unresolved static asset dependencies into ordinary builds.

**Why:** Metro resolves static asset imports even when their runtime demo gate is false; absent sample videos blocked every screen after a profile-banner merge.

**How to apply:** Check that demo helpers imported by the route tree build with the available asset set. Runtime opt-in alone does not isolate demo dependencies.

A development host or preview-role flag does not establish that the caller is signed out. A real authenticated session must use its actual account data.

**Why:** Combining an older unconditional preview rejection with a newer signed-out policy blocked authenticated requests before their token could be checked.

**How to apply:** Authenticate before selecting local preview answers. Keep protected signed-out mutations blocked, native preview data empty, and web demo fixtures dependent on the current URL.
