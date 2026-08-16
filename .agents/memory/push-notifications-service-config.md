---
name: Push notifications & service config
description: How push notifications and background service auth are wired in the Brandthread mobile app.
---

## Push notification setup (_layout.tsx)
- `Notifications.setNotificationHandler(...)` at module level (shows alerts while foregrounded)
- Android channel set via `Notifications.setNotificationChannelAsync('default', ...)` gated on `Platform.OS === 'android'`
- `ServiceConfigurer` component: calls `configureServices(() => getToken())` inside `useAuth()` effect — must be inside ClerkProvider tree
- `PushRegistrar` component: requests permissions, gets Expo push token, POSTs to `/api/push/register`; non-fatal on failure

## Camera capture
- `camera-capture` screen registered as `fullScreenModal` in Stack navigator
- `create-post.tsx` uses `useFocusEffect` to read `(global as any).__cameraCaptureResult` on focus; null-cleared after reading
- "Record video" button pushes `/camera-capture?maxDuration=<n>` instead of showing an Alert

## expo-camera version
- Must install `expo-camera@~17.0.10` for Expo SDK 54 (not the latest 57.x)
- `pnpm --filter @workspace/mobile add expo-camera@~17.0.10`

**Why:** Expo SDK peer-checks its packages; a major version mismatch causes Metro to fail to resolve the package even when it's physically installed.
