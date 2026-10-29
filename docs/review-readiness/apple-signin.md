# Sign in with Apple (App Store 4.8)

Guideline 4.8: an app that offers a third-party or social login (Google here) must also offer an equivalent privacy-preserving login, and Sign in with Apple qualifies. Builds on `artifacts/mobile/docs/apple-sign-in-readiness.md` (config contract, device test matrix).

## Audit

Social providers in the app: Google and Apple only (Clerk strategies `oauth_google`, `oauth_apple`). No Facebook, TikTok or other social login exists.

| Surface | Google | Apple | Status |
|---------|--------|-------|--------|
| Sign in - `app/sign-in.tsx` (~659-700) | yes | yes, listed first, solid black button per HIG, iOS | PASS |
| Buyer sign-up, onboarding auth step - `app/onboarding.tsx` (~993-1015) | yes | yes, first | PASS |
| Seller sign-up, onboarding auth step - `app/onboarding.tsx` (~1494-1530) | yes | yes, first | PASS |
| Login methods (link/unlink) - `app/login-methods.tsx:85-103` | yes | yes | PASS |
| App config - `app.json` `usesAppleSignIn`, `com.apple.developer.applesignin`, `expo-apple-authentication` plugin; checked at build by `scripts/verify-apple-auth.js` | - | present | PASS |

Apple is iOS-only in the app on purpose (`Platform.OS === 'ios'`); Android and web show Google and email only. 4.8 applies to the iOS binary, and the Apple flow there needs no change. Adding an Apple button on Android/web would be a visible change, so it was left out.

### Gap found and fixed (no visible change in normal use)

Apple and Google each sit behind a server-side kill-switch flag (`oauthAppleEnabled`, `oauthGoogleEnabled`, default on). If an operator turned Apple off (for example because the Clerk Apple connection is not configured yet) while Google stayed on, the iOS build would show Google as the only social login, which breaks 4.8.

Fix: `oauthProviderVisibility` in `lib/oauthFlow.ts` (unit tested in `lib/oauthFlow.test.ts`). On iOS, Google is hidden whenever Apple is hidden. Used by the three surfaces above. With both flags on (the default) nothing changes on screen. Android and web are unchanged.

### Not covered here

- `login-methods` shows both provider rows unconditionally, and both connect through Clerk. It is an account-management list, not a login offer, so it does not need the gate.
- Apple token revocation is shared across authenticated account deletion, Delete login, and public email-link deletion. See the server configuration and native-token limitation below.

## What Dev must set up (Apple Developer + Clerk)

None of this can be verified from the repository or this environment.

Apple Developer (account holder):
1. Identifiers > App ID `com.brandthread.mobile` > enable **Sign in with Apple** capability. Note the **Team ID** (10 characters).
2. Identifiers > **Services ID** (for example `com.brandthread.mobile.signin`) > enable Sign in with Apple > Configure: primary App ID `com.brandthread.mobile`, domain = the Clerk Frontend API domain (from the Clerk dashboard), return URL = the callback Clerk shows on its Apple page.
3. Keys > create a key with Sign in with Apple enabled (primary App ID `com.brandthread.mobile`). Download the `.p8` once; note the **Key ID**.
4. Certificates, Identifiers & Profiles > More > **Sign in with Apple for Email Communication**: register the sending domain/address used for Hide My Email relay mail so it reaches users.

Clerk dashboard (Production instance, not just Development):
1. User & Authentication > Social connections > **Apple** > enable, choose "Use custom credentials".
2. Enter: Services ID, Team ID, Key ID, and the `.p8` private key contents. Copy Clerk's return URL back into the Services ID config (step 2 above).
3. Native applications: add iOS app with Team ID and bundle id `com.brandthread.mobile`; confirm the `brandthread` scheme redirect is in the allow-list.
4. Keep `oauthAppleEnabled` on (default). Only turn it off if the Clerk connection is not live, and note that the fix above then hides Google on iOS too.

Then run the device matrix in `artifacts/mobile/docs/apple-sign-in-readiness.md` on a TestFlight build (first-time user, sign-out/in, Hide My Email, cancel, collision, revoked credential). Not run here: no iOS device or Apple/Clerk credentials are available.

## Server deletion revocation configuration

All deletion paths use the same configuration and ES256 client-secret implementation in `lib/appleAuth.ts`:

| Variable | Value |
| --- | --- |
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `APPLE_SIGN_IN_KEY_ID` | Key ID of a key with **Sign in with Apple** enabled |
| `APPLE_SIGN_IN_PRIVATE_KEY` | That key's `.p8` PEM text; literal `\n` escapes are accepted |
| `APPLE_BUNDLE_ID` | Apple token client ID; defaults to `com.brandthread.mobile` |

Do not use the old `APPLE_SIGNIN_*` names or assume the App Store Connect submission key grants Sign in with Apple access. The client ID must match the token being revoked: native app tokens use the bundle ID; hosted web Apple OAuth can use a Services ID. Mixed-client deployments need a separately designed client-aware configuration before claiming coverage for both.

`DELETE /api/auth/account` and the public `/account-deletion` email-link confirmation share `accountDeletionHandler`. `DELETE /api/accounts/login` applies the same post-success helper to each newly scheduled identity. Only the request winning the database's conditional deletion update initiates revocation. Repeated/pending deletion requests do not initiate another attempt; restoring during the 30-day grace period allows a later deletion to initiate a new attempt.

After successful scheduling and sending the success response, the helper uses `appleAuthorizationCode` if supplied, exchanges it and revokes the resulting refresh token (or access token). Otherwise it requests the Apple OAuth access token from Clerk and revokes it. A supplied code never also triggers the Clerk fallback, even if the code exchange fails. The existing delayed purge does not revoke again.

Apple/Clerk failures, missing configuration, and missing tokens are logged as outcomes, never surfaced as deletion failures. Network operations are bounded. This is one **best-effort attempt** per new deletion, not a guarantee of remote success or durable execution after a server crash; no tokens or provider error payloads are logged.

## Native Apple token limitation — release verification required

Clerk's `getUserOauthAccessToken(userId, "apple")` returns only OAuth access tokens Clerk actually holds. Native ID-token sign-in is not the same as the hosted authorization-code exchange; an Apple external account/identity token alone is not a revocable access or refresh token. Do not assume that an Apple-linked Clerk account has an OAuth token.

If Clerk has no token, recent-sign-in/email-code deletion, Delete login without a fresh Apple authorization code, and the public email-link flow **cannot revoke Apple's connection**. They still delete/schedule the account successfully and log `no_token`. Native deletion supplying a fresh authorization code can revoke with the configured native bundle ID.

Recommendation: securely exchange and retain an encrypted Apple refresh token at native sign-up/sign-in (with a verified user binding), so all deletion paths can revoke without prompting again. That is not implemented by this server-only consolidation. Until then, fresh native Apple reauthentication provides a code for in-app deletion but cannot fix the email-link path. Do not mark App Store revocation coverage complete without a real native-token check.

References: [Clerk native Apple setup](https://clerk.com/docs/ios/guides/configure/auth-strategies/sign-in-with-apple) and [Clerk OAuth token retrieval](https://clerk.com/docs/reference/backend/user/get-user-oauth-access-token).

Release check (never print tokens): sign up with native Apple on an iPhone, check only whether Clerk returns any Apple OAuth tokens, then delete through each supported path and verify Settings → Apple ID → Sign in with Apple. Confirm Apple consent is requested again on return and the existing Clerk identity restores the same Brandthread account within the grace period.
