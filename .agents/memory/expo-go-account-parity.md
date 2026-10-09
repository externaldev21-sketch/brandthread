---
name: Expo Go iOS account parity
description: Account matching required for physical-device Expo Go development preview
---

**Rule:** For a physical iOS Expo Go development preview on Expo SDK 57, Expo CLI and Expo Go must authenticate as the same Expo account. Prefer a personal Expo access token supplied only through Replit Secrets over the workspace's managed private Expo CLI session; if a token is present but invalid, fail visibly rather than switching to the managed session.

**Why:** Expo's September 2026 account check rejects the managed private CLI identity on a user's phone, even when the manifest and native bundle both serve successfully. Browser-based CLI login from a remote Replit container redirects to its own localhost, which the user's phone cannot reach.

**How to apply:** Have the user sign into Expo Go with the same personal Expo account that owns the token. Never request or paste the token in chat; use a secure secret form. After changing the secret, restart the managed Expo workflow and verify CLI account, iOS manifest, and native bundle. A successful HTTP manifest alone cannot prove the phone-side Expo Go account matches.