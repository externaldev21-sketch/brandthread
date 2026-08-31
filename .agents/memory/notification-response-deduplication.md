---
name: Notification response deduplication
description: Prevent duplicate or stale navigation when Expo exposes one notification tap through multiple response APIs.
---

Treat an Expo notification request identifier as the idempotency key for tap navigation. Share the handled-identifier set between the live response listener and cold-start last-response recovery, and preserve it across effect reruns.

**Why:** The same tap can be delivered to the warm listener and remain available from cold-start response recovery. Navigating from both paths repeats the redirect and can unexpectedly pull the user away from the screen they reached after the first navigation.

**How to apply:** Route every notification-tap entry point through one response handler backed by a shared identifier set. Clear Expo's stored last response after recovery, but do not rely on clearing alone for deduplication.