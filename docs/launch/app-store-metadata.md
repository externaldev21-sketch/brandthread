# App Store / Google Play metadata

Paste-ready listing copy, privacy answers and reviewer notes for the first submission.
Companion to [`app-store-readiness.md`](./app-store-readiness.md) (the compliance audit) and
[`../app-store/privacy-labels.md`](../app-store/privacy-labels.md) (the source of truth for
the privacy answers below — do not let these two documents disagree).

## App name, subtitle, keywords

| Field | Value | Notes |
|---|---|---|
| App name (30 char max) | **Brandthread** | Matches `app.json` `expo.name`. |
| Subtitle (30 char max, iOS only) | **Shop, sell & design streetwear** | Names all three sides of the app (buyer, seller, design studio) inside the limit. |
| Promotional text (170 char max, iOS, editable without review) | "Brandthread is where independent labels drop new pieces, sellers run their whole shop, and buyers discover streetwear brands they'll actually wear." | Update per season/drop without a new build. |
| Keywords (100 char max, comma-separated, iOS) | `streetwear,fashion marketplace,sell clothes,design studio,independent brand,drops,shop small` | No spaces after commas; every word counts toward the 100-char limit. |
| Short description (80 char max, Google Play) | "Shop independent streetwear, sell your own label, and design in one app." | |

## Description (long form, both stores)

> **Brandthread is the home for independent streetwear — as a shopper and as a seller.**
>
> **Shop.** Scroll a video-first feed of drops from independent labels, shop the post
> straight from a video or photo, follow the sellers you like, and check out securely.
> Save pieces, track orders, and message sellers directly.
>
> **Sell.** Set up your own storefront in minutes: list products, run inventory, go live,
> message customers, track orders and payouts, and grow with built-in analytics and
> marketing tools.
>
> **Design.** Brandthread's built-in Design Studio gives sellers AI-assisted mockups,
> background removal, and a canvas editor to turn an idea into a sellable product —
> without leaving the app.
>
> Every account can switch between shopping and selling. Choose a look from twelve
> built-in app themes. Your data is never sold, and account deletion is always one tap
> away in Settings.
>
> Brandthread is free to browse and buy. Selling plans and premium seller tools are
> available as auto-renewing subscriptions, managed through your Apple/Google account.

## "What's new" template

Use this shape for every release; keep entries short and specific, never "bug fixes and
performance improvements" alone.

```
• [New feature or screen, one line, plain language]
• [Notable fix a real user would notice]
• [Notable fix a real user would notice]
Small bug fixes and performance improvements throughout.
```

Example for the 1.0.0 launch:

```
Welcome to Brandthread! Shop independent streetwear, run your own storefront, and
design new pieces with AI-assisted tools — all in one app.
```

## Category and age rating

| Field | Value | Justification |
|---|---|---|
| Primary category | **Shopping** | The core loop is buy/sell, not social-first (Social Networking would undersell the commerce features and overclaim the social ones). |
| Secondary category | **Lifestyle** | Streetwear/fashion, design tools, live video. |
| Apple age rating | **17+** | The questionnaire must reflect: user-generated content (unmoderated by default, only report/block — triggers "Unrestricted Web Access"-style UGC bump), direct messaging between users, and live video/voice calls (`app/call-screen.tsx`, `app/buyer-live.tsx`, `app/seller-live.tsx`). None of infrequent/mild mature content, gambling, or alcohol/drug references apply; select "Frequent/Intense" only if that's genuinely true for the UGC exposure level the team is comfortable certifying — otherwise "Infrequent/Mild" for User-Generated Content plus "Yes" for the messaging/live-video toggles typically lands at 17+ under Apple's current matrix. **This selection should be confirmed by whoever owns App Store Connect at submission time**, since Apple's exact scoring can shift the number by one tier. |
| Google Play content rating (IARC) | Complete the IARC questionnaire with the same facts: user-to-user communication (yes — DMs, live video/voice calls), user-generated content (yes), no violence/sexual content/gambling. Expect **Teen** or higher given open messaging + UGC + live video. | |
| Made for Kids / Designed for Families | **No** | Marketplace + open messaging + live video are incompatible with a kids category. |

## Privacy "nutrition label" answers

These are **derived from the code**, not guessed — see the file:line evidence in
[`app-store-readiness.md`](./app-store-readiness.md) and the full one-to-one mapping in
[`../app-store/privacy-labels.md`](../app-store/privacy-labels.md), which is enforced by
`scripts/legal-privacy.test.ts` and `scripts/verify-ios-privacy-manifest.js` so it can't
silently drift from the actual privacy manifest. **Use that file's table verbatim when
filling in App Store Connect → App Privacy and Play Console → Data safety.** Summary of
what's actually collected, by source:

- **Identity/contact:** name, email, phone (optional), physical address — from Clerk auth, onboarding, and checkout/shipping (`app/onboarding.tsx`, `app/buyer-checkout.tsx`, `app/buyer-addresses.tsx`).
- **Financial:** saved card brand/last-4/expiry (never full PAN — that goes straight to Stripe), payout/bank last-4, tax settings (`app/buyer-payment-methods.tsx`, `app/payouts.tsx`, `app/finance.tsx`).
- **Purchases:** order history, subscription status via RevenueCat (`app/(buyer)/orders.tsx`, `lib/revenueCat.native.tsx`).
- **User content:** photos/video (posts, stories, products, designs, live streams), audio (voice messages, live/call audio), DMs and community chat, profile bio/reviews/listings.
- **Identifiers:** Clerk user ID, RevenueCat app user ID, Expo push token.
- **Usage/analytics:** notification interaction events, story views, storefront visit analytics, shopping preferences for recommendations — **not** used for third-party ad tracking (no ad SDK ships in the native app).
- **Diagnostics:** Sentry crash reports and performance samples — **not linked** to the user (no user ID, email, name or IP sent; verified `sendDefaultPii: false` in `lib/monitoring.ts`).
- **Explicitly not collected:** precise/coarse location (no location permission is ever requested), Health/Fitness, Contacts, Browsing History, Sensitive Info (biometric checks stay on-device via Face ID; Stripe Identity verification happens on Stripe's hosted page, Brandthread only receives a pass/fail).
- **Tracking:** **No** across the board. No IDFA, no ATT prompt, no cross-app tracking. Meta/TikTok pixels exist only in the web build, gated to `Platform.OS === 'web'`.

## Review notes for Apple/Google reviewers

Paste into App Store Connect → App Review Information → Notes (and adapt for Play's
reviewer notes field):

> Brandthread is a two-sided marketplace: buyers shop and message sellers; sellers run a
> storefront, fulfill orders and can go live. Any account can switch between the buyer
> and seller views from Settings → Account type.
>
> **Payments — three different flows, please note which is which:**
> 1. **Physical goods checkout** (buyer cart/checkout, and manufacturer sample orders) —
>    Stripe Checkout, opened via an in-app browser session. This is a marketplace of
>    physical, shippable goods, consistent with guideline 3.1.3.
> 2. **Seller subscription plans** (Settings → Plan & subscription, and the in-app
>    paywall) — Apple/Google in-app purchase via RevenueCat. This is the only path to
>    unlock premium seller tools.
> 3. **Post boost / ad promotion** (seller Studio → Boost, and Create ad) — currently
>    Stripe Checkout. **We're aware this is a digital, in-app-consumed feature and are
>    migrating it to in-app purchase before wide release; please flag if this blocks
>    approval of this build** rather than rejecting outright, so we can coordinate the
>    fix. (Internal tracking: `docs/launch/app-store-readiness.md` row 10.)
>
> **Demo accounts:** see the "Demo accounts for reviewers" section below — a buyer and a
> seller account are provided with instructions for reaching checkout, messaging, live
> video, the Design Studio and the seller paywall.
>
> **Account deletion:** Settings → Danger zone → Delete account → type DELETE to confirm.
> This permanently deletes the account; some order records are anonymized rather than
> deleted where required for payment/tax/dispute records, consistent with our Privacy
> Policy.
>
> **Live video / calls:** reachable from a seller's storefront ("Go live") or a buyer
> joining a live stream; 1:1 calls are reachable from an active order or conversation
> thread.

## Demo buyer + seller accounts

No demo accounts exist yet — **this is an action item before submission**, tracked in
[`dev-only-tasks.md`](./dev-only-tasks.md). Steps for whoever owns App Store Connect / the
production database:

1. Sign up two real accounts against production (not the local screenshot demo data,
   which is fake and only exists inside `scripts/store-screenshots/demo-data.mjs` for
   screenshots — it is not a real login):
   - **Demo buyer** — e.g. `reviewer-buyer@brandthread.app`. Complete onboarding as a
     buyer, follow 1-2 sellers, add an item to cart and place at least one order (use a
     Stripe test card if the environment allows it, otherwise a small real charge) so
     Orders isn't empty for the reviewer.
   - **Demo seller** — e.g. `reviewer-seller@brandthread.app`. Complete seller
     onboarding, list at least 2-3 products with real photos, connect Stripe Connect
     (or leave it clearly in "pending" state and say so in review notes), and subscribe
     to a paid plan via the real IAP flow so the reviewer can see the subscribed state,
     not just the paywall.
2. Turn on 2FA-free sign-in for these two accounts specifically (or provide the OTP/2FA
   code path in the notes) so App Review isn't blocked waiting on an SMS/email code.
3. Enter both sets of credentials in App Store Connect → App Review Information →
   Sign-in required → username/password, and Play Console's equivalent instructions
   field.
4. What to tell the reviewer to test with each account:
   - **Buyer:** browse the feed → open a product from a post ("shop the post") → add to
     cart → checkout → view the order in Orders → message the seller from the order.
   - **Seller:** Studio → Products (see existing listing) → Orders (see the buyer's
     order) → Settings → Plan & subscription (see the active paid plan) → Studio → Go
     live (camera permission prompt is expected here).
5. Re-verify both accounts still work right before hitting Submit — Clerk sessions and
   Stripe test-mode data can expire between prep and the actual review window.
