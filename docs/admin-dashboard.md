# Admin dashboard

Platform-admin tooling for Brandthread staff: users & sellers, orders / refunds /
disputes, revenue and platform fees, AI spend, moderation, promoted-thread
approvals, Discover featuring, announcements, invite codes and an audit log.

- **API**: `/api/admin/*` (this doc), `artifacts/api-server/src/routes/admin/`
- **UI**: the manufacturer portal app, route `/admin` (served at
  `<portal base>/admin`, e.g. `/manufacturers/admin`), `artifacts/manufacturer-portal/src/admin/`.
  It is a separate route tree with its own monochrome theme (`admin.css`, scoped to
  `.admin-theme`); no existing portal page, component or style was changed.

## Access

Access is `users.role = 'admin'` — the same role the moderation queue already uses.
There is **no endpoint that grants it**. To make someone an admin, set the role in the database:

```sql
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
```

Every `/api/admin` route (except `GET /api/admin/me`) rejects signed-out callers (401),
non-admins and suspended admins (403), and fails closed (503) if the role can't be read.
In the UI, non-admins see the portal's normal "not found" page, and signed-out visitors are
sent to sign-in without any admin API call being made. Admin accounts cannot be suspended
from the dashboard or the moderation queue.

After signing in, open `<portal base>/admin` (the portal's sign-in still lands on its own
onboarding redirect).

## Endpoints

| Area | Endpoint |
| --- | --- |
| Overview | `GET /admin/overview` |
| Users | `GET /admin/users?q=&kind=all\|sellers\|buyers\|suspended\|admins&limit=&offset=` · `GET /admin/users/:clerkId` · `POST /admin/users/:clerkId/verify {verified}` · `POST …/suspend {reason}` · `POST …/reinstate` |
| Orders | `GET /admin/orders?q=&status=` · `GET /admin/orders/:id` · `GET /admin/refunds` · `GET /admin/disputes?status=open\|closed\|all` |
| Revenue | `GET /admin/revenue?days=` — gross sales, platform fees (net of refunded fees), refunds, promotion revenue, daily series |
| AI spend | `GET /admin/ai-spend?days=` — per-user estimated cost, calls, tokens |
| Promotions | `GET /admin/boosts?status=pending\|reviewed\|all` · `POST /admin/boosts/:id/review {decision: approve\|reject, reason}` |
| Featured | `GET/POST /admin/featured` · `PATCH/DELETE /admin/featured/:id` · public read: `GET /api/public/featured` |
| Announcements | `GET/POST /admin/announcements` · `GET /admin/announcements/audience?audience=` |
| Invite codes | `GET/POST /admin/invites` · `POST /admin/invites/:id/disable\|enable` |
| Audit | `GET /admin/audit?actor=&action=&targetId=` |

Nothing here deletes accounts or data, and nothing moves money: refunds and disputes are
read-only views; rejecting a promotion stops it but the refund stays a deliberate step in Stripe.

## Audit log

`admin_audit_log` (migration 112) is **append-only** — a database trigger rejects `UPDATE`
and `DELETE`. Each mutating admin route writes its entry **in the same transaction** as the
change, so an action can't succeed without being logged (and a failed action leaves no entry).
Logged actions: `user.verify`, `user.unverify`, `user.suspend`, `user.reinstate`,
`featured.add|update|remove`, `announcement.send`, `invite.create|disable|enable`,
`boost.approve|reject`, `moderation.resolve`. The purge-test-data tool lists the table in
`NON_DELETABLE_TABLES`, like the money ledger.

## Moderation — interface with the trust & safety API

The dashboard owns **no moderation logic**. The Moderation page calls the existing API
(`artifacts/api-server/src/routes/moderation.ts`) unchanged:

- `GET /api/moderation/reports?status=open|resolved&type=&limit=&offset=` →
  `{ items[], hasMore, summary: { open, heldByFilter, resolvedToday } }`
- `POST /api/moderation/reports/:id/resolve { action: dismiss|remove_content|suspend_user, note? }`
- `POST /api/moderation/users/:userId/reinstate`

Contract this dashboard relies on: each report item carries `id, status, source, targetType,
targetLabel, contentExcerpt, reason, createdAt, owner{name,displayName,username},
openReportsOnTarget, ownerPriorActions, resolution{action}|null`. If the trust/safety session
changes those shapes, update `admin/pages/moderation.tsx`. Because that router is not edited,
`auditModerationActions` (`lib/admin/moderationAudit.ts`) is mounted in front of it in
`routes/index.ts` and records successful `resolve` / `reinstate` calls in the admin audit log.

## AI spend

`ai_usage_events` is filled by a hook in `lib/integrations-openai-ai-server/src/client.ts`:
completed non-streaming `chat.completions.create`, `images.generate` and `images.edit` calls
report their token usage; `lib/aiUsage.ts` attributes each to the signed-in caller of the
current request (AsyncLocalStorage, set by one middleware in `app.ts`) and prices it from
`lib/admin/aiPricing.ts` (**estimated list prices — update when provider pricing changes**).
Models missing from the table are recorded as `priced = false` with cost 0 and flagged in the UI.
Streaming responses and calls made outside a signed-in request (jobs) are recorded without a user / not at all
(streams) — so the page is a lower bound until streaming chat is metered.

## Featured on Discover

Admins add a brand (seller Clerk ID) or a thread (post ID). `GET /api/public/featured`
returns `{ brands: [{userId,label}], threads: [{postId,label}] }` in display order, hiding
inactive/expired rows, suspended or deleted brands, and non-published/held threads. The endpoint
is public, read-only and cacheable for 60s. **Wiring it into the mobile Discover screen is not
part of this change** (Discover is being edited in other sessions); the endpoint is the contract.

## Announcements

`POST /admin/announcements` records the announcement (and its audit entry), returns 202, then
fans out in batches: an in-app Activity row (`type: announcement`, category `system`) and/or a
push via the existing `sendPushToUser` (respecting each user's push switch and quiet hours).
Suspended and deleted accounts are skipped. Status/recipient counts are kept on the row.

## Invite codes

Admin codes are 8 characters (member referral codes are 6, so they can't collide). Each has optional
`maxUses` and `expiresAt`, can be disabled/re-enabled, and is redeemed through the **existing**
`POST /api/referrals/apply`: if the code isn't a member's referral code it is tried as an admin
code. Redemption is atomic (guarded counter — concurrent redemptions can't exceed `maxUses`),
one redemption per user, and grants no referral reward.

## Promoted-thread approvals

Paid boosts appear under "Awaiting approval" until reviewed (`boost_reviews`). Approve keeps
the promotion running. Reject requires a reason, sets the boost to `cancelled` (so existing
status filters stop serving it) and notifies the seller in their Activity feed.
