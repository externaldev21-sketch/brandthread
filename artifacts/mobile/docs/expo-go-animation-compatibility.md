# Expo Go SDK 57 animation compatibility

The phone preview pins Reanimated **4.5.0** and Worklets **0.10.0** together.
These are the SDK 57 animation versions shipped by older Expo Go clients.

Expo maintainers documented that the online dependency recommendations moved
to 4.5.1/0.10.1 before the corresponding Expo Go binaries shipped. Affected
clients can terminate their native process after downloading a valid bundle,
with no JavaScript error and with Expo Doctor passing:

- https://github.com/expo/expo/issues/48390
- https://github.com/expo/expo/issues/48418

This is a bounded compatibility workaround for the reported phone startup
failure, not proof that the user's device encountered that particular defect.
Stable native version checks in both libraries compare major/minor versions,
so this patch-level pair remains within the SDK 57 native compatibility line.
No application screens, gestures, or animation implementations are replaced.

The two packages are deliberately excluded from Expo's automatic dependency
repair to prevent it immediately reinstating the affected pair. Other Expo
dependencies retain normal validation. Keep the installed versions and lockfile
in sync, clear Metro's generated cache after switching this pair, and check
both platform launch bundles.

Remove the exceptions and advance both packages together only after confirming
the target Expo Go/native client versions and a successful cold launch on a
device. Bundle downloads, web screenshots, and source tests do not establish
that the iPhone process survives startup.