---
name: Manufacturer Hub Architecture
description: Complete architecture for the Brandthread Manufacturer Hub — types, service, screens, routes, and integration points.
---

## Foundation files
- `services/manufacturerTypes.ts` — all typed models (Manufacturer, ManufacturerRelationship, QuoteRequest, Quote, Counteroffer, Sample, SampleRevision, SampleReview, ProductionOrder, ProductionStage, QualityControlCheck, ProductionIssue, ProductionUpdate, ManufacturerPaymentRecord, ManufacturerConversation, ManufacturerMessage, ManufacturerFile, ManufacturerPriceCard, ManufacturerInvitation, plus constants PRODUCTION_STAGES, QC_CATEGORIES, ISSUE_TYPES)
- `services/manufacturerService.ts` — full async CRUD + AsyncStorage persistence + 5 DEMO_MANUFACTURERS. Keys prefixed `mfg:`. getHubStats() for seller home integration.

## saveQuoteRequestDraft pattern (critical)
Object literal must NOT have explicit named properties followed by `...data` spread that contains the same keys — TypeScript TS1117/TS2783.
Correct pattern: defaults first, then `...data`, then override with required fields:
```ts
const qr: QuoteRequest = {
  status: 'draft', quantity: 100, ...defaults,
  ...data,           // overrides defaults
  id: resolvedId,    // always override after spread
  sellerId: 'seller_001',
  manufacturerId: data.manufacturerId,  // always after spread
  productName: data.productName,
};
```

## Routes registered in _layout.tsx
All new screens use `animation: 'slide_from_right'` except `invite-manufacturer` which uses `slide_from_bottom` + `presentation: 'modal'`:
- manufacturer-hub, manufacturer-profile, quote-request, quote-detail, quote-compare, sample-detail, production-detail, manufacturer-messages, invite-manufacturer

## Screens
- `app/manufacturer-hub.tsx` — 6-tab hub: discover | my_manufacturers | quotes | samples | production | messages. Uses useFocusEffect to reload on tab focus.
- `app/manufacturer-profile.tsx` — full profile, save toggle, quick actions (Save/Message/Quote/Invite)
- `app/quote-request.tsx` — 5-step flow with draft auto-save every 2s. Steps: product, production details, materials/variants, files (demo stubs), review+submit. submitQuoteRequest auto-generates demo quote after 1.5s.
- `app/quote-detail.tsx` — quote detail, accept/decline/counteroffer, counteroffer history
- `app/quote-compare.tsx` — side-by-side quote comparison, best value highlighted green
- `app/sample-detail.tsx` — sample status timeline, review form (star ratings per dimension), revision request form
- `app/production-detail.tsx` — 9 sections: stage progress, cost/payments, 13-stage list, updates feed, QC pass/fail/review, issues, shipping/delivery
- `app/manufacturer-messages.tsx` — message thread (inverted FlatList), seller=right PURPLE, mfg=left CARD, internal notes=ORANGE_DIM, attachment cards
- `app/invite-manufacturer.tsx` — single-form invite with demo notice, generates inviteLink, no real email

## No-local-const rule (Metro Babel crash)
Any `const` at module scope that duplicates a theme import name causes "Duplicate declaration" runtime crash.
Never add local `const CARD_ELEVATED`, `SUCCESS_DIM`, `RED_DIM`, `ORANGE_DIM`, `BORDER_ACTIVE`, `RED`, etc. in StyleSheet sections. Always import from `@/lib/theme`.

## null safety in handlers
State variables typed as `T | null` are NOT narrowed inside handler functions even if the JSX early-returns. Always add `if (!order) return;` (or equivalent) at the top of every async handler that uses a nullable state variable.

## Integration points
- `more.tsx` OPERATIONS → "Manufacturer Hub" → `/manufacturer-hub`
- `index.tsx` → imports getHubStats, shows active production/samples/messages counts in Seller Home
- `add-product.tsx` step 8 → links to hub (pre-existing, no changes needed)
- `product-detail.tsx` production tab → links to hub (pre-existing, no changes needed)

## Demo behavior
- 5 demo manufacturers always loaded (not persisted — they're hardcoded)
- Relationships, quotes, samples, production orders persisted in AsyncStorage
- Submitting a quote request auto-generates a demo quote response after 1.5s (setTimeout in submitQuoteRequest)
- No real email/payment/file upload — all stubbed with Alert + demo notices
