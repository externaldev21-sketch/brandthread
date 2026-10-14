# Replit App Store first build

Use the Publishing tab's App Store wizard, not manual EAS commands.
The only app is `artifacts/mobile/app.json`; its permanent bundle identifier
is `com.brandthread.mobile`. The unused expanded starter reference was moved
outside the workspace; recover it from Git history if needed.

- Apple submit values are deliberately empty. Let the wizard obtain them.
- iOS build profiles use Expo's supported `latest` image alias.
- Web-only async routes are static; native routes remain synchronous.
- OTA is explicitly disabled until Launch has linked the real Expo project.
  To enable it for a subsequent binary, retain Launch's actual
  `extra.eas.projectId`, set the matching `https://u.expo.dev/<projectId>`
  Update URL, and set `updates.enabled: true`. Do not invent an ID.
- Crash reporting is not configured. The pre-install check warns rather than
  blocking wizard setup; configure monitoring before public release.
- The `with-native-surfaces` plugin's `enabled` option is **false**. It does
  not generate the Live Activity/widget extension, Siri shortcut, rich push
  extension, or alternate icon resources. The custom native module and
  alternate-icon module are also excluded from native autolinking. Main app
  icons, normal notifications, calling and all app UI remain unchanged.
- Before opting native surfaces in, remove those two autolinking exclusions,
  set the plugin option to true, provision the extension and App Group, and
  build a new binary. Rich push additionally requires `BT_IOS_RICH_PUSH=1`;
  it is not enabled by the runtime feature flag alone.

The repository contains large visual-reference/export assets. A Launch upload
of the entire repository may exceed its upload limit. Do not delete unrelated
artifacts or required assets to work around that; inspect the actual wizard
upload scope before preparing a smaller source payload.

A passing local config check is not a successful signed archive or submission.
If the mobile status card errors before any Launch session exists, collect the
Publishing-side error through Replit support; there is no native build log yet.
