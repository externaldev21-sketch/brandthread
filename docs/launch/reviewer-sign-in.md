# Reviewer sign-in without a code (Clerk Device Trust)

`REVIEW_NOTES.md` tells App Review that the demo accounts sign in with email
and password and **need no email or SMS code**. On a Clerk production
instance that is only true when **Device Trust** (called **Client Trust**
until late 2025; the API still reports `needs_client_trust`) is off.

With Device Trust on, Clerk asks for an email code whenever someone signs in
with a password from a device it has not seen before and the account has no
MFA. A reviewer always uses a new device and can't read the demo mailbox, so
the result is a Guideline 2.1 "unable to sign in" rejection.

## What can and can't be done from code

- Device Trust is an **instance-wide** setting in the Clerk Dashboard. Clerk's
  Backend API has no per-user exemption, so `scripts/seedReviewAccounts.ts`
  can't mark the demo users to skip it. Nothing in the repo changes it.
- Giving the demo accounts MFA would skip Device Trust, but the reviewer would
  then need the authenticator, which is worse.
- What the repo does provide: a check that signs in to both demo accounts the
  way a reviewer does, from a fresh client, and fails if Clerk asks for a code.

## Steps (Dev, once before each submission)

1. Open [dashboard.clerk.com](https://dashboard.clerk.com), pick the
   Brandthread application and switch to the **Production** instance (top
   left).
2. Go to **Protect → Rules** (older dashboards: **Configure → Attack
   protection**). Find the **Device Trust** row (older dashboards: **Client
   Trust**, or "Verify new devices") and switch it **off**. Save.
3. In Clerk Dashboard → **Users**, open each demo account and check that
   **Multi-factor** shows no authenticator app, phone or backup codes.
4. Run the check against production (the values are in your secrets
   manager, never committed):

   ```powershell
   $env:CLERK_PUBLISHABLE_KEY = "pk_live_..."
   $env:CLERK_SECRET_KEY = "sk_live_..."   # optional: revokes the test sessions afterwards
   $env:REVIEW_DEMO_BUYER_EMAIL = "..."; $env:REVIEW_DEMO_BUYER_PASSWORD = "..."
   $env:REVIEW_DEMO_SELLER_EMAIL = "..."; $env:REVIEW_DEMO_SELLER_PASSWORD = "..."
   pnpm --filter @workspace/api-server run verify:reviewer-sign-in
   ```

   Both lines must read `signed in from a new device with no code`. A
   `needs_client_trust` or `needs_second_factor (email_code)` result means
   step 2 has not taken effect; a `totp` result means step 3.
5. Optional but recommended: sign in once on a phone that has never had the
   app (or after deleting and reinstalling it) to see the same thing a
   reviewer sees.

## Trade-off

Device Trust protects password accounts against credential stuffing. Turning
it off applies to every user. If you want it back, switch it on again after
the app is approved, and switch it off again before every later submission
(each update is reviewed again with the same demo accounts). Rate limiting,
breached-password protection and bot protection on the same **Protect** page
stay on either way.

The alternative is a demo mailbox the team monitors and a promise to App
Review to forward codes. App Review does not wait for that, so it is not
recommended.
