---
name: Expo Go iOS account parity
description: Account matching required for physical-device Expo Go development preview
---

**Rule:** For physical iOS Expo Go on SDK 57, follow the current Expo skill's managed **Preview on your phone** sign-in flow. Preserve its nonfatal `create-launch login` bootstrap. Do not prescribe manual CLI/EAS login or substitute the managed session secret for `EXPO_TOKEN`.

**Why:** CLI/phone account mismatch can block a valid bundle, but Replit now provisions the managed session through its phone-preview flow. Earlier token-first advice predates that flow and must not override current platform instructions.

**How to apply:** Read the current Expo skill before authentication changes. A stale managed session needs a workspace refresh and workflow restart, not hand-written credentials. Never expose existing tokens. A successful manifest alone does not prove the phone's account matches.