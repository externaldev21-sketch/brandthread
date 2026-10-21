---
name: Conversation mute semantics
description: Product meaning of a per-account conversation mute versus global notification settings
---

Muting a conversation affects only push alerts targeted at that conversation for the participant who muted it. It must not hide incoming messages, reset unread counts, or remove in-app notification entries. Blocking and unfollowing are separate relationship actions.

**Why:** Muting is a reversible way to stop interruptions from one chat without losing the record of messages or activity; applying it globally would silence unrelated conversations, and dropping in-app entries would make messages appear lost.

**How to apply:** When adding any new conversation-targeted push (including reactions or calls), honor the recipient's conversation mute while preserving message and in-app feed persistence. A global message notification preference remains independent.

Inbox swipe mute is explicitly per-chat, indefinite until the user unmutes it, and must toggle its label to Unmute. Never substitute a person-level safety mute.

**Why:** The owner confirmed these are deliberate product decisions, not stale test expectations, after an inbox redesign regressed them.

**How to apply:** Preserve the existing conversation-mute API and reversible state when redesigning inbox actions.

Unread conversation names are bold; read names are regular. A loaded-empty buyer inbox includes a compose/people-search action. Swipe Delete deletes for the current viewer only, rather than silently archiving.

**Why:** The owner explicitly required restoring these inbox behaviors and preserving their tests.

**How to apply:** Treat these as behavior contracts during future inbox polish, including loading-to-empty transitions.