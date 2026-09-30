---
name: Expo Go native module boundary
description: Preventing installed custom native modules from crashing Brandthread when opened through Expo Go
---

**Rule:** Code reachable during Expo Go startup must not statically import a custom native module that Expo Go does not bundle. Use React Native or Expo-compatible fallbacks for root providers and route modules; reserve custom native integrations for guarded, feature-local paths or development builds.

**Why:** Metro can produce a valid manifest and complete iOS/Android bundles even when the app will fail at launch because a statically imported package requests an unavailable native module. Bundle success alone does not prove Expo Go runtime compatibility.

**How to apply:** When QR launch fails, run Expo dependency checks, fetch both native launch assets, then inspect root and route imports for third-party native packages. Confirm the corrected bundles exclude the incompatible module and restart Metro after changing the startup graph.

If Expo Go exits to the iPhone home screen with no JavaScript exception, Replit's workflow logs cannot reveal the iOS process termination reason. A successful native bundle or even a logged first render does not identify the crashing native component.

**Why:** Replit's device preview does not expose iPhone OS crash reports to the workspace. Startup-import guesses can be wrong: some third-party modules have Expo Go fallbacks, while the actual termination happens outside Metro's JavaScript log stream.

**How to apply:** Check the native launch assets and workflow first, then seek a device crash reason through iPhone Analytics Data or Mac Console/Xcode when available. If that evidence is unavailable, use a controlled, reversible isolation test rather than labeling a package as the cause or claiming a web preview proves the phone works.