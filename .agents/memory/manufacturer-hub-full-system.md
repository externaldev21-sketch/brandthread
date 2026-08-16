---
name: Manufacturer Hub Full System
description: Complete real-backend implementation of the manufacturer hub — public directory, invite tokens, Stripe Connect payouts, sample/bulk 6-stage orders, drop wallet, and real-time messaging.
---

## What was built (migration 017)

### DB changes
- `manufacturers.clerk_id` made nullable (public applications have no Clerk account)
- New columns on `manufacturers`: `years_in_business`, `is_public_directory`, `contact_email`, `city`, `stripe_account_id`, `stripe_account_status`
- New table `manufacturer_invite_tokens`: seller creates private onboarding links
- New table `sample_orders`: 6-stage tracker (`payment_received → processing → cut_and_sew → packing → shipped → delivered`), Stripe PaymentIntent, payout tracking
- New table `drop_wallets`: per-drop, per-seller held funds ledger
- New table `drop_wallet_transactions`: immutable ledger for deposits/releases/payments
- `manufacturer_messages` extended: `message_type`, `media_urls`, `card_data` columns

### API routes
- `GET|POST /api/manufacturers/public` — public directory (no auth required)
- `POST /api/manufacturers/public/apply` — public application (clerkId nullable)
- `GET /api/manufacturers/public/:id` — single public profile
- `POST /api/manufacturers/connect/onboard` — Stripe Connect Express for manufacturer payouts
- `GET  /api/manufacturers/connect/status` — Connect account status
- `POST /api/manufacturers/invite-tokens` — seller creates private invite
- `GET  /api/manufacturers/invite-tokens` — seller lists their tokens
- `GET  /api/manufacturers/invite-tokens/resolve/:token` — no auth, for onboard form
- `POST /api/manufacturers/register-via-invite/:token` — register through private invite (requires Clerk auth)
- `GET|POST /api/manufacturers/threads` — list / create threads (seller-side)
- `GET|POST /api/manufacturers/threads/:threadId/messages` — real DB messaging
- `GET|POST /api/sample-orders` — create/list 6-stage orders
- `GET /api/sample-orders/:id` — order detail with stage index
- `PATCH /api/sample-orders/:id/advance` — advance production stage
- `PATCH /api/sample-orders/:id/tracking` — add tracking + trigger payout to manufacturer
- `POST /api/sample-orders/:id/pay-from-wallet` — pay bulk order from drop wallet
- `GET|POST /api/drop-wallets/:dropId` — create/get wallet
- `POST /api/drop-wallets/:dropId/deposit` — record buyer order payment
- `POST /api/drop-wallets/:dropId/release-order/:orderId` — per-order payout (Stripe payout to seller bank)
- `POST /api/drop-wallets/:dropId/pay-shipping/:orderId` — deduct label cost from wallet

### Mobile changes
- `lib/api.ts`: added `manufacturers` group with all sub-groups (public, inviteTokens, registerViaInvite, threads, connect, sampleOrders, dropWallets); fixed pre-existing duplicate `products`/`buyer` keys
- `manufacturerService.ts`: `searchManufacturers` now calls `/api/manufacturers/public`; `createInvitation` now calls `POST /api/manufacturers/invite-tokens`; both fall back to demo on error
- `manufacturer-onboard.tsx`: submit calls real API (`public/apply` or `register-via-invite/:token` if `?token=` param present)
- `manufacturer-messages.tsx`: full rewrite — real API (threadId param), demo fallback (conversationId param), photo sharing, sample_card/bulk_card message dialogs, calling button (graceful Alert for EAS requirement)

## Architecture rules
- Public apply → `is_public_directory = true`, `clerk_id = NULL`, `status = 'active'` immediately live
- Private invite → `is_public_directory = false`, requires Clerk auth; marks invite token as `used_at`
- Sample order payments: Stripe PaymentIntent with `application_fee_amount` + `transfer_data.destination` (manufacturer Connect account)
- Payout release: triggered when tracking number added → `stripe.transfers.create` → seller's `stripe_account_id`
- Drop wallet: DB ledger tracks balance; `drop_wallet_transactions` is immutable; `balance - released - reserved = available`
- Pre-order drops with wallets: seller Connect account set to manual payouts so Stripe holds funds
- Video/voice calling: implemented as graceful UI (button in header + attach menu), requires EAS native build with `react-native-agora`

## Key gotchas
- `clerk_id` is now nullable — queries filtering by `clerkId` must handle NULL (use `eq(manufacturers.clerkId, userId)` which already handles this correctly in Postgres)
- The `drop-wallet.ts` route uses `orders.dropId`, `orders.ownerId`, `orders.subtotalCents`, `orders.trackingNumber` — all exist in schema/index.ts
- `requireAuth` sets `(req as any).clerkUserId` — all routes that need seller ID use this
- Messages screen accepts either `threadId` (real API) or `conversationId` (demo AsyncStorage) — auto-resolves, falls back gracefully
- `api.ts` `preorder` key was renamed from the duplicate `buyer` block to avoid TS duplicate property error
