---
name: Account-bound screen state
description: Privacy rules for local UI state and in-flight requests when Clerk changes the active session.
---

Treat any screen state containing user-private data as owned by the Clerk user ID that loaded it. Compare that owner to the current active user during render, and render no private data when they differ. Also generation-guard asynchronous responses so requests started by a prior account cannot repopulate state.

**Why:** Clerk can change the active session without unmounting the current route. An effect that clears state runs after the first render for the new account, while old requests can settle later; either gap can expose the prior account's private data.

**How to apply:** For private list/detail state that survives renders, store its owner ID, derive visible data only when it matches the active user, clear ancillary state on identity changes, and reject stale request results using an account generation or captured identity.

Deferred or multi-request account mutations must carry the Clerk user ID captured at the start of the operation, and the server must compare it with the authenticated user before every mutation.

**Why:** A client-side identity check cannot close the race where Clerk switches the active session between two requests; without a server comparison, queued onboarding or profile data can mutate the newly active account.

**How to apply:** Include an expected account ID on chained or queued authenticated mutations, reject mismatches before writes, and keep retry payloads in user-scoped storage. Do not rely only on route cancellation or post-response checks.