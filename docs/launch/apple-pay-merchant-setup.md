# Apple Pay and Google Pay: merchant setup (Dev only)

In-app checkout pays with Stripe's own sheet: Apple Pay on iPhone, Google Pay on
Android, Stripe's card field everywhere (`artifacts/mobile/components/checkout/StripePayment.tsx`).
It only switches on when the build has a Stripe publishable key and the Stripe
native module. Without them, `stripePaymentAvailable()` returns false and every
buyer silently drops to the hosted Stripe page, with no Apple Pay sheet.

Since BT-271 a production build reports that once to Sentry (tag
`check: stripe_payment_available`, `reason: missing_publishable_key` or
`native_module_missing`) and logs `In-app payments are off in this production
build` (`artifacts/mobile/lib/stripeLaunchCheck.ts`). If you see that event,
one of the steps below is missing.

Everything here needs account access, so it can't be done from a coding
session. Use the **new LLC Stripe account** for every Stripe step (the one the
production API's `STRIPE_SECRET_KEY` belongs to). A certificate or key from any
other Stripe account will not work with the server's PaymentIntents.

What the code already has (no change needed):

- `app.json` → `@stripe/stripe-react-native` plugin with
  `merchantIdentifier: "merchant.com.brandthread.mobile"` and
  `enableGooglePay: true`.
- `stripePaymentTypes.ts` → `APPLE_MERCHANT_ID = 'merchant.com.brandthread.mobile'`.
- `eas.json` → the `production` profile reads the EAS **production**
  environment (`"environment": "production"`); it sets no env of its own.

## 1. Apple Developer: create the merchant ID

1. Sign in at developer.apple.com with the Account Holder or an Admin of the
   Brandthread team.
2. Certificates, Identifiers & Profiles → Identifiers → **+** → **Merchant IDs** → Continue.
3. Description: `Brandthread`. Identifier: `merchant.com.brandthread.mobile`
   (exactly this; the app and the Stripe certificate both use it). Register.
4. Identifiers → App IDs → `com.brandthread.mobile` → Capabilities → tick
   **Apple Pay Payment Processing** → Configure → select
   `merchant.com.brandthread.mobile` → Save. Confirm the change.
5. The next `eas build --profile production --platform ios` regenerates the
   provisioning profile with the Apple Pay entitlement. If EAS asks whether to
   update capabilities, answer yes.

## 2. Stripe Dashboard (new LLC account): Apple Pay certificate

Stripe must hold the payment processing certificate for the merchant ID, or
Apple Pay sheets fail with "payment not completed".

1. Stripe Dashboard (LLC account, **live mode**) → Settings → Payments →
   **Apple Pay** → iOS certificates → **Add new application**.
2. Download the **CSR** file Stripe gives you (`stripe.certSigningRequest`).
   Use Stripe's CSR. A CSR made on your own Mac will not work.
3. In Apple Developer → Identifiers → Merchant IDs →
   `merchant.com.brandthread.mobile` → **Apple Pay Payment Processing
   Certificate** → Create Certificate. Answer "No" to the China mainland
   question, upload Stripe's CSR, Continue, **Download** the `apple_pay.cer`.
4. Back in Stripe, upload `apple_pay.cer`. The row should show the merchant ID
   and an expiry date (about 25 months out; put a renewal reminder in the
   calendar).
5. Repeat steps 1 to 4 in **test mode** if you want Apple Pay in TestFlight
   builds that use the test publishable key.

## 3. Stripe Dashboard: web domain verification (web checkout only)

Only needed for Apple Pay inside the web app (the Payment Element and Express
Checkout Element in `StripePayment.web.tsx`). The hosted Stripe page and the
native apps don't need it.

1. Stripe Dashboard (LLC account) → Settings → Payments → **Payment method
   domains** → Add a new domain → enter the production web domain the buyer
   app is served from (and `www.` if both are used).
2. Stripe shows the file `apple-developer-merchantid-domain-association`. It
   must be reachable at
   `https://<domain>/.well-known/apple-developer-merchantid-domain-association`
   with HTTP 200 and no redirect. For the Expo web build, put the file in
   `artifacts/mobile/public/.well-known/` (files in `public/` are served from
   the site root); if the web app is served by the API instead, add it to
   `artifacts/api-server/src/routes/wellKnown.ts`.
3. Click **Verify** in Stripe. Google Pay on the web needs no file; it is
   enabled on the same domain once it is registered.

## 4. EAS: the publishable key in the production environment

1. Stripe Dashboard (LLC account, live mode) → Developers → API keys → copy the
   **Publishable key** (`pk_live_…`). Never the secret key: the secret key
   stays on the API server only (`STRIPE_SECRET_KEY`).
2. Set it for production builds:

   ```sh
   cd artifacts/mobile
   eas env:create --environment production --name EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY \
     --value pk_live_xxx --visibility plaintext
   ```

   (or expo.dev → the project → Environment variables → Add → name
   `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`, environment **production**.)
3. For `preview`/TestFlight builds against the test API, set the `pk_test_…` key
   in the **preview** environment the same way.
4. `EXPO_PUBLIC_*` values are baked in at build time: rebuild after setting it
   (`eas build --profile production`). An OTA update alone doesn't add it to an
   existing binary's native Stripe setup.
5. The web deploy needs the same variable at build time
   (`EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_xxx` when running the web
   export).

## 5. Google Pay

1. Stripe Dashboard (LLC account) → Settings → Payments → **Payment methods** →
   make sure **Google Pay** is on (it is by default for card payments). No
   Google merchant ID is needed: Stripe is the gateway.
2. The app already sets `enableGooglePay: true` and passes `testEnv` only in
   development, so release builds use live Google Pay.
3. Google Play Console → the app → **Policy → App content**: no extra Google Pay
   declaration is needed for physical goods. Google may ask you to accept the
   Google Pay API terms the first time; accept them in the Play Console prompt.

## 6. Verify on a real device

1. Install the production (or TestFlight / internal testing) build. Not Expo Go:
   it has no Stripe module, so it always uses the hosted page.
2. iPhone: Wallet must hold a card (a real card in live mode; in test mode Apple
   Pay accepts the cards Stripe's test docs list). Android: Google Wallet with a
   card.
3. Add an item to the bag → Checkout. The **Apple Pay / Google Pay** button
   should show at the top of the checkout page. Signed out (guest) it should
   show too: guests pay in the app since BT-257.
4. Tap it, pick an address in the sheet: the total should update with that
   address's shipping and tax. Pay. The confirmation screen should show the
   order number; Stripe Dashboard → Payments should show one payment with
   `metadata.kind = cart_checkout`.
5. If the button never shows: check Sentry for the `stripe_payment_available`
   event. `missing_publishable_key` means step 4 wasn't applied to this build;
   `native_module_missing` means the build is Expo Go or a build without the
   Stripe plugin. If the button shows but the sheet fails, re-check step 2 (the
   certificate must be on the LLC account, for this exact merchant ID).
