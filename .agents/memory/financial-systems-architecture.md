---
name: Financial Systems Architecture
description: Disputes/chargebacks, taxes, finance/payouts, store builder, team — backend routes, DB tables, mobile screen wiring.
---

## Migrations applied
- 018: storefronts, storefront_versions, storefront_custom_domains
- 019: team_members, team_activity_logs
- 020: disputes, seller_tax_config

## New Drizzle schema tables (lib/db/src/schema/index.ts)
All 7 tables added: storefronts, storefrontVersions, storefrontCustomDomains, teamMembers, teamActivityLogs, disputes, sellerTaxConfig.

**Why:** esbuild resolves @workspace/db to lib/db/src/index.ts which does `export * from "./schema"` — new tables must be added to schema/index.ts AND `tsc --build` must run in lib/db before api-server builds will see them.

## API routes (api-server/src/routes/)
- `store.ts` — storefront CRUD, publish/unpublish, versions, custom domains. Mounted at `/api/store`.
- `store-ai.ts` — GPT-4 AI generation (generate/from-logo/from-moodboard/from-social). Mounted at `/api/store/ai`.
- `team.ts` — member CRUD, invite token flow, role definitions with staffCounts, activity log. Mounted at `/api/team`.
- `disputes.ts` — list/get disputes (Stripe-synced), submit evidence, final submit, accept. Mounted at `/api/disputes`.
- `finance.ts` — Stripe Connect balance, payouts, transactions, CSV statement. Mounted at `/api/finance`.
- `taxes.ts` — Stripe Tax enable/config, 1099-K. Mounted at `/api/taxes`.

### Key: stripe.balance.retrieve() fix
`stripe.balance.retrieve({}, { stripeAccount: accountId })` — stripeAccount goes in the 2nd arg (request options), NOT inside the params object.

## Dispute webhook handlers (webhooks.ts)
Added: charge.dispute.created → handleDisputeCreated, charge.dispute.updated → handleDisputeUpdated, charge.dispute.closed → handleDisputeClosed.
Resolves seller from `stripe_payment_intent_id` via orders table.

## Mobile screens wired
- `dispute-detail.tsx` — loads from api.disputes.get(disputeId), falls back to orderService for demo data. Evidence via api.disputes.submitEvidence().
- `payouts.tsx` — api.finance.balance() + api.finance.payouts(20); empty state for unconnected sellers.
- `finance.tsx` — api.finance.transactions(20) + api.finance.balance(); "Download Statement" opens /api/finance/statement.csv via Linking.
- `payments.tsx` — api.drops.list() maps to Drop shape; DROPS_FALLBACK used when API has no drops.
- `taxes-duties.tsx` — api.taxes.status() on mount; "Set up" calls api.taxes.enable(); toggles call api.taxes.config().
- `team.tsx` — api.team.members() + api.team.activity(); inline invite form with token flow.
- `roles.tsx` — api.team.roles() returns 3 fixed tiers (Owner/Manager/Staff) with real staffCounts.
- `users.tsx` — api.team.members() with Active/Invited status pills.

## api.ts groups added
team, store, disputes, finance, taxes — all under createApi().
