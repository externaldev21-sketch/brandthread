---
name: Expo web production boundary
description: Production conventions for extending the Brandthread Expo app to browser hosting without weakening auth or faking native capabilities.
---

Brandthread web is the existing Expo Router product exported for browser hosting, not a separate website or an Expo Go landing page. Keep API and Clerk traffic same-origin in production, with Clerk using the server proxy rather than relying on a deployment-specific direct frontend API origin. The only published browser origin is `https://brandthread.app`; the generated Replit hostname must permanently redirect there while preserving path and query.

**Why:** Static browser hosting changes the auth origin and exposes every route to direct navigation. A same-origin boundary keeps deployment/custom-domain changes from breaking authenticated calls, while avoiding hardcoded temporary domains. Multiple crawlable hostnames also split search authority and can leak unstable generated URLs into links, emails, and hosted payment flows.

**How to apply:** Build browser releases with Expo's web static export and serve deep links through an HTML-only SPA fallback. Published builds, metadata, API-generated links, and hosted-flow callbacks use `https://brandthread.app`; local previews keep their active development origin. In production, launch the Node static server directly (not through a package-manager wrapper) and use `/status` as the explicit startup probe. Keep preview auth bypasses explicit and development-only. Camera capture, native push, biometrics, Agora live video, and calls must show a clear mobile-only state on web; never report success or silently no-op.

Until the browser static export is actually the published root service, the deployed host can report a successful build yet return 404 for `/` and `/u/...` while still answering API requests. **Why:** metadata alone did not prove shared profile links could open outside the app. **How to apply:** test the real public URL with an existing public username after publishing; keep the API host's signed-out `/u/:username` landing available so shared links do not depend on a mobile web bundle being deployed. Never share a fabricated preview username as a public profile.

React Native `Alert.alert` is not a visible validation surface in Expo web. Forms shared with web must show blocking validation and request failures inline as well; a native alert may supplement, but not replace, that feedback.

**Why:** A product form could reject an incomplete publish while appearing to do nothing in the browser preview, even though its native alert path worked.

**How to apply:** On any cross-platform form, render publish/save errors in the page near the action. Verify an invalid submission visibly fails in the web preview, not just through a mocked native alert.

The Expo development browser preview uses a different host from the API development proxy. Its exact runtime-provided origin must be accepted by credentialed API CORS in development only; a same-host assumption works for the other web artifacts but not Expo web.

**Why:** Authenticated browser requests were blocked at preflight with a 401 and no CORS headers even though the API itself was running. Native clients do not send browser preflights, so native health checks did not reveal the problem.

**How to apply:** Keep the allowlist exact, include the runtime Expo preview host only outside production, and verify an OPTIONS request with the Expo Origin returns CORS headers. Do not use a wildcard or bypass auth to make preflights pass.