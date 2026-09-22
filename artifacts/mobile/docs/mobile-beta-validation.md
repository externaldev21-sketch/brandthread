# Mobile beta validation

Run the normal mobile checks, then run the Expo Go startup check on physical iOS and Android devices before each beta release and after any dependency or navigation change.

## Expo Go startup check

1. Start the managed mobile workflow and copy its current Expo project URL.
2. Start an Appium 2 server with XCUITest and UiAutomator2 drivers. Connect one iOS device and one Android device with Expo Go installed.
3. Save the managed mobile workflow output to a file, then set `METRO_LOG_FILE` to that path. Also set `APPIUM_SERVER_URL` and `EXPO_GO_PROJECT_URL`. Set `APPIUM_IOS_CAPABILITIES` and `APPIUM_ANDROID_CAPABILITIES` when Appium cannot select the intended devices automatically. A single-platform run may use `APPIUM_CAPABILITIES` instead.
4. From `artifacts/mobile`, run each platform check with the matching device connected:

   ```sh
   pnpm run test:expo-go-startup:ios:ci
   pnpm run test:expo-go-startup:android:ci
   ```

   When both devices are available to the Appium server and the platform-specific capabilities are set, invoke the combined gate:

   ```sh
   pnpm run verify:release:expo-go
   ```

Each check force-stops Expo Go, launches it cleanly, opens the current project URL, and waits for the mounted Brandthread route tree. It fails on startup exceptions, missing native modules, a missing screenshot, or a visually blank initial frame. Diagnostics are always written to `test-results/expo-go-startup/<platform>`: `initial-screen.png`, `page-source.xml`, `device.log`, and `metadata.json`.

Release mode requires `METRO_LOG_FILE` and copies it into the same results directory as `metro.log`. Optional overrides are `EXPO_GO_STARTUP_TIMEOUT_MS`, `EXPO_GO_STARTUP_RESULTS_DIR`, and `EXPO_GO_APP_ID`.

Do not use `pnpm run test:expo-go-startup` as release evidence: it skips when required device settings are absent. The platform `:ci` commands fail instead.

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