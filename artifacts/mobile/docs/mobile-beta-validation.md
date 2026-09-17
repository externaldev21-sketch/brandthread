# Mobile beta validation

Run the normal mobile checks, then run the onboarding transition check on a physical iPhone before each beta release.

## Onboarding transition check

1. Install and launch a development build of `com.brandthread.mobile` on the iPhone.
2. Start an Appium 2 server with the XCUITest driver and make the device available to it.
3. Set `APPIUM_SERVER_URL` and, when needed, `APPIUM_CAPABILITIES` and `NATIVE_APP_ID`.
4. From `artifacts/mobile`, run:

   ```sh
   pnpm run test:onboarding:native:ci
   ```

The check drives both buyer and seller onboarding. It verifies the selected account-type card determines the auth path, auth → name waits for the transition before focusing the input and opening the keyboard, loading reaches notifications on budget, and notifications reaches success. In-app timing markers remove Appium transport overhead from JavaScript scheduling and animation-completion measurements. Each interactive transition is also recorded and fails if visible frames freeze beyond the allowed budget. Videos are written to `test-results/onboarding-transitions`.

The development build is required because the probe deep links and auth-completion control are excluded from production behavior by `__DEV__`.

Optional threshold overrides:

- `ONBOARDING_MAX_DESTINATION_MS` (default `250`)
- `ONBOARDING_MAX_SCHEDULING_MS` (default `50`)
- `ONBOARDING_MAX_ANIMATION_MS` (default `340`)
- `ONBOARDING_MAX_SETTLE_MS` (default `520`)
- `ONBOARDING_MAX_FROZEN_FRAMES` (default `3` at the normalized 30 fps analysis rate)

Do not use the non-CI command as release evidence: it skips when Appium is unavailable. The `:ci` command fails instead.

## Seller dashboard Android interaction check

1. Install and launch a development build of `com.brandthread.mobile` on an Android emulator.
2. Start an Appium 2 server with the UiAutomator2 driver and make the emulator available to it.
3. Set `APPIUM_SERVER_URL` and, when needed, Android `APPIUM_CAPABILITIES` and `NATIVE_APP_ID`.
4. From `artifacts/mobile`, run:

   ```sh
   pnpm run test:seller-dashboard:android:ci
   ```

This independently required Android check verifies that Dashboard content moves after a swipe, Studio can be dismissed by its backdrop and the Android hardware-back button, and every create-menu destination can be opened.