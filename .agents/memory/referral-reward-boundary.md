---
name: Referral reward boundary
description: Product timing and consistency rule for invite attribution and loyalty rewards.
---

Award 500 loyalty points to the inviter when a new invitee successfully joins using the inviter's code. Do not defer the reward until a first purchase unless the product rule is explicitly changed everywhere.

**Why:** Buyer-facing referral surfaces previously contradicted the backend about whether joining or first purchase triggered the reward, and separate attribution/reward writes could lose or duplicate points.

**How to apply:** Keep invite attribution and reward creation in one transaction, make retries and concurrent applications idempotent, reject self-referrals, and use the same timing language in every buyer and seller surface.