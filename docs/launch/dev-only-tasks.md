# Tasks only a human with account access can do

Nothing here can be done from a coding session — no repo access, API key or script
substitutes for these. Owner: whoever holds the Apple Developer, Google Play Console and
App Store Connect accounts (see `docs/app-store/release-flow.md` for the account list and
one-time setup this overlaps with).

## Apple Developer / App Store Connect

- [ ] **Enroll in the Apple Developer Program** (US$99/yr) if not already done, and
      accept the current Program License Agreement.
- [ ] **Agreements, Tax, and Banking** in App Store Connect — paid apps/subscriptions
      (RevenueCat/StoreKit plans) cannot go live until this is complete, even for a free
      app with in-app purchases.
- [ ] **D-U-N-S number** — only needed if enrolling as an Organization account and one
      isn't already on file; can take 1-2 weeks to issue if starting from scratch.
- [ ] **Create the app record** in App Store Connect → My Apps → + → New App. Bundle ID
      `com.brandthread.mobile` (must be registered first — the first `eas build` run does
      this automatically per `release-flow.md`).
- [ ] **Fill in `eas.json` → `submit.production.ios`** with `appleId`, `ascAppId`,
      `appleTeamId` (values only obtainable from the App Store Connect/developer.apple.com
      UI — see `release-flow.md`'s table for exactly where each one lives).
- [ ] **APNs key / push notification certificate** — EAS can generate this during the
      first build, but it requires signing in with the real Apple Developer account
      interactively once.
- [ ] **Create the two demo reviewer accounts** (buyer + seller) against production and
      enter their credentials into App Store Connect → App Review Information. Full steps
      are in `docs/launch/app-store-metadata.md` → "Demo buyer + seller accounts" — the
      account creation itself needs a real signup against the live API, which only a
      person can drive end-to-end (verifying emails, adding a real/test card, etc).
- [ ] **Age rating questionnaire** — someone must actually answer Apple's UGC/messaging/
      live-video questions in App Store Connect; `app-store-metadata.md` has a
      recommended answer set and justification, but Apple requires a human to submit it.
- [ ] **App Privacy questionnaire** — copy the answers from
      `docs/app-store/privacy-labels.md` into App Store Connect → App Privacy by hand;
      there's no API for this.
- [ ] **Screenshots and app preview upload** — generate via `docs/launch/screenshots-plan.md`
      and `pnpm run screenshots`, then upload the files to App Store Connect (drag-and-drop
      per device size).
- [ ] **Privacy Policy URL + Support URL** in App Store Connect → App Information — confirm
      `https://brandthread.app/privacy` actually resolves in production before pasting it in.
- [ ] **TestFlight internal + external testing** — add internal testers (team, up to 100,
      no review needed) and, if wanted, external testers (up to 10,000, needs a short Beta
      App Review). This is a human clicking "Add Tester" in App Store Connect.
- [ ] **Resolve the Boost/Create-ad payment risk** (see `app-store-readiness.md` row 10)
      — this is a product/business decision (migrate to IAP vs. get Apple pre-review
      guidance), not something a coding session can decide unilaterally.
- [ ] **Submit for review**: TestFlight build → Add for Review → Submit. Review usually
      takes 1-3 days; a human needs to be reachable if Apple has questions or requests a
      call.
- [ ] **In-app purchase products** — create the actual subscription products (Starter,
      Growth, etc. — whatever plans `plans.tsx`/`subscription.tsx` expect) in App Store
      Connect → Monetization → Subscriptions, matching the product IDs RevenueCat is
      configured with. This can't be scripted from this repo.

## Google Play Console

- [ ] **Create the Google Play Console account** (US$25 one-time) if not already done.
- [ ] **Create the app**, package name `com.brandthread.mobile`.
- [ ] **Upload the very first `.aab` by hand** (Play Console → Testing → Internal
      testing → Create release) — Google does not allow the first upload through the API,
      only subsequent ones via `eas submit`.
- [ ] **Create a Google Cloud service account** with Play Console access and upload its
      JSON key to EAS (`eas credentials -p android`) — see `release-flow.md` for the exact
      steps; the key itself must never be committed to the repo.
- [ ] **Store listing, content rating (IARC) questionnaire, Data safety form** — same
      underlying facts as the Apple answers (`privacy-labels.md`,
      `app-store-metadata.md`), but Play's own forms need to be filled in separately by a
      human in the Play Console UI.
- [ ] **Closed testing requirement for new personal accounts**: Google requires 12+
      testers for 14 consecutive days in a closed test before granting production access.
      Start this as early as possible — it's a hard calendar dependency for an Oct 31
      launch, and only a human can recruit and manage the 12 testers.
- [ ] **In-app product / subscription setup in Play Console** — mirror of the App Store
      Connect step above, for the Android side of RevenueCat.
- [ ] **Promote the internal build to Closed testing → Production** once testing passes.

## Cross-cutting / either store

- [ ] **RevenueCat dashboard setup** — connect both the App Store Connect and Play
      Console subscription products to RevenueCat, and copy the public API keys into EAS
      environment variables (`EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`,
      `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`) — see `release-flow.md`.
- [ ] **Stripe Connect / Stripe account review** for real payouts to go live — separate
      from the App Store/Play accounts entirely, but blocking for sellers to receive real
      money.
- [ ] **Sentry account + DSN** (optional but recommended before launch) — crash reporting
      stays off until a human creates the Sentry project and sets
      `EXPO_PUBLIC_SENTRY_DSN`/`SENTRY_AUTH_TOKEN` per `release-flow.md`.
- [ ] **Legal sign-off** — Terms of Service and Privacy Policy content already ship
      without placeholder text (verified in `app-store-readiness.md`), but a lawyer should
      still confirm the final entity name, governing law and retention schedule are
      accurate for the actual launch jurisdiction before Oct 31.
- [ ] **Domain / production API availability** — confirm `EXPO_PUBLIC_API_BASE_URL`,
      `EXPO_PUBLIC_DOMAIN` and `https://brandthread.app` (marketing site + privacy/terms
      URLs) are live and stable before store review starts; a reviewer hitting a dead
      backend is an instant rejection risk.
