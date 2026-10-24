# Buyer commerce audit (2/10)

Each screen was audited by reading its code and rendering it at 393×852 with the store-screenshots web harness (`?bt_preview=buyer` / `seller`, fresh and `&demo=1`, plus API overrides for populated and empty states). I also checked swipe rows (cart lines) and the overflow/edit menus (cart Edit) before calling anything missing. Items marked [FIXED] are fixed in this PR. Items without the tag are real but need a product or design decision, a shared-component change, or an API change.

**Product detail (PDP)** (`app/buyer-product-detail.tsx`)
- [FIXED] Sticky "Add to cart" / "Buy now" buttons rendered squashed to the label's height (≈24pt, the text overflowing a thin pill). `flex: 1` was passed as `style`, and Button applies that to its inner face. The flex now lives on a wrapper View.
- [FIXED] Products with no size/color options (a single default variant) could never be bought. The bar read "Select options" forever and Add to cart did nothing (dead tap). They are now ready to buy, and a product with no variant at all reads "Unavailable".
- [FIXED] Fabricated policy text shown for every real seller ("Contact the seller within 7 days…", "All sales final…"). The public product API returns no policy, and the return form says 30 days. These rows now show only real policy text.
- [FIXED] "High Demand" badge stretched edge to edge as a full-width grey bar. It is now sized to its content.
- [FIXED] Off-palette colors: green sale price and "Save $x", red SALE pill, red ✕ on sold-out swatches, red "Please select a size" hint, red error icon. All are now monochrome (white/silver).
- [FIXED] Title-case / unprofessional copy: "Sold Out", "Reserve (No Charge)", "Reserved ✓" (glyph in label, now a check icon), "Size Chart", "Pre-Order Item", "Independent Seller", and alerts titled "Error", "Cannot Add to Cart", "Reserved!", "Payments Unavailable", "Select Options".
- [FIXED] Small tap targets: the "Size guide" link (≈20pt, now with hitSlop), the size-chart toggle (≈34pt) and the waitlist button (≈36pt). Both are now 44pt minimum.
- [FIXED] "You might also like" cards had no accessibility role or label. Color swatches reported `selected` instead of the radio `checked` state.
- [FIXED] Cart badge used a raw `fontSize: 11` (now the `FS.xs` token).
- Disabled primary button ("Select options") has no visible fill on black. The shared Button uses `palette.elevated` (= black) when disabled, so it reads as plain text. This is a shared component, outside this area.
- "Pinch to zoom" pill shows on web and desktop, where pinch isn't available. On letterboxed photos it also floats over the black band, not the photo.
- Countdown "17:59:51" has no label saying what ends (`TimeRemainingLabel`, shared CommerceSignal).
- Bag vs cart wording: "Added to your bag / View bag / In your bag" on this page, but "Cart (N)", "Add to cart" and "Checkout" elsewhere. Left as is because tests pin "View bag" and the term is a product decision.
- Reviews from buyers with no avatar render a "?" placeholder (ProductReviewsSection, shared).

**Size guide sheet** (`app/buyer-product-detail.tsx` — `SizeGuideSheet`, `SizeChartViewer`)
- [FIXED] The two size affordances were labelled inconsistently ("Size guide" vs "Size Chart"). Both now use sentence case.
- [FIXED] "Size guide" link tap target was ≈20pt tall (now has hitSlop).
- [FIXED] Size-chart expand row was ≈34pt tall (now 44pt minimum).
- The size-chart header cells use the theme accent tint (`accentDim`) rather than a neutral fill. That is on-palette in monochrome but tinted in the colored themes.

**Bag / cart** (`app/(buyer)/cart.tsx`)
- [FIXED] Saved-for-later rows showed a generic bookmark icon instead of the product photo, even though the saved item carries `imageUri`.
- [FIXED] Off-palette status colors: green discounted price, green "Discounts" total, green applied-points card and icon, amber "Only N left" pill, red "Last one left!" and "Unavailable" pills, red "No longer available". These are now monochrome, matching the PDP's "urgency by weight" rule.
- [FIXED] Copy: "Last one left!" became "Only 1 left". The checkout-failure alert titled "Error" is now specific.
- [FIXED] "All items selected" select-all row was a ≈24pt tap target (now 44pt).
- [FIXED] Checkout pill showed disabled only by opacity. It now exposes `accessibilityState` disabled/busy.
- Cart summary shows "Shipping & fees $0.00" while checkout charges $12 per seller for the same items ($483 → $507). The estimate should come from the same source.
- Saved-for-later Move/Remove have no pending state or error handling (an API failure is an unhandled rejection).

**Buy now flow** (`components/buy-now/BuyNowFlow.tsx`, `VariantPickerSheet.tsx`)
- [FIXED] Title-case copy: "Buy Now" and "Continue to Checkout".
- [FIXED] Variant picker's "Required" was red and "Only N left" was amber. Both are now monochrome.
- [FIXED] Buy-now from the PDP was impossible for option-less products (see PDP).

**Checkout** (`app/buyer-checkout.tsx`, `components/checkout/*`)
- "Save to my addresses" uses the app-wide green switch (`HapticSwitch` / `SWITCH_TRACK_ON`). That is a shared design token, outside this area.
- Each delivery group reads "Express courier (2–3 days)" directly above "Ships in 3–5 business days", which reads as contradictory without a "then" or "after it ships" qualifier.
- Tax row reads "Calculated at payment" in the hosted path, with no estimate even when the address is complete.

**Payment** (`components/checkout/PaymentSection.tsx`, `StripePayment*.tsx`)
- Clean (rendered: hosted card / Apple Pay / Google Pay row, Stripe note, per-seller split note; no defects found in render or code).

**Order confirmation** (`components/checkout/OrderConfirmation.tsx`, `components/buy-now/OrderSuccessSheet.tsx`)
- [FIXED] "Track Order" button title case (OrderSuccessSheet).
- The confirmation header's close (✕) goes to Discover, not back to where checkout started (the cart or the product). Changing that is a navigation decision.

**Buyer orders** (`app/(buyer)/orders.tsx`)
- [FIXED] Items without a variant rendered an empty "()" (e.g. "Gift card () × 1").
- [FIXED] Order cards and their "View order details" / "Track shipment" buttons had no accessibility role or label.
- [FIXED] Action buttons were ≈34pt tall with 11pt labels (now 44pt minimum and 12pt). Meta, tracking, "+N more" and cancellation-reason text moved from the 11pt badge floor to the 12pt `FS.meta` token.
- [FIXED] Copy: "My Orders", "View Order Details", "Track Shipment", "Discover Products", empty and error titles ending in a period, and the "→ Est." arrow.
- "Track shipment" opens the same order detail as "View order details" (no direct jump to the tracking section).
- Cancelled orders show "Cancelled" twice: the timeline exception pill, then the red "Order cancelled" banner right under it.
- Cancelled banner is red/pink (`theme.error`). It is semantic, but it's the only colored element on the list.

**Order detail + tracking** (`app/buyer-order-detail.tsx`, `components/orders/*`)
- [FIXED] Items, Shipping address, Payment summary and Tracking cards ran edge to edge with no 16pt gutter, unlike the status and progress cards above them.
- [FIXED] "Shipped via undefined" (blank in render) when the carrier is unknown. It now reads "Shipped".
- [FIXED] "Pre-order status" heading had no color set, so it rendered in the default (black) on black — invisible.
- [FIXED] A link with no `id` spun forever. Not-found now shows an "Order not found" state with a back action.
- [FIXED] Internal-sounding footer "This order view shows your purchase details only. Internal seller information is not visible here." removed.
- [FIXED] Title-case labels throughout: Order Details, Order Progress, Shipping Address, Payment Summary, Cancel Order, View/Request Return, Report a Problem, Report Seller, Leave a Review, Help Center, Contact Seller, Keep Order, Yes, Cancel, Order Cancelled. Alerts titled "Error", "Cannot Cancel" and "Not Available" are now specific.
- [FIXED] Review-sheet close (✕) and the cancel modal's "Yes, cancel" had no accessibility role.
- The bottom action bar is always pinned and permanently takes about 130pt of the screen (Help center + Contact seller, plus a review card when delivered).
- "Report a problem" and "Report seller" use the red destructive accent although neither is destructive.
- Star rating uses amber (`theme.warning`), and "Review submitted" uses green. Both are off black/white/silver.

**Returns** (`app/buyer-return-request.tsx`, `app/return-request.tsx`, `app/return-detail.tsx`)
- [FIXED] Reason radios reported `selected` instead of the radio `checked` state.
- [FIXED] Off-token `FS.xs + 1` font sizes (error, notice, summary, field-label text) replaced with the `FS.meta` token.
- [FIXED] Return-detail's seller "Cancel / Decline return" pair was squashed: the same `flex: 1`-on-Button bug as the PDP.
- "30-day return window · request by …" is computed from the order date, not the delivery date, and still shows when the date has passed.
- Return evidence photos can't be opened full size.
- With no order id the request screen says "Check your connection", which is the wrong message for a bad link.
- Header "Return · #BT-…" would double the "#" for order numbers that already carry one (the dispute demo data does).

**Refund request** (`app/buyer-refund-request.tsx`)
- [FIXED] When the order failed to load, the form still rendered "Maximum possible refund $0.00" with a live Submit button that silently did nothing (dead tap). It now shows a "Couldn't load this order" state with Try again / Go back.
- [FIXED] No `orderId` spun forever.
- [FIXED] Reason rows were ≈34pt and had no radio role or state. The details field and the photo add/remove controls had no labels. The 18×18 remove button had no hitSlop.
- [FIXED] Green success circle replaced with the monochrome accent.
- [FIXED] Copy: Title Case everywhere ("Request Refund", "Order Items", "Refund Reason", "Refund Request Submitted", "Back to Order", "Submit Refund Request"). "Refund updates will appear here." pointed at a screen that closes. The disclaimer "Do not claim a refund is approved…" was addressed to the buyer like an internal rule.
- Max refund always quotes the full order total, even after partial refunds.

**Disputes** (`app/disputes.tsx`)
- `formatCents(Math.round(d.amount * 100))` ignores `currency`, so non-USD chargebacks show as dollars.
- On a refetch failure with stale rows already loaded, no error is shown.

**Dispute detail** (`app/dispute-detail.tsx`)
- [FIXED] Loading, error and "not found" states had no header or back button (a dead end on web), and loading was a bare "Loading…" line. They now keep the Dispute header and use a spinner.
- [FIXED] Customer claim was shown twice: truncated in the alert card, then in full directly below.
- [FIXED] "Products" row always rendered empty for real disputes (the API path never fills line items). It is now hidden when empty.
- [FIXED] Evidence-type chips had no radio role or state.
- [FIXED] Title Case copy: Customer Claim, Order Context, Add Evidence, Submit Evidence, Submit All Evidence, Internal Notes, Add Note, Tracking Proof, Product Photos, Written Response. "Accept Dispute (Concede)" is now "Accept dispute and refund". The "Required" alert is now specific.
- Alert card uses a hard-coded red gradient (`rgba(248,113,113,…)`) rather than theme tokens, and the "open" status badge uses the accent "purple" variant.
- "Add note" has no loading state while saving.

**Shipping addresses** (`app/buyer-addresses.tsx`)
- [FIXED] "Set as default address" checkbox could not be unchecked once tapped. It is now a toggle, locked only for the first address or the current default.
- [FIXED] Validation said "Please fill out all required fields." without naming them. It now lists the missing fields.
- [FIXED] Form inputs had no accessibility labels (the visible labels aren't associated).
- [FIXED] Copy: "Save Address", "Delete Address", "ZIP / Postal Code", and three alerts titled "Error".
- Country is free text ("US") rather than a picker, unlike checkout's country dropdown.
- Delete and set-default have no pending state, so a double tap fires twice.

**Saved payment methods** (`app/buyer-payment-methods.tsx`)
- [FIXED] A failed load showed the "No saved payment methods" empty state. It now shows a retry row.
- [FIXED] Card numbers didn't line up across rows (brand chip width varied: VISA vs MASTERCARD). The chip is now a fixed width.
- [FIXED] "Make default" rendered a 17pt label inside a forced 24pt-tall button (clipped and oversized). It now uses the compact size.
- [FIXED] Empty state repeated the Stripe security sentence that already appears twice on the page. Raw `fontSize: 11` replaced with `FS.xs`. Alerts titled "Error" are now specific.
- No way to add a card from this screen; cards only appear after a purchase.
- "Default" badge is green (`theme.success`). The same badge is on Shipping addresses.

**Buyer protection** (`components/BuyerProtectionNote.tsx`)
- Clean (rendered on PDP, checkout flat row, and order detail; copy is sourced from the Terms; link meets 44pt).
