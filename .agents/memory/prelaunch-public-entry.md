---
name: Pre-launch public entry
description: The owner's public Instagram link must collect launch emails, not admit new accounts, until launch.
---

Before launch, every production visitor—including signed-in sessions—must
only reach the branded launch cover, email capture, Privacy and Terms.
Production app routes, direct HTML/app-bundle URLs, storefronts, portal and
tour must not bypass the cover. Keep APIs and required infrastructure working.

**Why:** The owner is sharing Brandthread in an Instagram bio before the app is
released and wants a launch-notification list rather than premature signups.

**How to apply:** Preserve separate Expo development and fast-preview app flows,
including explicit buyer/seller preview selection. Keep the liked original
headline and phone composition as the landing baseline; this is not approval
for a landing redesign. Change the public pre-launch restriction only when the
owner explicitly authorizes opening the app at launch. PUBLIC_APP_ENABLED is
the shared launch switch: false (also the default) seals production; true
opens it. Workspace dev/fast preview must remain usable with the switch off.

Verify the actual production export separately from the fast-preview export.
The production default document must be the pre-launch cover; preserve the
Expo shell in the build, but never serve it publicly while the seal is closed.

**Why:** Rebuilding the fast preview alone left an older full landing in the
production output, so the public Instagram link still exposed account/pricing
entry instead of the approved waitlist.

**How to apply:** Before reporting a landing ready to publish, build the
production target and test its root with the production static server, not
only the development or fast-preview root. Keep waitlist submissions
same-origin so deployment routes them to its production API/database.

Do not use REPLIT_ENVIRONMENT alone to decide whether a request is deployed.

**Why:** It was observed as "production" inside this development workspace,
which incorrectly sealed local server tests and would block owner previews.

**How to apply:** Production HTML services explicitly set NODE_ENV=production;
the gate also recognizes the published hosts and the deployment marker.
Keep a regression check for workspace hosts with the misleading environment
value. Legal documents must be standalone HTML while sealed, not an app-shell
exception that can navigate client-side back into the app.
