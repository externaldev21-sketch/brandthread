---
name: Expo web production boundary
description: Production conventions for extending the Brandthread Expo app to browser hosting without weakening auth or faking native capabilities.
---

Brandthread web is the existing Expo Router product exported for browser hosting, not a separate website or an Expo Go landing page. Keep API and Clerk traffic same-origin in production, with Clerk using the server proxy rather than relying on a deployment-specific direct frontend API origin.

**Why:** Static browser hosting changes the auth origin and exposes every route to direct navigation. A same-origin boundary keeps deployment/custom-domain changes from breaking authenticated calls, while avoiding hardcoded temporary domains.

**How to apply:** Build browser releases with Expo's web static export and serve deep links through an HTML-only SPA fallback. In production, launch the Node static server directly (not through a package-manager wrapper) and use `/status` as the explicit startup probe. Keep preview auth bypasses explicit and development-only. Camera capture, native push, biometrics, Agora live video, and calls must show a clear mobile-only state on web; never report success or silently no-op.