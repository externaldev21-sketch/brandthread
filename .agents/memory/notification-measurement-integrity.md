---
name: Notification measurement integrity
description: Durable rules for distinguishing push provider outcomes from user-device notification events.
---

Treat an Expo send ticket as a provider result, never as proof that a device received or displayed a notification. Receipt, open, and tap events come from client event capture (or a true provider receipt lookup), and logical notifications must keep the same stable identifier across retries.

**Why:** Conflating provider acceptance with device receipt inflates delivery metrics, while generating a new ID on each retry defeats deduplication. Cold-start responses can also disappear unless local persistence completes before Expo's recoverable response is cleared.

**How to apply:** Give every producer a persisted or deterministic notification ID. Serialize writes to an account-scoped event outbox, wait for authenticated ownership, and clear cold-start responses only after durable enqueue succeeds.