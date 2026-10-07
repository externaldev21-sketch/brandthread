---
name: Notification work lifecycle
description: Register full asynchronous notification operations so drains cannot finish before delivery work is discovered.
---

Register the complete notification operation synchronously when it is started, including asynchronous recipient and preference lookups—not only the eventual send.

**Why:** A drain can otherwise observe an empty work set while a lookup is still pending and return before that lookup schedules delivery. This caused missed stock and saved-product alert work during shutdown and verification.

**How to apply:** Any background notification producer must enter the tracked lifecycle before its first asynchronous lookup, and its tracked promise must settle only after its downstream delivery work finishes.
