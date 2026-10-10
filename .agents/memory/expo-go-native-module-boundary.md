---
name: Expo Go native module boundary
description: Preventing installed custom native modules from crashing Brandthread when opened through Expo Go
---

**Rule:** Code reachable during Expo Go startup must not statically import a custom native module that Expo Go does not bundle. Use React Native or Expo-compatible fallbacks for root providers and route modules; reserve custom native integrations for guarded, feature-local paths or development builds.

**Why:** Metro can produce a valid manifest and complete iOS/Android bundles even when the app will fail at launch because a statically imported package requests an unavailable native module. Bundle success alone does not prove Expo Go runtime compatibility.

**How to apply:** When QR launch fails, run Expo dependency checks, fetch both native launch assets, then inspect root and route imports for third-party native packages. Confirm guards prevent incompatible native initialization and restart Metro after changing the startup graph. A lazy `require` can leave code in the bundle without evaluating it; bundle inclusion alone is not evidence of a startup failure.

If Expo Go exits to the iPhone home screen with no JavaScript exception, Replit's workflow logs cannot reveal the iOS process termination reason. A successful native bundle or even a logged first render does not identify the crashing native component.

**Why:** Replit's device preview does not expose iPhone OS crash reports to the workspace. Startup-import guesses can be wrong: some third-party modules have Expo Go fallbacks, while the actual termination happens outside Metro's JavaScript log stream.

**How to apply:** Check the native launch assets and workflow first, then seek a device crash reason through iPhone Analytics Data or Mac Console/Xcode when available. If that evidence is unavailable, use a controlled, reversible isolation test rather than labeling a package as the cause or claiming a web preview proves the phone works.

Expo Doctor's recommended JavaScript dependencies can temporarily differ from the native libraries shipped in an installed Expo Go release. Check the phone's Expo Go version before downgrading Worklets/Reanimated or removing providers.

**Why:** Expo maintainers documented SDK 57 clients with native Worklets 0.10.0/Reanimated 4.5.0 while dependency checks recommended 0.10.1/4.5.1; affected clients could terminate without a JavaScript error even when Doctor passed. The reported correction was an Expo Go binary update, not a project cache repair. See https://github.com/expo/expo/issues/48390.

**How to apply:** Verify the current Expo Go release and device crash evidence against upstream reports; do not assume matching symptoms establish the same cause. Align JavaScript packages with the installed native runtime rather than blindly pinning versions from an older workaround.

**Rule:** An Expo-branded package can still expose an entrypoint unavailable in an older Expo Go binary; distinguish bridge registration from package installation before disabling an entire feature.

**Why:** SDK 57 media-library's newer entrypoint requested `ExpoMediaLibraryNext` in a recorded JavaScript startup failure. An installed package and passing Doctor did not establish that the client's bridge exposed that API; legacy media access may still be available.

**How to apply:** Preflight the needed native registration before evaluating the entrypoint, retain supported or legacy implementations where possible, and give an explicit unavailable outcome otherwise. Do not attribute an iOS process termination to that JavaScript error without device evidence.