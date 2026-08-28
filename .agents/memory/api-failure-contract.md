---
name: API failure contract
description: Durable safety and compatibility rules for Brandthread API failures and mobile error handling.
---

Every API failure must use a stable request-correlated envelope, while successful response shapes remain unchanged. Client-safe policy context belongs in structured details; internal and provider failures never expose exception text, stacks, SQL, credentials, or provider payloads.

**Why:** Central normalization keeps legacy routes and newer typed errors compatible while ensuring unexpected failures are useful in logs without disclosing internals to clients.

**How to apply:** Preserve the terminal JSON 404/error boundary and request ID on new routes. Log failures with request-scoped structured logging and `{ err }`. Extend the mobile parser compatibly when adding fields rather than making screens parse route-specific bodies.