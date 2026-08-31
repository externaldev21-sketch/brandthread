---
name: Payment API security boundaries
description: Durable rules for fail-closed paid access, distributed abuse controls, and Stripe webhook ownership.
---

Paid entitlement lookup failures must deny access with a stable service-unavailable response; they must never fall through to paid handlers.

**Why:** A database outage must not become a temporary paid-feature unlock.

**How to apply:** Keep authentication, known insufficient-plan, and lookup-failure responses distinct when adding paid routes.

Rate-limit state must remain shared across instances and unavailable limiter storage must fail closed. Unauthenticated webhook identities must use a stable, bounded source such as normalized IP, not attacker-controlled signatures.

**Why:** Process-local or attacker-selected keys allow cross-instance bypass and unbounded bucket creation.

**How to apply:** Reuse named global policies and avoid stacking route-local counters on the same request.

Stripe event dispatch claims need retryable failures, attempt fencing, and lease heartbeats. Concurrent deliveries may return success only after the active attempt reaches a completed state.

**Why:** A plain processed-ID check either drops crashed work or allows an expired lease to overlap a still-running handler.

**How to apply:** Claim before dispatch, renew while active, fence renewal and terminal writes by the claim attempt, and preserve handler-level idempotency.