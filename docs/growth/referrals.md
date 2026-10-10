# Referrals: buyer invites, install hand-off, brand → brand

## Buyer "Give $10, get $10" (unchanged program, new entry point)
- Buyer menu → Shopping → **Invite friends** (`Give $10, get $10`) opens `/buyer-invite` (BT-306).

## Invite code survives the App Store (BT-312)
1. A friend opens `https://brandthread.app/invite/CODE` on a phone without the app.
2. With the store listing set, the web page shows **You've been invited to Brandthread** (Craft's invite page pattern): the code, **Download for iOS / Android**, **Continue in browser**.
3. **Download** copies `https://brandthread.app/invite/CODE` and opens the store. The page says the invite is copied.
4. First launch of the app, signed out: if the OS reports a URL/text on the clipboard (no prompt to check), the app reads it once (iOS shows *Allow Paste*: that is the consent), and if it is a Brandthread invite link it opens `/invite/CODE`, which carries the code into onboarding. One check per install; existing members never see it.

| Env var (mobile build) | Value | Where |
|---|---|---|
| `EXPO_PUBLIC_APP_STORE_URL` | `https://apps.apple.com/app/id<APP_ID>` | App Store Connect → the app → App Information → Apple ID |
| `EXPO_PUBLIC_PLAY_STORE_URL` | `https://play.google.com/store/apps/details?id=com.brandthread.mobile` | Play Console |
| `EXPO_PUBLIC_DEFERRED_INVITE` | `0` to switch the first-launch check off | — |

Without the store URLs the web invite page keeps today's behaviour (straight into web sign-up with the code).
Upgrade path: Android's Play Install Referrer (`expo-application` → `getInstallReferrerAsync`) would remove the clipboard step on Android; it needs a new native dependency, so it was left for Dev to decide.

## Brand → brand referral (BT-313)
A brand shares its invite link (Marketing → Growth → **Refer a brand**). When a brand signs up through it (or enters the code on that screen in its first 30 days), both brands get a free month on their plan **after the new brand's first paid month** (the free trial never counts).

| Env var (API) | Default | Meaning |
|---|---|---|
| `SELLER_REFERRAL_ENABLED` | off | `true` turns the program on (row, screen, job) |
| `SELLER_REFERRAL_FREE_MONTHS` | 1 | months per brand (1–3) |
| `SELLER_REFERRAL_MAX_REWARDS_PER_SELLER` | 12 | lifetime cap for the referring brand |
| `SELLER_REFERRAL_MAX_CREDIT_CENTS` | 50000 | ceiling on one credit |
| `SELLER_REFERRAL_APPLY_WINDOW_DAYS` | 30 | how long a new brand can still add a code |

How the free month is given:
- **Stripe-billed brands** (web): a Stripe customer balance credit of one month of their plan (yearly plans ÷ 12). Stripe takes it off the next invoice. Idempotency key `seller-referral:<id>:<role>`.
- **App Store / Google Play brands**: Apple and Google don't let a server credit a subscription. The row is saved with `method = app_store_manual` and the API logs a warning; send that brand an offer code (App Store Connect → Subscriptions → Offer Codes; Play Console → Promo codes). Query: `SELECT * FROM seller_referrals WHERE inviter_reward->>'method' = 'app_store_manual' OR invitee_reward->>'method' = 'app_store_manual';`

The hourly job (`jobs/sellerReferrals.ts`) records brand → brand sign-ups from the invite link and pays rewards. Table: `seller_referrals` (migration 460).
