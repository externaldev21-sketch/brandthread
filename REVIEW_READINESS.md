# App Store / Google Play review readiness

Builds on `docs/launch/app-store-readiness.md` (earlier audit). This file is the pass/fail
summary for the gaps closed by the seven PRs below. Per-topic detail lives in
`docs/review-readiness/*.md` inside each PR. **Nothing here has been merged** — status
"FIXED" means "fixed in an open PR".

Legend: PASS (already compliant) · FIXED (open PR) · RISK (decision needed) · OWNER (Dev must act) · OPEN (not done).

## PRs

| PR | Scope |
|---|---|
| [#597](https://github.com/externaldev21-sketch/brandthread/pull/597) | IAP rails, Sign in with Apple |
| [#605](https://github.com/externaldev21-sketch/brandthread/pull/605) | UGC (1.2), IP / counterfeits (5.2) |
| [#601](https://github.com/externaldev21-sketch/brandthread/pull/601) | Generative AI moderation + labels |
| [#619](https://github.com/externaldev21-sketch/brandthread/pull/619) | Promo-push opt-in (4.5.4), guest browsing (5.1.1) |
| [#600](https://github.com/externaldev21-sketch/brandthread/pull/600) | iOS permissions/privacy manifest, Play Data safety, public deletion page |
| [#603](https://github.com/externaldev21-sketch/brandthread/pull/603) | Production hygiene, dead-UI crawler, text-fit script |
| [#644](https://github.com/externaldev21-sketch/brandthread/pull/644) | Reviewer demo accounts, REVIEW_NOTES.md, iPad/crash crawl |

## Pass / fail per guideline

| # | Guideline | Status | Notes |
|---|---|---|---|
| 1 | 3.1.1 IAP | **FIXED (flagged OFF)** | Seller plans already RevenueCat. Boost and Create-ad were Stripe on native; #597 routes native to RevenueCat consumables behind `EXPO_PUBLIC_IAP_PROMOTIONS` / `IAP_PROMOTIONS_ENABLED`. Thread Cash cannot be bought with money (PASS). Physical goods stay on Stripe. Freelancer jobs = **RISK** (service marketplace on Stripe; mention in review notes). Open: refund revocation for consumables; server does not reject Stripe digital checkout from native clients. Full table: `docs/review-readiness/iap-rails.md` (#597). |
| 2 | 4.8 Sign in with Apple | **PASS** + small fix | Apple already offered above Google everywhere. #597 hides Google on iOS if the Apple flag is ever off. Apple token revocation on account deletion is not implemented (`routes/auth.ts:477`, trust/safety session). |
| 3 | 1.2 UGC | **PASS / FIXED** | Existing signup consent + "zero tolerance" wording kept untouched. #605: 24h SLA due-by/overdue in admin queue, block filtering extended to product/video/trending/discover endpoints, client cache purge on block. |
| 4 | Generative AI | **FIXED, gaps** | #601: shared server guard (prompt filter incl. celebrity/brand/logo, output image moderation, `ai_generated` flag, "AI" tag). Gaps: no `ai_generated` column on posts (create flow owned elsewhere); bg-removal stores its result before the guard (`routes/bg-removal.ts:171`); no tag on mockup-to-model results; blocked results show each tool's generic failure message. |
| 5 | 5.2 IP / counterfeits | **FIXED** | #605: counterfeit reason already in the shared report sheet; public `/legal/ip-notice` (+`/dmca`) creates an IP case; admin takedown/counter-notice; repeat-infringer strikes (default 3). No in-app seller counter-notice screen (API + email only). |
| 6 | 4.5.4 Promo push | **FIXED** | #619: `promo_push_opt_in` default false, enforced in the single sender, one toggle in Settings → Notifications. Transactional never blocked (tested). Missing column degrades to "not opted in". |
| 7 | Privacy / permissions | **PASS** + config fixes | #600: purpose strings specific; no launch-time prompts; no ATT needed (pixels web-only, no in-app cross-app tracker); `ITSAppUsesNonExemptEncryption=false`; manifest verifier extended. Fixed duplicate Face ID plugin entry, `instagram-stories` query scheme, more Android blocked permissions. Agora / Sentry / RevenueCat / Stripe pod manifests only resolve at `pod install` — **OWNER** to run Xcode Privacy Report. |
| 8 | 5.1.1 Guest browsing | **FIXED, needs Dev decision** | #619: guests browse feed/discover/search/posts/drops/products/public profiles; gated actions reuse the existing sign-in screen; protected/paid calls blocked locally when signed out. A cold-launch signed-out user only reaches Home via the two new "Browse as a guest" buttons (welcome, sign-in) — **Dev decides** keep them or have the auth gate send cold launches to Discover instead. |
| 9 | Production hygiene | **FIXED** | #603: central `lib/buildFlags.ts`, `transform-remove-console` on production native only, CI guard, dead-UI crawler (all route targets resolve). Open findings below. |
| 10 | Reviewer access | **FIXED (not run)** | #644: idempotent seed script (`--dry-run`, `--confirm-production`), internal flag so purge tooling skips review accounts, `REVIEW_NOTES.md`. Never run against real Clerk/DB. Stripe checkout for reviewers: no bypass added (see doc). |
| 11 | Google Play | **FIXED** | #600: Data safety answers; public `/account-deletion` (email → emailed single-use link → type DELETE, reuses existing deletion handler); target API 36 (RN default). |
| 12 | Crash-proofing / iPad | **PARTIAL** | #644: ~70 routes × 5 viewport sizes (393, 430, 820×1180, 1024×1366, 1180×820) on the web preview: 0 page errors, 0 console errors, 0 error boundaries. This is **not** an iOS Simulator/iPad run (not possible on this Linux sandbox; web preview renders a phone-width column). **RISK:** module-scope `Dimensions.get` in 35 files goes stale on iPad rotation/resize (no crash). |

## What Dev must do himself

**Apple / Google accounts and consoles**
1. Apple Developer: org enrollment (needs D-U-N-S), enable Sign in with Apple on the App ID, create Services ID + key, enter in Clerk production dashboard (steps: `docs/review-readiness/apple-signin.md`).
2. Create 14 consumable products in App Store Connect, Play and RevenueCat: `brandthread_boost_{5,10,25,50,100,250,500}` and `brandthread_ad_{5,10,25,50,100,250,500}` (Apple max consumable is $999.99, so native tops out at $500). Then set `EXPO_PUBLIC_IAP_PROMOTIONS=1` and `IAP_PROMOTIONS_ENABLED=true`.
3. Answer the age-rating questionnaire (UGC, AI-generated content, user-to-user messaging, commerce).
4. Enter Data safety answers and `https://brandthread.app/account-deletion` in Play Console; decide `READ_MEDIA_IMAGES/VIDEO` declaration; confirm current target-API deadline.
5. Register a DMCA designated agent with the US Copyright Office.
6. Support + privacy URLs must be live on a real domain; HEAD-check the 31 external URLs the crawler lists (esp. `https://brandthread.app/help`). `/changelog` has no page.

**Production env / DB**
7. Apply migrations: 211 (deletion requests), 230 (IAP purchases), 231 (IP repeat-infringer), 240 (AI media registry) **and 240 (review accounts)** (two files share the `240` prefix — confirm your runner applies both), 260 (promo opt-in). None were run against a database in this environment.
8. Set `RESEND_API_KEY`, `MAIL_FROM` / `RESEND_FROM_EMAIL` (deletion + seller emails fail without them), `REVENUECAT_PROJECT_ID`, `REVENUECAT_WEBHOOK_AUTHORIZATION`, `AI_INTEGRATIONS_OPENAI_API_KEY` (or `OPENAI_API_KEY`), `AI_OUTPUT_MODERATION_STRICT=1`, optional `IP_REPEAT_INFRINGER_STRIKES`.
9. Confirm the four test env vars are unset in the production EAS env.
10. Stand up a `legal@brandthread.app` mailbox; have counsel review the IP notice wording.

**Reviewer access**
11. Set the 4 `REVIEW_DEMO_*` secrets, run the seed `--dry-run` then `--confirm-production`, sign in once as each demo user on a device (seller plan / Stripe Connect state are not faked), run `--render-notes` and paste into App Store Connect / Play. Decide how reviewers test checkout (options in `docs/review-readiness/reviewer-access.md`).

**Device verification (impossible in this sandbox)**
12. iPad/Simulator pass: rotation, Split View, camera + live in landscape, purchase sheet, Sign in with Apple, share popovers. Decide on the portrait-only iPad fallback if the `Dimensions.get` risk is unacceptable (needs a new build).
13. Sandbox-purchase one boost and one ad to confirm the RevenueCat verify shape.
14. After the first iOS archive: Xcode Privacy Report + manifest verifier.

## Decisions waiting on Dev
- **"Browse as a guest" buttons** (#619): keep, or reroute cold launch (bigger first-run change).
- **#603 touches existing UI** (kept, listed in the PR): Help Center → `/help`, Hire a Partner → `/freelancer-jobs`, "Live Chat" now scrolls to the support form (label unchanged), manufacturer call buttons hidden when calling unavailable, voice transcription stub hidden outside dev/preview.
- Freelancer marketplace stays on Stripe (RISK, note in review notes).

## Not verified anywhere
- No real/sandbox store purchase, no Sign in with Apple on a device, no live OpenAI moderation, no seed run against Clerk/DB, no migration run, no DB-backed API tests for #597/#600/#619/#644 (no database in the sandbox; #605's tests did run on local Postgres).
- **Screenshots:** #597 has none (screens need Clerk/DB keys; flag-on state exists only on native builds). #601 used a replica harness, not live screens. #603 has "after" shots only and none of the manufacturer chat header. #605's admin SLA card and portal "Seller standing" block are typecheck-only.
- Full mobile test suite: 32 files fail on clean `dev` (same set on #603); other PRs reported ~30 failing files without a baseline.

## Open findings on existing screens (not changed — other sessions' areas)
- `/help`: "Feature" text box extends past 393px.
- `/inbox`: Notes bubble truncated ("Your thou…"); empty-state "Send a message" button has 0px horizontal padding (an attempted fix removed the button's rounded corners and was dropped).
- `/manufacturer-messages` error state: "Try again" has 1px padding.
- Buyer inbox filter pill is still a "coming soon" snackbar (an existing test pins it).
- "Additional tools are coming soon" (`app/buyer-story-create.tsx`) and "Sound library coming soon." (`app/create-post.tsx`) — owned by the create-flow session.
- Instagram Stories appId in `lib/shareCard.ts` is `com.brandthread.app`, which does not match the bundle id.
