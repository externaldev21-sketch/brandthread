---
name: User-scoped onboarding state
description: Prevent identity and role leakage when multiple Clerk accounts use one device.
---

All local state that decides whether onboarding is complete, which role routes the person, or which editable profile belongs to them must be bound to the authenticated Clerk user ID. Async work that survives an account change must use immutable user-specific storage keys and discard stale responses.

**Why:** Device-global AsyncStorage completion and profile keys can route a newly signed-in person into the prior account's buyer or seller experience, or write the prior person's identity into their local profile.

**How to apply:** When adding an auth-gated local flag or an async identity hydration, store or verify its owner Clerk ID. Do not resolve a mutable “current user” key after an await when the operation began for a specific user.