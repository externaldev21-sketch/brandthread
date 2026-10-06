---
name: Truthful seller profile metrics
description: Rules for computing seller performance and public profile engagement metrics.
---

Seller profile performance must be derived from settled buyer checkout orders only. Exclude cancelled, refund-pending, and refunded order records from revenue and order totals. Storefront visits must be authenticated and deduplicated per seller, viewer, and UTC day before they affect conversion.

**Why:** Checkout can create a paid-but-oversold record that is being refunded, and an unauthenticated increment endpoint lets anyone fabricate visits. Either makes a seller's profile performance misleading.

**How to apply:** When extending seller metrics, retain the paid-order eligibility filter and calculate conversion as eligible orders divided by recorded visitors, returning zero when there are no visitors. Empty accounts should show zero values and a neutral state, never demo trends.

Public profile Likes totals count received likes on eligible, publicly visible posts for both buyers and sellers, independent of how many posts the client loads. Do not derive public stat totals from a paginated grid or from the owner's private metrics.

**Why:** Public visitors may see only a subset of posts; page sums undercount, while owner-only totals can include unpublished or moderated posts.

**How to apply:** Keep public engagement aggregation aligned with public post eligibility and return it in profile responses, including the seller response used by signed-out visitors.