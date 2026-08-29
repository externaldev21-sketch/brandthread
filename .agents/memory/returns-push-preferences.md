---
name: Returns and push preferences
description: Durable contracts for buyer return/refund requests and granular notification settings.
---

Buyer return and refund submissions must create a real server return record. Never report success from an AsyncStorage fallback when the API fails. Buyer status surfaces use the server lifecycle: `pending`, `approved`, `denied`, or `refunded`, including seller response and settled refund amount when present.

**Why:** A locally stored “submitted” request is invisible to the seller and cannot trigger a Stripe refund, which gives the buyer a false confirmation.

**How to apply:** Return forms may cache server responses for display, but submission failure must remain visible and retryable. Poll or refresh the returns API for status rather than deriving it from the order or local state.

Granular notification category switches control push delivery only. In-app notification feed records remain available even when a matching push category is disabled. The existing realtime/daily digest setting remains a separate preference.

**Why:** Disabling a disruptive device alert should not erase important order, payment, dispute, or message history inside the app.

**How to apply:** Every new push-producing event must declare a logical event category and pass through the centralized preference-aware push helper. Feed labels such as `orders` are presentation categories, not push categories; pass the singular push category such as `order` explicitly. Do not send category pushes directly to stored device tokens.