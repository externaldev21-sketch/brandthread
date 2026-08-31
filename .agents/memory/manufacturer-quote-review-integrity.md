---
name: Manufacturer quote and review integrity
description: Authorization and source-of-truth rules for manufacturer quotes, counteroffers, reviews, and directory ratings.
---

Manufacturer quote requests are a shared seller/manufacturer record. Seller and manufacturer actions use separate allowlisted transition maps, and mutations must condition on the status that was read so concurrent responses cannot overwrite a terminal decision.

**Why:** A free-form status patch lets either participant skip required states or restore an obsolete response after the other participant has acted.

**How to apply:** Keep seller mutations scoped to the authenticated seller and manufacturer inbox/response mutations scoped to the authenticated canonical manufacturer UUID. Persist counteroffer terms separately from human-readable notes.

Manufacturer reviews require an authenticated seller-owned completed or delivered shared sample/bulk order. Each order can create at most one review, and public rating/count values are aggregated from review rows rather than copied from profile input.

**Why:** Device-local or profile-entered ratings are not auditable and allow unauthorized, duplicate, or fabricated reputation.

**How to apply:** Validate order ownership, manufacturer identity, terminal eligibility, all rating bounds, and the unique order constraint on the server. Recalculate any cached basis-points rating from the review table.