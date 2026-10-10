# Expo Go SDK 57 animation compatibility

The project uses Reanimated **4.5.1** and Worklets **0.10.1** together, matching
the installed SDK 57 compatibility map. Neither is excluded from Expo's
dependency validation. Use a current Expo Go client, not the older SDK 57
clients that contained 4.5.0/0.10.0.

Expo maintainers documented that the online dependency recommendations moved
to 4.5.1/0.10.1 before the corresponding Expo Go binaries shipped. Affected
clients can terminate their native process after downloading a valid bundle,
with no JavaScript error and with Expo Doctor passing:

- https://github.com/expo/expo/issues/48390
- https://github.com/expo/expo/issues/48418

This upstream report is not proof that the user's device encountered that
particular defect. The installed phone's Expo Go version is logged by the
development startup diagnostics; obtain its native crash report if it exits
without a JavaScript error.
Stable native version checks in both libraries compare major/minor versions,
so this patch-level pair remains within the SDK 57 native compatibility line.
No application screens, gestures, or animation implementations are replaced.

The former older-client pin and validation exclusions have been removed.
Keep installed versions and the lockfile in sync, clear Metro's generated
cache after switching the pair, and check both platform launch bundles.

Confirm the target Expo Go/native client versions and a successful cold launch
on a device before declaring the native crash fixed. Bundle downloads, web
screenshots, and source tests do not establish that the iPhone survives startup.