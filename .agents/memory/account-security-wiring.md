---
name: Account Security wiring
description: What was pre-existing vs newly wired for biometric unlock, 2FA, and login activity.
---

## What was already working
- `login-methods.tsx` — Already read real Clerk external accounts (Google/Apple) and password status via `useUser()`. Displayed them read-only with correct Active/Not set badges.

## What was newly built

### biometric-unlock.tsx (completely rewritten)
- Uses `expo-local-authentication` (installed this session).
- Checks `hasHardwareAsync()` + `isEnrolledAsync()` on mount to determine real device support.
- Detects biometric type label: FACIAL_RECOGNITION → "Face ID" (iOS) / "Face Recognition" (Android), FINGERPRINT → "Touch ID" (iOS) / "Fingerprint" (Android).
- Enabling: calls `authenticateAsync()` first — user must pass biometric before toggle turns on.
- Preference persisted in `SecureStore` under key `bt:biometric:enabled`.
- Web: Switch disabled with explanatory sublabel.
- No app-level gating implemented (that lives in `_layout.tsx`); this screen just manages the setting.

### login-methods.tsx — 2FA section added
- Added "Two-Factor Authentication" section below existing methods card.
- Reads `user.twoFactorEnabled` from Clerk for current status.
- **Enable flow**: calls `user.createTOTP()` → shows modal with TOTP secret + URI + backup codes → user enters 6-digit code → calls `user.verifyTOTP({ code })`.
- **Disable flow**: Alert confirmation → calls `user.disableTOTP()`.
- Uses Clerk's native TOTP — no QR code library needed (shows secret as copyable text + URI).
- No 3rd party library needed; all via `@clerk/expo` `useUser()` hook.

### security.tsx
- Wired "View" button on User activity logs row to navigate to `/login-activity`.

### login-activity.tsx (new screen)
- Fetches `api.security.sessions()` → `GET /api/ai/sessions` (Clerk session list).
- Displays each session: status (Active/other), signed-in date, last active (relative), expiration, session ID prefix.
- Active session gets "Current" badge.
- Empty state, loading, and error states all handled.

### Backend: GET /api/ai/sessions
- Calls `clerkClient.sessions.getSessionList({ userId, limit: 20 })`.
- Returns `{ sessions: [{ id, status, createdAt, lastActiveAt, expireAt, clientId }] }`.

### Mobile api.ts additions
- `api.ai.brandMemoryRebuild()` — POST /api/ai/brand-memory/rebuild
- `api.ai.suggestions()` — GET /api/ai/suggestions
- `api.security.sessions()` — GET /api/ai/sessions

## Key decisions
- Biometric auth is required before enabling (prevents someone enabling while phone is unlocked and unattended).
- 2FA uses Clerk TOTP natively — no 3rd party TOTP library required.
- Login activity screen is new (no pre-existing screen for it). Navigated to from security.tsx "View" button.
