# Manufacturer Hub ↔ Manufacturer Portal API contract

Owner: the session working `artifacts/mobile` (brand/seller side: `manufacturer-hub.tsx`,
`manufacturer.tsx`, `manufacturer-profile.tsx`, `manufacturer-product.tsx`,
`manufacturer-messages.tsx`, `manufacturer-compare.tsx`, RFQ screens) and the
shared `artifacts/api-server` seller-hub + manufacturer routes.

This is the single source of truth for the REST surface and TypeScript shapes
the two sides (this mobile app and `artifacts/manufacturer-portal`) share.
**Treat this file as append-only for existing entries** — a field or route
already listed here is stable; changing its meaning or removing it is a
breaking change that must be called out explicitly in a PR to both sides, not
made silently. New phases add new sections rather than rewriting old ones.

Backing store: real Postgres tables via `@workspace/db` (Drizzle), not mocks —
`manufacturers`, `manufacturerReviews`, `savedManufacturers`,
`manufacturerRelationships`, `manufacturerThreads`, `sampleOrders`,
`manufacturerProducts`, `manufacturerProductPriceTiers`.

---

## Phase 1 (this PR): directory, favorites, relationships

### `GET /api/manufacturers/public`
Public directory search. Auth: `requireAuth` (seller-signed-in). Query params:
`q, country, category, moqMax, unitPriceMaxCents, leadTimeDaysMax, verifiedOnly,
ratingMin, minYears, hasPhotos, sort` (`recommended|experience|rating|moq|newest`).
Returns `Manufacturer[]` (shape below). Backed by `manufacturers` table,
`isPublicDirectory=true, status='active'` only, joined with review summaries.

### `GET /api/manufacturers/public/facets`
Country + specialty counts across the same live (public+active) rows, plus
`total`. Auth: `requireAuth`. Returns `DirectoryFacets`:
```ts
type DirectoryFacets = {
  total: number;
  countries: Array<{ name: string; count: number }>;
  specialties: Array<{ name: string; count: number }>;
};
```

### `GET /api/manufacturers/public/:id`
Single manufacturer detail (public directory). Falls back to
`GET /api/manufacturers/partners/:manufacturerId` for a private/invited
manufacturer a seller already works with (not in the public directory).

### `GET|POST /api/manufacturers/favorites`, `DELETE /api/manufacturers/favorites/:manufacturerId`
Favorites are per-seller, stored in `savedManufacturers`. `POST` validates the
target is `active`+`isPublicDirectory` before inserting (upsert, no duplicate
error). Favorites are a **non-blocking overlay** on the directory — a seller
with a broken favorites list still sees the full directory (see "known-fixed
bug" below).

### `GET /api/manufacturers/relationships`
A seller's manufacturer relationships (saved/invited/connected/active/paused/
archived), joined with live order-count and unread-message summaries.

### `Manufacturer` (mobile: `services/manufacturerTypes.ts`)
```ts
interface Manufacturer {
  id: string; name: string; country: string; city: string; description: string;
  profileImageUri?: string; galleryUris: string[];
  yearsInBusiness: number; teamSize: string; productionCapacity: string;
  specialties: string[]; categories: string[];
  capabilities: ManufacturerCapability[];     // { id, category, materials[], printMethods? }
  certifications: ManufacturerCertification[]; // { id, name, issuer?, validUntil? } — see note below
  materials: string[];
  moq: number;
  samplePriceMinCents: number; samplePriceMaxCents: number;
  unitPriceMinCents: number; unitPriceMaxCents: number;
  leadTimeDays: number; responseTimeHours: number;
  rating: number; reviewCount: number; reviews: ManufacturerReview[];
  isVerified: boolean; shippingRegions: string[];
  website?: string; email?: string; phone?: string; timeZone?: string | null;
  isPublicDirectory?: boolean;
  priceRangeLabel?: string; sampleTurnaround?: string; bulkTurnaround?: string;
  createdAt: string;
}
```

### ⚠️ Known gap, not yet wired server-side
`certifications` exists on the TS type but **`GET /api/manufacturers/public`
does not populate it today** (no join to a certifications table on the list
route). Don't build UI that assumes it's populated from the directory list
until this is closed out — it's tracked for a later phase, not silently
dropped.

### Not yet in the data model (do not fabricate a filter/badge for these)
The Alibaba-parity concepts below have **no backing column or aggregate
today** — only `isVerified` (boolean) and `responseTimeHours` (a single
number, not a rate) exist server-side:
- Trade-assurance / escrow-ready flag (per-manufacturer opt-in concept —
  note that *all* orders on this platform are already escrow-held via Stripe
  per the Phase 5 orders flow, so this is a platform-wide guarantee, not a
  differentiating filter, until/unless product wants a stricter per-manufacturer tier)
- Response rate % (as opposed to response *time*)
- On-time delivery %
- Reorder rate
- Certifications as a *searchable/filterable* facet (see gap above)

A future phase will add real columns/aggregates for these before any UI
claims to filter or badge on them — no fake toggles have been shipped in
Phase 1's filter sheet.

### Fixed this PR: the favorites-wipes-directory bug
`app/manufacturer-hub.tsx`'s Discover tab used to `Promise.all([searchManufacturers(...),
getFavoriteManufacturerIds()])` — a favorites-only failure threw the whole
`Promise.all` and blanked the directory for a signed-in seller. Now
`Promise.allSettled`: the directory renders as long as *it* succeeds;
favorites failing just means every card shows unfavourited.

### Fixed this PR: preview-mode 401s
The web dev preview (`?bt_preview=seller`) never signs in via Clerk, so every
`requireAuth`'d call above 401'd on every Manufacturer Hub tab, surfacing as a
broken "Directory unavailable" state (and, per the global 401 suppression in
`lib/networkNotice.ts`, no toast — any red "API 401" banner seen was not this
app's own notice system). Every screen in this area now checks
`isSellerDevPreview()` (`lib/devPreview.ts`) before calling a protected
endpoint: `isPreviewFreshMode()` shows a real empty state, `isPreviewDemoMode()`
(`&demo=1`) shows `lib/previewManufacturers.ts`'s seeded directory. A real
signed-in seller never takes this branch.

---

## Phase 2 (planned): product detail + manufacturer profile
Will define: tiered pricing (`manufacturerProductPriceTiers`, already a real
table — not yet exposed via a seller-facing product-detail endpoint),
variation/customization options + their own MOQs, sample-price/request flow,
lead-time-by-quantity table, and the manufacturer profile's Company tab
(factory photos/video, capacity, certifications — closing the gap above).

## Phase 3 (planned): RFQ + quotes + compare
`Rfq`/`Quote`/`Counteroffer` types already exist in full in
`manufacturerTypes.ts` and are live via `services/manufacturerRfq.ts` +
`/api/seller-hub/rfqs`. This phase covers the manufacturer-portal side of
receiving and answering an RFQ, and a Products-vs-Manufacturers search-results
toggle (needs a new directory-wide product search endpoint — not built yet;
deferred here rather than shipping a toggle with a dead second tab).

## Phase 4 (planned): messenger cards
`ManufacturerMessage`/`ManufacturerConversation` types already model
`attachmentType`/`attachmentId`/`attachmentLabel` for rich cards. This phase
defines the exact card payload shapes (product/quote/sample-order/bulk-order/
payment-request/production-milestone/shipping) both sides render identically.

## Phase 5a (this PR): production-milestone photo updates
The manufacturer can post progress photos against the order's **current**
stage without changing its status — a same-stage event (`fromStatus ===
toStatus`) on the same `manufacturer_order_events` ledger the tracker
timeline already reads. Additive: the ledger's new `image_urls` column
defaults to `[]`, so every existing event/reader is unchanged, and the
timeline's `events[]` gained an `imageUrls: string[]` field (omitted/empty
for every event shipped before this PR).

### `POST /api/manufacturers/orders/:orderId/updates/photo`
Manufacturer-only (403 for the seller side of the order; 404 for
non-participants). Raw image bytes as the body, like
`sample-orders.ts`'s own `images/upload` route: `Content-Type` one of
`image/jpeg`, `image/jpg`, `image/png`, `image/webp`, `image/heic`,
`image/heif`; ≤ 20 MB; magic-byte-validated. Stores the image in object
storage and returns its **stable object path** plus a short-lived viewing
URL — the object path (not the URL, which expires) is what you pass to the
next call:
```json
{ "objectPath": "…", "url": "https://…" }
```

### `POST /api/manufacturers/orders/:orderId/updates`
Manufacturer-only. Body:
```json
{ "note": "Cutting complete, moving to sewing.", "imageObjectPaths": ["…", "…"] }
```
`note` and `imageObjectPaths` are both optional but at least one is
required (422 otherwise; up to 12 photos per update). Records a same-stage
event, posts a system message into the seller↔manufacturer thread, and
notifies the seller. Returns the created event with resolved (signed)
`imageUrls`:
```json
{ "id": "…", "actorRole": "manufacturer", "fromStatus": "cut_and_sew", "toStatus": "cut_and_sew", "note": "…", "imageUrls": ["https://…"], "createdAt": "…" }
```

The manufacturer-portal renders its own upload UI against these two calls;
the mobile app (seller side) only reads `timeline.events[].imageUrls` and
shows them as thumbnails under a same-stage event — no seller-side upload
affordance is added, since only the manufacturer posts production photos.

## Phase 5b (planned): escrow/payout release
`ProductionOrder`/`ProductionStage`/`ManufacturerPaymentRecord` types already
exist, along with `sampleOrders.payoutReleased`/`stripeTransferId` columns
and general escrow machinery (`lib/money/escrow.ts`, `orderFundsMachine`)
built for consumer drop preorders but not yet wired to manufacturer sample/
bulk orders. This phase defines the Stripe Connect payout-release contract:
holding funds until the seller approves each milestone, and the transfer
call the manufacturer's payout is actually released through.
