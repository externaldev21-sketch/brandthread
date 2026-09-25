# Shopify fulfillment bridge (and why it's a Shopify bridge, not a direct Tapstitch integration)

## Why this exists

Sellers want to run Tapstitch (print-on-demand/dropshipping) fully through
Brandthread: an order comes in, Tapstitch charges the seller, makes it, and
ships it. **Tapstitch has no public developer API.** It only integrates with
storefront platforms it plugs into directly: Shopify (an installed app),
WooCommerce (it calls the store's own WooCommerce REST API using keys the
merchant creates), Etsy, Wix, and TikTok Shop. It watches for **paid** orders
and picks them up within ~5 minutes.

Since a direct Tapstitch↔Brandthread integration isn't possible today, the
real, working path is: **Brandthread creates a paid order in the seller's
Shopify store**, and Tapstitch's own Shopify app (which the seller already
has installed) picks it up exactly as it would any other Shopify order. This
also means the same bridge works for Printful, Printify, or any other
fulfillment app a seller runs on Shopify — not just Tapstitch.

## What this ships

Two independent, separately-scoped capabilities that share one Shopify
connection per seller:

- **(A) Product transfer** — Products page → "Import from Shopify". Read-only
  (`read_products`, `read_inventory`). Imports titles, descriptions, images,
  variants, prices, compare-at prices, SKUs, and stock. Re-importing a
  product updates it in place instead of duplicating it (matched via
  `shopify_product_links`). Never touches orders.
- **(B) Fulfillment via Shopify** — Seller Settings → "Fulfillment
  connections" → "Fulfill orders through my Shopify store". Opt-in. Upgrades
  the connection with `read_orders`, `write_orders`, `read_fulfillments` (in
  addition to the read scopes from (A) if the seller already connected for
  product transfer — Shopify merges scopes for the same app, so the seller is
  only re-prompted for what's new). Once enabled:
  1. A paid Brandthread order containing a linked product is created as a
     **paid** order in the seller's Shopify store (line items = the linked
     Shopify variants, `financial_status: "paid"`, a `Brandthread order #…`
     note/tag, the buyer's shipping address). One Shopify order per
     Brandthread order, idempotent on retries (`shopify_order_links`).
  2. The seller's fulfillment app (Tapstitch, Printful, Printify, …) sees the
     paid order in Shopify and fulfills it as usual.
  3. When that app adds tracking in Shopify, our `fulfillments/create`
     webhook (HMAC-verified) writes the carrier + tracking number onto the
     Brandthread order and triggers the **existing** payout-release-on-
     tracking path (`requestOrderRelease`/`executeOrderRelease` in
     `lib/money/escrow.ts`) — the exact same call a staff member entering
     tracking by hand would make. No escrow/fee logic was changed.
  4. A Shopify-side cancellation is surfaced as a note + notification on the
     Brandthread order for a human to review — it is never auto-refunded, so
     an order can't be double-refunded.
  5. Uninstalling the Brandthread app in Shopify (`app/uninstalled` webhook)
     marks the connection disconnected.

A generic `FulfillmentPartnerAdapter` interface exists in
`artifacts/api-server/src/lib/fulfillmentPartners/` for a future direct
Tapstitch integration, gated behind `FULFILLMENT_PARTNER_ADAPTERS_ENABLED`
(default `false`). It is not wired into anything — it only gives a direct
integration a home if Tapstitch ever grants API access.

## What the owner needs to do (Claude can't do this — no accounts were created)

### 1. Create a free Shopify Partner account + the Brandthread app

1. Sign up at Shopify's Partner Dashboard (partners.shopify.com) — free.
2. Create a new app → "Custom app" or "Public app" (public app if this will
   be distributed to sellers generally; a custom app is enough to test
   against your own store first).
3. App setup → configure:
   - **App URL**: your API server's public base URL (e.g.
     `https://api.yourbrandthreaddomain.com`).
   - **Allowed redirection URL(s)**: exactly
     `https://<your-api-domain>/api/shopify/oauth/callback`
     (must match `SHOPIFY_APP_REDIRECT_URI` byte-for-byte).
   - **Scopes**: don't restrict scopes in the Partner Dashboard beyond what's
     needed — the app requests `read_products,read_inventory` for product
     transfer, and additionally `read_orders,write_orders,read_fulfillments`
     when a seller turns on fulfillment. Shopify shows the merchant exactly
     what's being requested at authorize time.
   - **Webhooks** (or configure via the Admin API — this repo doesn't
     auto-register them yet): subscribe `app/uninstalled`,
     `fulfillments/create`, `fulfillments/update`, `orders/cancelled`, each
     pointed at `https://<your-api-domain>/api/webhooks/shopify`.
4. Copy the app's **API key** and **API secret key** into
   `SHOPIFY_APP_API_KEY` / `SHOPIFY_APP_API_SECRET`.
5. Generate a 32-byte base64 key for `SHOPIFY_TOKEN_ENCRYPTION_KEY`, e.g.:
   ```
   openssl rand -base64 32
   ```
6. Set `SHOPIFY_APP_REDIRECT_URI` to the exact URL from step 3.

### 2. Test against your own store first (no public app review needed)

Before the public app is approved, use the **custom-app fallback**: in your
own Shopify admin → Settings → Apps and sales channels → Develop apps →
create a custom app → configure Admin API scopes (`read_products`,
`read_inventory`, and if testing fulfillment also `read_orders`,
`write_orders`, `read_fulfillments`) → install it → copy the generated Admin
API access token. In Brandthread, call
`POST /api/shopify/connect/custom-app` with `{ shopDomain, accessToken,
purpose }` (the fulfillment-connections screen doesn't have a UI for this
yet — it's for the owner's own verification/testing before the OAuth app is
live).

### 3. Reach out to Tapstitch about direct API/partner access

Tapstitch has no public API today, but it's worth asking whether they have
an unlisted partner program. Draft email:

> **To:** support@tapstitch.com
> **Subject:** API / partner access for Brandthread marketplace integration
>
> Hi Tapstitch team,
>
> We run Brandthread, a marketplace platform for independent fashion brands.
> A number of our sellers already use Tapstitch for print-on-demand
> fulfillment through Shopify, and we've built a bridge so orders placed on
> Brandthread flow into their Shopify store as paid orders — which your
> Shopify app then picks up and fulfills exactly as it does today.
>
> We'd like to ask whether Tapstitch offers (or would consider) a direct
> API or partner integration so orders could flow to Tapstitch without a
> Shopify store in the middle for sellers who'd prefer that. Is this
> something your team supports, or could support for a marketplace partner?
> Happy to share more about our platform and order volume if useful.
>
> Thanks,
> [Owner name]
> Brandthread

## Environment variables

See `.env.example` → "Shopify fulfillment bridge" section:
`SHOPIFY_APP_API_KEY`, `SHOPIFY_APP_API_SECRET`, `SHOPIFY_APP_REDIRECT_URI`,
`SHOPIFY_TOKEN_ENCRYPTION_KEY`, `FULFILLMENT_PARTNER_ADAPTERS_ENABLED`.

## Shared screens touched (minimal edits — flag for other sessions)

- `artifacts/mobile/app/(tabs)/products.tsx` — added one action-sheet item,
  "Import from Shopify", next to the existing CSV import.
- `artifacts/mobile/services/settingsCatalog.ts` — added one seller-settings
  entry, "Fulfillment connections".
- `artifacts/mobile/app/order-detail.tsx` — added one conditional card
  (rendered only when `order.shopifyFulfillment` is present) showing
  Sent-to-Shopify / fulfilled-by-partner / tracking status.
- `artifacts/mobile/services/orderTypes.ts` — added one optional
  `shopifyFulfillment` field to the `Order` type.
- `artifacts/api-server/src/routes/orders.ts` — `GET /api/orders/:id` now
  also returns `shopifyFulfillment` (additive field, existing response shape
  unchanged).
- `artifacts/api-server/src/routes/webhooks.ts` — `handleCheckoutPaid` now
  fires a fire-and-forget call to forward the order to Shopify if linked;
  wrapped in `setImmediate`/`catch` so it can't block or fail the paid-order
  path itself.
- `artifacts/api-server/src/app.ts` — added a raw-body parser for
  `/api/webhooks/shopify` (and `/api/v1/...`), mirroring the existing Stripe
  webhook wiring.
- `artifacts/api-server/src/routes/index.ts` — mounted the new routers.
