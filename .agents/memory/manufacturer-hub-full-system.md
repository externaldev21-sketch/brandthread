---
name: Manufacturer Hub Full System
description: Durable safety and ownership rules for shared manufacturer conversations, orders, private media, notifications, and wallet-backed payments.
---

## Shared-record rule

A seller/manufacturer pair has one canonical thread, and both participants read and write the same thread, messages, order cards, sample orders, and bulk orders. Participant unread state is independent.

**Why:** Duplicated or role-specific records drift, split history, and let one participant's read action clear the other participant's badge.

**How to apply:** Enforce pair uniqueness in the database, authorize every operation against either participant, and place the read boundary before fetching so later sends cannot be erased.

## Private attachment rule

A private object path is not authorization. Every thread upload must be bound server-side to its thread and uploader before it can be referenced, and signed display URLs are issued only after thread authorization.

**Why:** Signing arbitrary client-supplied object paths would let a participant expose any private object path they learn.

**How to apply:** Validate bytes, persist the upload binding, require an unconsumed binding from the current sender when creating a message, store only private paths, and return short-lived signed URLs.

Manufacturer profile photos follow the same private-by-default storage rule. Public-directory eligibility is the authorization decision that permits an anonymous signed display URL; object ACLs never become public merely because a profile may later be published.

**Why:** Pending or private manufacturers can upload the same assets as public profiles, so upload-time visibility cannot safely predict read authorization.

**How to apply:** Persist private object paths, sign them for the authenticated owner, and sign them anonymously only after confirming the profile is active and public.

## Shared-order concurrency rule

Every mutable sample or bulk order operation uses an integer revision token and advances it atomically, including status decisions and media attachment.

**Why:** Timestamp equality loses database precision, while read-modify-write arrays and JSON notes lose concurrent participant updates.

**How to apply:** Require the last returned revision for conditional mutations, return a visible stale-write conflict, and use database-atomic append/update expressions for shared media.

## Production ownership rule

Manufacturers advance production stages and add shipment tracking. Sellers can review samples and observe live status, but cannot advance production or trigger shipment-linked money movement.

**Why:** Shared visibility must not imply shared authority over manufacturing state or payouts.

**How to apply:** Make status transitions conditional on the exact current stage and authenticated manufacturer; make seller decisions separate explicit transitions.

## Payment recovery rule

Any wallet-backed external transfer must be claimed and reserved transactionally before calling Stripe, use a persisted deterministic idempotency key, and support reconciliation from an in-progress state.

**Why:** A failure after Stripe succeeds can otherwise duplicate a transfer on retry or strand reserved funds forever.

**How to apply:** Persist attempt identity before the external call, classify ambiguous failures as reconcilable, compensate only definitive rejection, and atomically finalize the order and immutable ledger.

## Notification context rule

Manufacturer-thread, sample-order, and bulk-order notifications retain distinct target types and participant-specific destinations.

**Why:** A generic order target can open the wrong tracker even when the notification recipient is correct.

**How to apply:** Samples deep-link to sample review/tracking, bulk orders to production tracking, and thread messages to the canonical shared conversation.