# Apple sign-in and iOS build readiness

## Configuration contract

The native app identity and Clerk callback contract are intentionally explicit:

| Concern | Required value | Source of truth |
| --- | --- | --- |
| iOS bundle identifier | `com.brandthread.mobile` | `app.json` |
| App URL scheme | `brandthread` | `app.json` and `lib/oauthFlow.ts` |
| Clerk Apple strategy | `oauth_apple` | `lib/oauthFlow.ts` |
| Apple entitlement | `com.apple.developer.applesignin: ["Default"]` | `app.json` |
| Expo Apple capability | `usesAppleSignIn: true` | `app.json` |
| Native config plugin | `expo-apple-authentication` | `app.json` |
| iOS build image | `macos-sequoia-15.6-xcode-26.0` | `eas.json` |

`pnpm run verify:app-identity`, `pnpm run verify:apple-auth`, and
`pnpm run verify:ios-build` run before native prebuild and EAS build install.
The build image is pinned rather than using `auto`, `latest`, or an Expo SDK
alias. Expo's build infrastructure lists this image as macOS Sequoia 15.6
with Xcode 26.0 (17A324), which supplies the iOS 26 SDK.

## Build evidence

The repository contains the production-style `development`, `preview`, and
`production` profiles, but a native macOS build cannot be executed in this
Linux workspace. Do not treat the configured image or Expo SDK version as
observed build evidence.

Before App Store submission, run the production profile through the approved
native build pipeline and attach the unedited non-secret build metadata here:

| Field | Required evidence |
| --- | --- |
| Build profile | `production` |
| Build ID / date | From the build service |
| Build image | From the “Spin up build environment” log |
| Xcode version | From `xcodebuild -version` in build output |
| iOS SDK | From `xcodebuild -showsdks` or the build output |
| Artifact | TestFlight/internal distribution build ID |

Never add Apple client secrets, Clerk tokens, authorization codes, or
personal relay addresses to this document or build logs.

## Test matrix

### Automated coverage in this repository

- Redirect generation always uses `brandthread`; Apple always uses
  `oauth_apple`.
- Auth onboarding does not advance unless Clerk reports a completed result.
- User cancellation is a safe no-op; denied, revoked, collision, network, and
  redirect failures produce retryable messages.
- Clerk profile sync selects the primary email and preserves a stored relay
  address when a later response is blank.
- Returning users restore completed Buyer/Seller routing from the persisted
  server profile when device-local onboarding state is missing.
- The auth sync is followed by the role-specific profile write before the
  dedicated final server completion marker is set.

### Required device/TestFlight evidence

| Scenario | Expected result | Status |
| --- | --- | --- |
| First-time Apple user, onboarding | Apple consent creates one Clerk user; syncs profile; Buyer/Seller selection routes correctly | Requires native build/device |
| Sign out, then Apple sign-in | Same Clerk identity returns without a duplicate user or onboarding restart | Requires native build/device |
| Hide My Email | Relay email remains usable and is never blanked on refresh | Automated guard + device confirmation |
| One-time Apple name | A usable onboarding name remains after subsequent syncs | Automated guard + device confirmation |
| Cancel / deny | Stay on the auth screen with no partial onboarding state; retry is available | Automated guard + device confirmation |
| Existing account collision | Explain that the existing account must be used; no duplicate is created | Automated guard + device confirmation |
| Redirect interruption | Show a retryable error and remain recoverable | Automated guard + device confirmation |
| Revoked Apple credential | Ask the user to start sign-in again; do not log credentials | Automated guard + device confirmation |

## Account-console prerequisites

The following must be confirmed in the managed Clerk Production instance and
Apple Developer account; they are not safely verifiable from this repository:

1. Apple is enabled as a Clerk social connection in Production.
2. Clerk's Apple service configuration uses the same Apple Services ID/team
   configuration registered for the app.
3. The production redirect allow-list includes the Clerk-managed callback for
   the native `brandthread` scheme and the published app domain callback used
   by the production auth flow.
4. Apple Developer has Sign in with Apple enabled for
   `com.brandthread.mobile`, with the correct team and key/service settings.
5. The Apple private-email relay configuration forwards to the support address
   used by Brandthread, and the app's privacy/support URLs are live.

These checks require the authorized Clerk dashboard and Apple Developer
account. No credentials or provider tokens belong in source control.