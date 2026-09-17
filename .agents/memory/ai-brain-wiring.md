---
name: AI Brain conversation contract
description: Durable behavior and data-trust rules for Brandthread's seller AI chat.
---

Brandthread AI opens as a normal conversation with one simple greeting and an empty composer. It never auto-sends a prompt, inserts priorities as a chat message, or maintains a second legacy conversation UI.

**Why:** The prior implementation duplicated outgoing messages across the screen and service, persisted empty placeholders, and silently replaced network failures with fabricated account advice. This made the chat appear blank or fake.

**How to apply:** Keep one owner for immutable message creation, never persist typing placeholders, scope history by authenticated identity/store context, and show retryable errors instead of fake answers. Business answers must use a fresh, server-built, permission-scoped account snapshot; unavailable or untracked facts remain explicit.

Account context may include store identity, product and inventory state, paid-order and revenue summaries, content, customer aggregates, inbox activity, campaigns, and manufacturing status. Derive ownership from verified authentication, avoid unnecessary customer PII, and distinguish observed data from AI suggestions.
