---
name: Account-bound screen state
description: Privacy rules for local UI state and in-flight requests when Clerk changes the active session.
---

Treat any screen state containing user-private data as owned by the Clerk user ID that loaded it. Compare that owner to the current active user during render, and render no private data when they differ. Also generation-guard asynchronous responses so requests started by a prior account cannot repopulate state.

**Why:** Clerk can change the active session without unmounting the current route. An effect that clears state runs after the first render for the new account, while old requests can settle later; either gap can expose the prior account's private data.

**How to apply:** For private list/detail state that survives renders, store its owner ID, derive visible data only when it matches the active user, clear ancillary state on identity changes, and reject stale request results using an account generation or captured identity.