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

Overlapping chargeback implementations must have one accounting owner, separate from dispute timeline and notification processing.

**Why:** Booking a withdrawal when a dispute opens and booking another loss when it closes charges the seller twice. Final-loss recovery also needs to own fee allocation and debt collection.

**How to apply:** Keep opening events for timeline and payout holds, book final lost outcomes once, and reverse historical withdrawal postings idempotently before adopting the final-loss recovery ledger.

Single-use checkout benefits need separate quote and reservation semantics. A fresh quote may omit an already-held benefit, but a competing payment attempt must fail its atomic claim rather than silently charge the undiscounted price.

**Why:** Reusing quote eligibility during payment can turn a concurrent discount reservation into a higher charge instead of a retryable conflict.

**How to apply:** Preserve transactional claim ownership and same-attempt idempotency. When a benefit is unavailable during payment, return an explicit conflict; do not treat an unfinished reservation as a completed redemption.