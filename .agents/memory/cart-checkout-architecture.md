---
name: Cart & Checkout Architecture
description: Buyer cart, checkout, payments, order tracking, returns, refunds, and disputes system.
---

## Service files
- `services/cartTypes.ts` — 25+ types: CartItem, Cart, CheckoutSession, BuyerProduct, BuyerReturnRequest, BuyerRefundRequest, BuyerProblemReport, RETURN_REASON_OPTIONS, PROBLEM_TYPE_OPTIONS, CHECKOUT_STEPS
- `services/cartService.ts` — all cart/checkout/payment functions; 4 demo products with full variants

## Screen files
- `app/(buyer)/cart.tsx` — cart tab; seller-grouped items; save-for-later; summary card; checkout CTA
- `app/buyer-product-detail.tsx` — buyer product view; variant pickers; add to cart; buy now
- `app/buyer-checkout.tsx` — 7-step flow (contact→shipping→delivery→discounts→payment→review→confirmation); demo payment; placeOrder idempotency
- `app/buyer-return-request.tsx` — return request; reason picker; preferred resolution; submit
- `app/buyer-refund-request.tsx` — refund request; max amount; reason; submit
- `app/buyer-problem-report.tsx` — problem report; type grid; contacted-seller toggle; submit

## Navigation
- Cart is 6th buyer tab (after Discover, before Friends) in `app/(buyer)/_layout.tsx`
- New routes registered in `app/_layout.tsx`: buyer-product-detail (modal), buyer-checkout, buyer-return-request, buyer-refund-request, buyer-problem-report, return-request (alias)
- `orders` added as hidden tab in buyer layout so the route is registered
- Feed SHOP button → `/buyer-product-detail?productId=...&productName=...&sourcePostId=...`
- buyer-order-detail.tsx handleReportProblem → `/buyer-problem-report?orderId=...`

## Key decisions
- AsyncStorage keys: `bt:cart:v1`, `bt:checkout:v1`, `bt:buyer:returns:v1`, `bt:buyer:refunds:v1`, `bt:buyer:problems:v1`, `bt:buyer:payment_attempts:v1`
- All payment is demo-mode; raw card data never stored; test cards: 0002=declined, 0003=insufficient_funds
- buy-now creates a session with isBuyNow=true using buyNowCartItems; existing cart untouched until order succeeds
- placeOrder uses idempotencyKey stored in CheckoutSession to prevent duplicate submission
- Tax is estimated (demo rates by state); not real tax calculation

**Why:**
Needed full commerce flow without a real payment provider configured. Demo mode ensures the full UX works end-to-end for testing and demos while making it obvious no real money changes hands.
