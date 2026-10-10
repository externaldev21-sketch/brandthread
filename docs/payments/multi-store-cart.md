# Multi-store cart: audit

Requirement: the cart is grouped by store, shipping is priced per store, and the
buyer pays once while each seller receives their share through Stripe Connect
transfers. Discount codes belong to one store each.

## Verdict by requirement

| Requirement | Where it lives | Status |
| --- | --- | --- |
| Cart grouped by store | `app/(buyer)/cart.tsx` via `groupCartBySeller`; one section per seller, group subtotal, "Checkout from {seller}" | Met |
| Checkout groups by store | `OrderSummarySection.tsx` renders `From {seller}` blocks with that store's shipping method, price and delivery window | Met |
| Shipping per store | `priceCartGroup` (`lib/money/cartCheckout.ts`) resolves that seller's zones / weight tiers / flat rate for the destination; the quote returns `shippingCents` per group and the summary shows it on each store block | Met |
| One payment for the whole cart | `POST /buyer/checkout/payment-intent` creates one PaymentIntent for the sum of all groups, with `transfer_group: cart_<id>` | Met |
| Each seller is paid their share by Connect transfer | Paid webhook `handleCartPaymentSucceeded` creates one order per seller; `settleTransferOrder` (`lib/money/cartTransfers.ts`) sends each seller's net as a Stripe Transfer with `source_transaction` = the cart charge and idempotency key `order-transfer/<orderId>` | Met |
| Refund of one store reverses only that store | `onePageCheckout.integration.test.ts` "refunding one seller's order reverses only that seller's transfer" | Met |
| Discount code per store | Server: `priceCartGroup` already validates `discountCode` per group. App: promo codes were disabled on multi-store orders ("Promo codes apply to single-seller orders") | Gap, fixed below |

## Gap fixed (additive)

Before: with two or more stores in the bag the Promo code section was replaced by
a note and no code could be used, although the API already accepts one code per
group.

Now, only on multi-store orders, the single Promo code section becomes one
"Promo code - {store}" section per store:

- `applyDiscount(code, subtotal, existing, forSellerId)` validates the code
  against that store's own items and subtotal and tags the result with
  `sellerId`.
- `paymentGroups` (`lib/checkoutPayment.ts`) sends each store its own code
  (matching `sellerId`), so a code never crosses stores. Single-store orders are
  unchanged (the one valid code goes to the one group).
- `getCheckoutDisplayTotals` adds up the store-scoped codes; single-store math is
  unchanged.
- The hosted Stripe fallback loop in `buyer-checkout.tsx` passes each group its
  own code, for signed-in buyers and for guests. Guests (BT-255):
  `POST /api/guest/checkout/session` takes `discountCode` (and `liveStreamId`),
  validates it with the same `validateDiscountCode` rules, keyed on
  `guest:<email>` (the key the order webhook records the use under), and
  applies it as a one-time Stripe coupon. Before this, guest sessions ignored
  the code.
- Guests also pay in the app now (BT-257, `POST /api/guest/checkout/payment-intent`),
  where `priceCartGroup` validates each group's code the same way.
- Rejections show the server's reason (first order only, minimum spend, minimum
  items, limit reached, expired, not eligible) under that store's field.

Thread Cash (BT-270): on the in-app payment it now covers every store. The
server splits the amount across stores in proportion to what each can take
(`allocateThreadCash`, `lib/money/cartMath.ts`), keeping every store's card
share at or above 50¢, and splits the buyer's token into one child token per
store (`splitThreadCashRedemption`, `lib/threadCash/wallet.ts`) so the order
webhook spends each store's share on its own. The hosted fallback still takes
one token per Stripe session, so a multi-store order that falls back to hosted
Checkout keeps the one-store rule. Loyalty points stay one store per order on
both paths (their token discounts one checkout).

## Test evidence

- `pnpm --filter @workspace/mobile exec vitest run lib/checkoutPayment.test.ts lib/checkoutReadiness.test.ts`:
  passes, including new cases for per-store codes and per-store totals.
- `pnpm --filter @workspace/api-server exec vitest run src/lib/__tests__/discounts.test.ts`:
  27 cases pass (existing rules plus first order, collection scope, per-customer limit, minimum quantity, minimum spend wording).
- `src/lib/money/__tests__/onePageCheckout.integration.test.ts` (one intent for
  the whole cart, one order per seller, each seller's share transferred once,
  single-seller refund reverses only that transfer) is DB-backed. It was not
  run in the authoring environment because no `DATABASE_URL` / `TEST_DATABASE_URL`
  was reachable; run it in CI or locally with a Postgres URL.
- Screenshots at 393x852 in `docs/pr-assets/discount-codes/`.
