---
name: Expo stale preview bundles
description: How to respond when an open Expo client continues showing UI that no longer exists in source.
---

When the current source and focused tests prove that retired labels or icons are gone but an open phone still displays them, treat the client bundle as stale before rewriting the same UI again.

**Why:** An open Brandthread Expo session continued showing an old header, Add to bag copy, missing description, and lightning Buy now icon after all had been replaced in the exact buyer route.

**How to apply:** Confirm the buyer route imports the edited component, clear Metro-generated caches, restart the managed Expo workflow once, wait for a full bundle, then reload the already-open Expo client. Do not claim visual confirmation from the web splash screen.