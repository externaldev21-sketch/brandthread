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
- Apple token revocation when an account is deleted (Apple asks apps that offer Sign in with Apple to revoke the token on deletion): belongs to the trust/safety account-deletion work; `clerkClient.users.deleteUser` (`routes/auth.ts:477`) does not call Apple's revoke endpoint. Flagged for that owner.

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
