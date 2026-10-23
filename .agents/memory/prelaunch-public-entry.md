---
name: Pre-launch public entry
description: The owner's public Instagram link must collect launch emails, not admit new accounts, until launch.
---

Before launch, signed-out visitors arriving at the public root should get the
existing branded landing-page structure with launch email collection, not app
access, sign-in, or account creation links.

**Why:** The owner is sharing Brandthread in an Instagram bio before the app is
released and wants a launch-notification list rather than premature signups.

**How to apply:** Preserve separate Expo development and fast-preview app flows,
including explicit buyer/seller preview selection. Keep the liked original
headline and phone composition as the landing baseline; this is not approval
for a landing redesign. Change the public pre-launch restriction only when the
owner explicitly authorizes opening the app at launch.

Verify the actual production export separately from the fast-preview export.
The production default document must be the pre-launch cover; preserve the
Expo shell separately for app routes and authenticated entry.

**Why:** Rebuilding the fast preview alone left an older full landing in the
production output, so the public Instagram link still exposed account/pricing
entry instead of the approved waitlist.

**How to apply:** Before reporting a landing ready to publish, build the
production target and test its root with the production static server, not
only the development or fast-preview root. Keep waitlist submissions
same-origin so deployment routes them to its production API/database.
