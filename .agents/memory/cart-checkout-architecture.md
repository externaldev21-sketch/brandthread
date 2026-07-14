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
- `return-request.tsx` exists as a re-export alias of `buyer-return-request.tsx` (Expo Router requires a file)
- `orders` added as hidden tab in buyer layout so the route is registered
- Feed SHOP button → `/buyer-product-detail?productId=...&productName=...&sourcePostId=...`
- buyer-order-detail.tsx handleReportProblem → `/buyer-problem-report?orderId=...`
- discover.tsx all 4 product taps → `buyer-product-detail` (hero: prod_canvas_cargo; ForYou/DroppingRow: prod_ripstop_cargo; Trending: prod_canvas_cargo)
- seller-profile.tsx "Shop" button → activates Products tab (setActiveTab(1)); product taps for buyers → `buyer-product-detail?productId=...`
- product-store.tsx "Add to Cart" / "Buy Now" → `buyer-product-detail?productId=...` (was showing Alert placeholders)
- buyer-order-detail.tsx "Buy Again" button → looks up product by name via getAllDemoProducts(), routes to buyer-product-detail or prompts Discover

## BuyerOrderView limitation
- `lineItems` on BuyerOrderView does NOT include `productId` or `variantId` — only `productName`, `variant` (string), `quantity`, `unitPrice`
- Buy Again resolves product by name match against getAllDemoProducts()
- AddToCartParams does NOT accept a `cart` param — addToCart() loads cart internally

## Key decisions
- AsyncStorage keys: `bt:cart:v1`, `bt:checkout:v1`, `bt:buyer:returns:v1`, `bt:buyer:refunds:v1`, `bt:buyer:problems:v1`, `bt:buyer:payment_attempts:v1`
- All payment is demo-mode; raw card data never stored; test cards: 0002=declined, 0003=insufficient_funds
- buy-now creates a session with isBuyNow=true using buyNowCartItems; existing cart untouched until order succeeds
- placeOrder uses idempotencyKey stored in CheckoutSession to prevent duplicate submission
- Tax is estimated (demo rates by state); not real tax calculation

**Why:**
Needed full commerce flow without a real payment provider configured. Demo mode ensures the full UX works end-to-end for testing and demos while making it obvious no real money changes hands.
