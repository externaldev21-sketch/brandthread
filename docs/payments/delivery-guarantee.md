# Delivery guarantee, order tracking and automatic refunds

Dev's rule, verbatim: *"For a regular order, if it's not pre-order, it should only take 15 days maximum. If that's not delivered in 15 days maximum, instant refund to the buyer. A pre-order, we can do 60 days. If it's not delivered within 60 days, instant refund to the buyer."*

## Rules

| | Regular order | Pre-order |
|---|---|---|
| Must be **delivered** within | 15 days of purchase | 15 days after the seller's promised ship date (`PREORDER_DELIVERY_GRACE_DAYS`), never later than 180 days after purchase (`PREORDER_MAX_DELIVERY_DAYS`); 60 days of purchase when the item has no ship date |
| Stored as | `orders.deliver_by`, `order_items.deliver_by` (stamped when the payment is captured) | same |

* **Purchase** = `orders.paid_at` (Stripe capture). Deadlines are absolute instants (`paid_at + N × 24h`). Only display is time-zone aware.
* **Delivered** = the carrier says delivered (Shippo webhook or the hourly tracking poll) **or** the buyer taps "I received it". A seller can never mark an order delivered (the status and tracking endpoints refuse it).
* A **pre-order** is any item whose product has `is_pre_order = true` or belongs to a pre-order drop. Its ship date is the product's `pre_order_est_ship_date`, else the drop's `estimated_ship_date`. Each item carries its own deadline, so one order with both kinds refunds the regular items at day 15 and the pre-order items 15 days after their ship date. `orders.deliver_by` is the earliest open item deadline.
* So that delivery always fits the 180-day cap, a pre-order ship date (product or drop) may be at most **165 days** away when it is set (`PREORDER_SHIP_DATE_TOO_FAR` / `INVALID_SHIP_DATE`), and a drop's fulfilment deadline at most 165 days away (`INVALID_DEADLINE`).
* **Multi-seller carts** already create one order per seller, so each seller has their own deadline.
* Orders created before migration 110 have `deliver_by = NULL` and keep the old behaviour (no auto-refund, old payout timing).

## Money safety: hold until delivered

`PAYOUT_MODE` (env; default `hold`), `PAYOUT_RELEASE_BUFFER_DAYS` (default `3`), `AUTO_REFUND_ENABLED` (default on).

* **hold** (default): every new order is charged on the platform's balance (Stripe *separate charges and transfers*, `charge_model = 'transfer'`). The seller's transfer is created only when **all items are delivered + the buffer** have passed (`orders.payout_release_at`), nothing is open (no dispute, no open return), and the order isn't refunded. Pre-order drop orders (`held`) also release on delivery + buffer instead of on tracking entry.
* **immediate**: the old behaviour (in-stock orders are destination charges that pay the seller instantly). The auto-refund still runs, but it has to claw the money back from the seller's Stripe balance and **can leave the platform paying out of pocket** if the seller has already withdrawn it. Keep `hold` unless Dev decides otherwise.
* In hold mode an auto-refund refunds money the platform still holds. Stripe keeps its processing fee (and a label may already have been paid from the order), so the order's held money is short of the full refund by that much: the shortfall is a debt the seller owes (`seller_recoverable`), netted from their next order payout (`lib/money/sellerRecovery.ts`, money-flow §2.6). Drop orders take it from the drop's pool instead.

## Auto-refund job (`jobs/deliveryDeadlines.ts`, every 10 minutes)

1. Sync tracking for shipped, undelivered orders (covers missed webhooks and lost tracking).
2. Refund the undelivered items past `deliver_by` that have a **"not delivered" signal** (`autoRefundableItemSql`):
   * **never shipped**: no tracking number, or no carrier scan at all (a label the carrier never scanned, Shippo `PRE_TRANSIT`, is not a shipment);
   * **the carrier says it won't arrive**: latest status `exception` (Shippo `FAILURE`) or `returned_to_sender`;
   * **the buyer says it didn't arrive**: a pending/approved return request with a "not received" reason (the app's refund request screen sends `Order not received` to `POST /api/returns`). The refund closes that request (`refunded`).

   A parcel the carrier scanned in transit with no delivered scan (unknown carrier, local delivery, guest buyer) is **not** refunded by default, because the goods have often arrived. It waits for the buyer's claim; its payout stays held.
   For each refunded order:
   * skipped while a dispute is open (`dispute_paused_at`), a refund is already in flight, or the order is cancelled/delivered;
   * amount = the undelivered items' share (`undeliveredRefundCents`); when nothing was delivered it's the full remainder;
   * goes through `refundOrder` with the idempotency key `auto-refund/<orderId>/<hash of item ids>`, which maps to the Stripe idempotency key `order-refund/<refundId>/<attempt>`, so a re-run or two servers can never refund twice;
   * order → `cancelled` with reason `not_delivered_in_time` (fully refunded) or items marked `refunded_at` (partial);
   * buyer: "You've been refunded $X", seller: "Order #… was refunded, not delivered in time", via Activity + push.
3. Refund failure: `auto_refund_attempts++`, exponential back-off (`auto_refund_next_attempt_at`: 10m, 30m, 2h, 6h, then every 6h), `logger.error` on every failure (which reports to Sentry). From the 3rd failed attempt the message is tagged `alert: "auto_refund_stuck"` so it pages.
4. Seller warnings at 5 days, 2 days and 12 hours before `deliver_by` while an item still has no tracking: "Ship and add tracking or this order will be auto-refunded."

## API contract

### Buyer — `GET /api/buyer/orders` and `GET /api/buyer/orders/:id`

Both add `delivery` to every order (the list version has `events: []`; the scan history loads with the detail). Items (detail) add `deliveredAt`, `refundedAt`, `trackingNumber`.

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

## Architecture

```
checkout paid (webhook) ──► stampDeliveryDeadlines        orders.deliver_by, order_items.deliver_by
                            recordOrderPaid (transfer)    funds_state = held, nothing paid to the seller
seller adds tracking ─────► order + item tracking_number; Shippo registerTrack (webhook push)
Shippo webhook / hourly poll ─► applyCarrierTracking ─► order_tracking_events, statuses, ETA,
                                                        buyer pushes (out for delivery, exception)
                              └─ DELIVERED ─► recordDelivery ─► order delivered, payout_release_at = +buffer
buyer "I received it" ────► recordDelivery (source = buyer)
every 10 min (jobs/deliveryDeadlines.ts):
   pollShippedOrders ─► runAutoRefundSweep ─► runDeadlineWarnings
every 5 min (jobs/moneySweep.ts):
   sweepTransferOrders / sweepOrderReleases  (only orders past payout_release_at, no dispute, no open return)
```

* `lib/delivery/policy.ts` pure rules and config; `deliveryState.ts` DB transitions; `autoRefund.ts` refund + warning sweeps; `trackingSync.ts` Shippo mapping/poll; `payoutGate.ts` the hold rule (TS + SQL twin); `disputePause.ts`; `notifications.ts`; `buyerView.ts` the buyer `delivery` object.
* Carrier tracking uses the **existing Shippo integration** (`lib/shippo.ts`, API key held by the connector proxy, never the client). Register Shippo's `track_updated` webhook at `POST /api/webhooks/shippo` (set `SHIPPO_WEBHOOK_SECRET` and pass it as `?secret=`); the hourly poll covers a missed webhook and carriers Shippo can't map (then only the buyer's confirmation or the deadline refund applies).
* The refund goes through `refundOrder` (the same path as buyer/seller cancellations and failed drops): order-row lock, `order_refunds` row in `processing`, Stripe idempotency key `order-refund/<refundId>/<attempt>`, ledger posted exactly once, Thread Cash returned, loyalty points reversed.

## Edge cases

| Case | Behaviour |
|---|---|
| Cancelled / already refunded | Skipped by the sweep (status `cancelled`/`delivered`, `funds_state = refunded`). |
| Buyer or seller cancels mid-flight (`refund_pending`) | Left alone, unless it is the auto-refund's own unconfirmed refund, which the sweep retries with the same key. |
| Return | A return is for delivered goods, so it never touches the auto-refund; an **open** return (`pending`/`approved`) blocks the seller payout until it resolves. |
| Dispute | `charge.dispute.created/updated` sets `orders.dispute_paused_at`; the sweep skips the order and the payout is withheld. `won` / `warning_closed` lifts it; `lost` keeps it (the bank already returned the money). |
| Lost tracking | Nothing is marked delivered, so the deadline refund fires on schedule; before refunding, the carrier is polled one last time. |
| Carrier exception / returned to sender | Buyer is notified; the deadline still applies. |
| Refund to original payment method | Stripe refunds the PaymentIntent, i.e. back to the buyer's card. Thread Cash spent on the order is returned to their Thread Cash wallet. |
| Multi-seller carts | One order per seller (already the case), each with its own `deliver_by`, refund and payout. |
| Mixed regular + pre-order in one order | Per-item deadlines: the regular items are refunded at day 15, the pre-order items 15 days after their ship date, sum = exactly what was charged. |
| Pre-order drops (`held` model) | Orders released on delivery + buffer instead of on tracking entry. A drop's production deadline no longer refunds an order that is already shipped; that order's own pre-order guarantee (ship date + 15 days) applies. |
| Shipping labels | In hold mode a label is paid from the order's held money (`label_paid_from_held`), so the platform never fronts it and the transfer is net of it. |
| Time zones | Deadlines are absolute instants (`paid_at + N×24h`), immune to DST and server zone. The app shows the date in the viewer's local zone; pushes use the recipient's `quiet_hours_timezone` (UTC if unset). |
| Seller declares "delivered" | Refused (`DELIVERY_NOT_SELLER_CONFIRMED`). |
| Seller ships after the auto-refund | Refused (`AUTO_REFUNDED`). |

## Operating it

* Kill switches: `AUTO_REFUND_ENABLED=false` stops the refund sweep; `PAYOUT_MODE=immediate` restores instant seller payouts for **new** orders.
* Stuck refunds: look for the error log `ALERT: automatic non-delivery refund keeps failing` (`alert: "auto_refund_stuck"`, reported to Sentry) or `orders.auto_refund_attempts >= 3`; `auto_refund_last_error` has the reason. The sweep keeps retrying every 6 hours with the same idempotency key, so a human fix (e.g. reconnecting Stripe) is enough.
* Money safety check: with `PAYOUT_MODE=hold`, `SELECT id FROM orders WHERE deliver_by IS NOT NULL AND delivered_at IS NULL AND stripe_transfer_id IS NOT NULL` must always be empty.
* Orders created before migration 110 have `deliver_by IS NULL` and are untouched.
* Needs Dev's confirmation: HOLD delays every seller's payout until delivery + 3 days (up to ~18 days for a regular order, more for a pre-order), and the platform's Stripe balance must cover those held amounts. The default can be flipped with `PAYOUT_MODE` and the buffer tuned with `PAYOUT_RELEASE_BUFFER_DAYS`. Confirm with Stripe how long a platform may keep a charge's funds before transferring them (see the same caveat in money-flow.md §8).
