---
name: Conversation mute semantics
description: Product meaning of a per-account conversation mute versus global notification settings
---

Muting a conversation affects only push alerts targeted at that conversation for the participant who muted it. It must not hide incoming messages, reset unread counts, or remove in-app notification entries. Blocking and unfollowing are separate relationship actions.

**Why:** Muting is a reversible way to stop interruptions from one chat without losing the record of messages or activity; applying it globally would silence unrelated conversations, and dropping in-app entries would make messages appear lost.

**How to apply:** When adding any new conversation-targeted push (including reactions or calls), honor the recipient's conversation mute while preserving message and in-app feed persistence. A global message notification preference remains independent.