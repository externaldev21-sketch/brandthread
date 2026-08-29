---
name: Trust and recovery boundaries
description: Durable rules for reversible deletion, IP case privacy, seller verification, and optional web tracking.
---

Product deletion is hidden immediately and recoverable by its owner for five minutes. After that deadline, restore must fail rather than silently reviving the listing. Cart removal uses a short client-only Undo because the cart remains account-scoped mutable state.

**Why:** Destructive commerce actions need a predictable recovery boundary without leaving deleted inventory publicly visible or indefinitely recoverable.

**How to apply:** Keep all public and buyer-commerce product queries deletion-aware. Any future cleanup job must preserve the same deadline and idempotent owner-only restore semantics.

IP case status is protected by a one-time capability token whose hash alone is stored. Unknown references and invalid tokens must remain indistinguishable.

**Why:** Case references and claimant information are sensitive, and sequential or guessed references must not become an enumeration channel.

**How to apply:** Never expose raw status tokens in logs, moderator lists, analytics, or database fields. Keep moderator actions authenticated, audited, and append-only.

Seller verification is derived from the legacy verification grant, completed identity verification, active positive standing, and no policy restriction. Optional analytics and marketing remain disabled until a current-version explicit web consent record allows them.

**Why:** A stale badge or pre-consent tracker creates a trust and compliance failure even when individual source fields look valid.

**How to apply:** Use the centralized server eligibility rule on every public payload, and route optional web tracking through the consent gates rather than reading storage independently.