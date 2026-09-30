# Delivery guarantee, order tracking and automatic refunds

Dev's rule, verbatim: *"For a regular order, if it's not pre-order, it should only take 15 days maximum. If that's not delivered in 15 days maximum, instant refund to the buyer. A pre-order, we can do 60 days. If it's not delivered within 60 days, instant refund to the buyer."*

## Rules

| | Regular order | Pre-order |
|---|---|---|
| Must be **delivered** within | 15 days of purchase | 60 days of purchase |
| Stored as | `orders.deliver_by`, `order_items.deliver_by` (stamped when the payment is captured) | same |

* **Purchase** = `orders.paid_at` (Stripe capture). Deadlines are absolute instants (`paid_at + N × 24h`). Only display is time-zone aware.
* **Delivered** = the carrier says delivered (Shippo webhook or the hourly tracking poll) **or** the buyer taps "I received it". A seller can never mark an order delivered (the status and tracking endpoints refuse it).
* A **pre-order** is any item whose product has `is_pre_order = true` or belongs to a pre-order drop. Each item carries its own deadline, so one order with both kinds refunds the regular items at day 15 and the pre-order items at day 60. `orders.deliver_by` is the earliest open item deadline.
* **Multi-seller carts** already create one order per seller, so each seller has their own deadline.
* Orders created before migration 110 have `deliver_by = NULL` and keep the old behaviour (no auto-refund, old payout timing).

## Money safety: hold until delivered

`PAYOUT_MODE` (env; default `hold`), `PAYOUT_RELEASE_BUFFER_DAYS` (default `3`), `AUTO_REFUND_ENABLED` (default on).

* **hold** (default): every new order is charged on the platform's balance (Stripe *separate charges and transfers*, `charge_model = 'transfer'`). The seller's transfer is created only when **all items are delivered + the buffer** have passed (`orders.payout_release_at`), nothing is open (no dispute, no open return), and the order isn't refunded. Pre-order drop orders (`held`) also release on delivery + buffer instead of on tracking entry.
* **immediate**: the old behaviour (in-stock orders are destination charges that pay the seller instantly). The auto-refund still runs, but it has to claw the money back from the seller's Stripe balance and **can leave the platform paying out of pocket** if the seller has already withdrawn it. Keep `hold` unless Dev decides otherwise.
* In hold mode an auto-refund refunds money the platform still holds, so it never costs the platform anything. The platform keeps Stripe's non-refundable processing fee; that cost is charged to the seller's held funds like every other refund (see `lib/money/refunds.ts`).

## Auto-refund job (`jobs/deliveryDeadlines.ts`, every 10 minutes)

1. Sync tracking for shipped, undelivered orders (covers missed webhooks and lost tracking).
2. Refund every order with undelivered items past `deliver_by`:
   * skipped while a dispute is open (`dispute_paused_at`), a refund is already in flight, or the order is cancelled/delivered;
   * amount = the undelivered items' share (`undeliveredRefundCents`); when nothing was delivered it's the full remainder;
   * goes through `refundOrder` with the idempotency key `auto-refund/<orderId>/<hash of item ids>`, which maps to the Stripe idempotency key `order-refund/<refundId>/<attempt>`, so a re-run or two servers can never refund twice;
   * order → `cancelled` with reason `not_delivered_in_time` (fully refunded) or items marked `refunded_at` (partial);
   * buyer: "You've been refunded $X", seller: "Order #… was refunded, not delivered in time", via Activity + push.
3. Refund failure: `auto_refund_attempts++`, exponential back-off (`auto_refund_next_attempt_at`: 10m, 30m, 2h, 6h, then every 6h), `logger.error` on every failure (which reports to Sentry). From the 3rd failed attempt the message is tagged `alert: "auto_refund_stuck"` so it pages.
4. Seller warnings at 5 days, 2 days and 12 hours before `deliver_by` while an item still has no tracking: "Ship and add tracking or this order will be auto-refunded."

## API contract

### Buyer — `GET /api/buyer/orders` and `GET /api/buyer/orders/:id`

Both add `delivery` to every order. Items (detail) add `deliveredAt`, `refundedAt`, `trackingNumber`.

```ts
delivery: {
  deliverBy: string | null;            // ISO instant. Show "Guaranteed delivery by <date> or automatic refund"
  isPreorder: boolean;
  promisedShipDate: string | null;     // ISO, pre-orders only ("Seller ships by …")
  estimatedDelivery: string | null;    // YYYY-MM-DD carrier/seller estimate
  deliveredAt: string | null;
  deliveryConfirmedBy: "carrier" | "buyer" | null;
  steps: Array<{ key: "ordered"|"preparing"|"shipped"|"out_for_delivery"|"delivered";
                 label: string; state: "done"|"current"|"upcoming"; at: string | null }>;
  events: Array<{ status: string; description: string; location: string | null; at: string }>; // newest first
  carrier: string | null; trackingNumber: string | null; trackingUrl: string | null;
  canConfirmReceipt: boolean;          // shipped, not delivered, not refunded
  disputePaused: boolean;
  autoRefund: null | { refundedCents: number; refundedAt: string; partial: boolean;
                       label: "Refunded, not delivered in time" };
  shipments: Array<{ trackingNumber: string; carrier: string | null; trackingStatus: string | null;
                     deliveredAt: string | null; itemIds: string[] }>; // only when items ship separately
}
```

`POST /api/buyer/orders/:id/confirm-receipt` → `200 { delivery }` (idempotent). `409 { code: "NOT_SHIPPED" | "ALREADY_REFUNDED" }`.

### Seller — `GET /api/orders`, `GET /api/orders/:id`

Flat fields on each order: `deliverBy`, `isPreorder`, `promisedShipDate`, `deliveredAt`, `autoRefundedAt`, `disputePausedAt` (all ISO or `null`). Detail items add `deliverBy`, `deliveredAt`, `trackingNumber`, `carrier`, `refundedAt`. Show the countdown from `deliverBy`; once `autoRefundedAt` is set the order is read-only.

* `PATCH /api/orders/:id/items-tracking` `{ itemIds: string[], trackingNumber, carrier? }` ships part of an order.
* Status/tracking writes on an auto-refunded order → `409 { code: "AUTO_REFUNDED" }`.
* `PATCH /api/orders/:id/status` with `delivered`, or `/tracking` with `trackingStatus: "delivered"` → `409 { code: "DELIVERY_NOT_SELLER_CONFIRMED" }`.

### Listing a pre-order

`POST/PATCH /api/products` with `isPreOrder: true` requires a future `preOrderEstShipDate` → `400 { code: "PREORDER_SHIP_DATE_REQUIRED" }`.
