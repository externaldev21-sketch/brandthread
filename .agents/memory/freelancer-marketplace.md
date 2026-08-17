---
name: Freelancer marketplace payments
description: Escrow/payout integrity decisions for freelancer jobs (Stripe Connect)
---

# Freelancer marketplace — payment decisions

- Escrow model: hirer pays via Checkout up front; freelancer payout is a transfer-on-complete (not destination charges). **Why:** funds may only reach the freelancer after the work is done.
- Hiring is gated on a LIVE Connect readiness check (payouts_enabled + transfers capability), not on merely having an account id. **Why:** a partially onboarded or restricted account would strand escrow funds.
- Transfers always set source_transaction = the escrow charge. If the charge can't be verified, completion rolls back and returns retryable failure — never pay from the platform's general balance.
- Payout state changes are claim-then-act: a conditional UPDATE claims the transition before any Stripe call; deterministic per-job idempotency keys make retries and races safe.
- Cancel = the refund path, allowed from pending/accepted/in_progress while no transfer exists; in_progress cancel is the recovery route when payout delivery fails. Late or racing payments on cancelled jobs are auto-refunded (webhook and sync both guard).
- Sellers' existing Connect accounts are reused for freelancer payouts.
- 5% commission is an unconfirmed product decision (follow-up pending).
