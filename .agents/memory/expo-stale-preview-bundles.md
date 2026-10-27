---
name: Expo stale preview bundles
description: How to respond when an open Expo client continues showing UI that no longer exists in source.
---

When the current source and focused tests prove that retired labels or icons are gone but an open phone still displays them, treat the client bundle as stale before rewriting the same UI again.

**Why:** An open Brandthread Expo session continued showing an old header, Add to bag copy, missing description, and lightning Buy now icon after all had been replaced in the exact buyer route.

**How to apply:** Confirm the buyer route imports the edited component, clear Metro-generated caches, restart the managed Expo workflow once, wait for a full bundle, then reload the already-open Expo client. Do not claim visual confirmation from the web splash screen.

Static exports that switch public environment flags also need a clean transform cache, even when the source files have not changed.

**Why:** A workspace static export retained the deployment-only Clerk proxy URL after the build environment disabled it. The development API intentionally does not proxy Clerk, so the stale URL caused repeated script 404s and a blocked startup.

**How to apply:** Clear transforms when switching preview/published export modes; check the actual emitted configuration and browser requests, not only the build command's environment. Do not enable the production Clerk proxy in development as a workaround.

Check static preview availability with a browser navigation or `Accept: text/html`, not a default curl request.

**Why:** The static server deliberately returns a real 404 to non-HTML requests rather than substituting the SPA shell. A plain curl 404 can therefore coexist with a working browser preview. Missing ignored export output is a separate failure and needs a preview-mode rebuild, never substitution of production output.

**How to apply:** Verify the expected export exists, then request the preview with an HTML Accept header and inspect the actual public-origin browser. Localhost screenshot origins can also produce misleading cross-origin API failures.