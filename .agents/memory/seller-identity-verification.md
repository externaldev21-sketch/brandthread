---
name: Seller Identity Verification
description: Stripe Identity hosted document-check flow for seller verified badge. DB columns, API routes, webhook handlers, and mobile screen.
---

## DB columns added (migration SQL, no migration file — ran directly)
On `users` table:
- `verification_status TEXT NOT NULL DEFAULT 'unverified'` — 'unverified'|'pending'|'verified'|'failed'
- `stripe_verification_session_id TEXT` — Stripe VerificationSession ID for webhook lookup

Drizzle schema (lib/db/src/schema/index.ts):
- `verificationStatus: text('verification_status').notNull().default('unverified')`
- `stripeVerificationSessionId: text('stripe_verification_session_id')`

The existing `verified: boolean` column is still the source of truth for showing the badge — the webhook sets BOTH `verified=true` AND `verificationStatus='verified'` on success.

## API routes (artifacts/api-server/src/routes/seller-verification.ts)
Mounted at `/api/seller/verification` (BEFORE the catch-all `/api/seller` router — order matters in index.ts).

- `GET /status` — returns `{ verified, verificationStatus, sessionId }`
- `POST /start` — creates Stripe VerificationSession with `type: 'document'`, stores session ID, sets status='pending', returns `{ url, sessionId, reused }`. Reuses existing session if still in requires_input/created state to avoid duplicate sessions.
- `POST /cancel` — cancels existing session in Stripe (best-effort), resets to 'unverified'. Allows seller to retry after failure.

Stripe Identity API access: `(stripe.identity.verificationSessions as any)` — cast to `any` because TypeScript typings for Identity may be incomplete in older Stripe SDK versions.

### return_url
Uses `STRIPE_IDENTITY_RETURN_URL` env var if set, otherwise falls back to `https://${REPLIT_DEV_DOMAIN}/verification-complete`. For production, set this to the app's production URL.

### Error handling
If Stripe Identity is not enabled: returns `{ error: 'IDENTITY_NOT_ENABLED' }` with 503. The mobile screen surfaces a specific Alert for this case.

## Webhook handlers (artifacts/api-server/src/routes/webhooks.ts)
Added to the existing switch block:
- `identity.verification_session.verified` → `handleIdentityVerified` — sets `verified=true, verificationStatus='verified'`, inserts system notification
- `identity.verification_session.requires_input` → `handleIdentityFailed` — sets `verificationStatus='failed'`, inserts system notification
- `identity.verification_session.processing` → no-op (already pending)

Metadata key: `seller_clerk_id` — set when creating the session, used to look up the user in the webhook.

notificationsFeed insert fields: `{ userId, category: 'system', type: 'verification_verified'|'verification_failed', title, body }` — do NOT include `id`, `data`, or `createdAt` (schema auto-generates them).

## Mobile (artifacts/mobile/app/seller-verification.tsx)
- Full screen with status-driven UI (unverified → start CTA, pending → check status, verified → badge confirmation, failed → retry)
- Opens Stripe URL via `Linking.openURL()` (device browser)
- Polls status on re-focus via `useFocusEffect`
- Handles `ALREADY_VERIFIED` and `IDENTITY_NOT_ENABLED` API errors explicitly

## Settings entry
`artifacts/mobile/app/settings.tsx` Account section: `{ label: 'Identity verification', icon: 'shield', route: '/seller-verification' }`

## api.ts additions
`api.seller.verification.status()`, `api.seller.verification.start()`, `api.seller.verification.cancel()` — added inside the `seller` object block.

## What the user must do in Stripe Dashboard
1. Enable Stripe Identity: Dashboard → More → Identity → Get started (requires a brief application)
2. Add Identity webhook events to their existing webhook endpoint (or create a new one): `identity.verification_session.verified`, `identity.verification_session.requires_input`, `identity.verification_session.processing`
3. The webhook endpoint URL remains the same: `https://<production-url>/api/webhooks/stripe`
4. No new webhook secret needed — Identity events use the same `STRIPE_WEBHOOK_SECRET`

**Why:** Stripe Identity is a separate product that must be activated per Stripe account before the API accepts `stripe.identity.*` calls. Without activation, `POST /start` returns `IDENTITY_NOT_ENABLED`.
