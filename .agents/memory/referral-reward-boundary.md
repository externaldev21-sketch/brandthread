---
name: Referral reward boundary
description: Product timing and consistency rule for invite attribution, loyalty points and Thread Cash referral rewards.
---

Reward policy ("Give $10. Get $10."), one wording everywhere:
- The friend gets $10 Thread Cash (1000 cents) when they join with the link or code.
- The inviter gets $10 Thread Cash when the friend completes their FIRST order of $10 or more, paid in real money (Thread Cash applied at checkout does not count). Max 50 paid referrals per inviter.
- The inviter still earns 500 loyalty points the moment a friend joins (unchanged, additive; points and cash are separate ledgers).

**Why:** Buyer-facing referral surfaces previously contradicted the backend about whether joining or first purchase triggered the reward, and separate attribution/reward writes could lose or duplicate points. Paying the inviter on join alone invites fake-account farming, so cash waits for a real first order; points were kept on join to avoid changing shipped behaviour.

**How to apply:** Policy constants live in api-server `lib/referrals/policy.ts`; client wording lives in mobile `lib/referralCopy.ts` (a test asserts they agree). Keep attribution, points and the invitee credit in one transaction (`applyReferralCode`). Credits use idempotency keys `referral:<inviteeId>:inviter|invitee`; the inviter payout hook is `qualifyReferralForOrderSafe` in routes/webhooks.ts (called where a checkout order is confirmed paid, idempotent, never throws). Reject self-referral, same-person email aliases, existing customers applying a code, pre-join orders, refunded/cancelled orders. If the rule changes, update policy.ts, referralCopy.ts, loyalty.tsx, the notification bodies in activityEvents.ts and this note together. Rewards already paid are not clawed back on later refunds.
