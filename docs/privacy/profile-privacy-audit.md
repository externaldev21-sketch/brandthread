# Profile privacy audit — owner vs visitor

Rule: a profile has **one owner POV and one visitor POV** (Instagram's own-profile vs other-profile).
The mode is `viewerId === ownerId` (`artifacts/mobile/lib/profileAccess.ts`), never a route param.
The server half is an allow-list: `artifacts/api-server/src/lib/publicProfile.ts`.

## Endpoints audited

| Endpoint | Finding | Fix |
|---|---|---|
| `GET /api/public/sellers/:id` | Spread the raw `users` select into `profile` — leaked `activeStanding`, `policyRestricted`, `verificationStatus`, `accountType` internals. Posts were raw `posts` rows (`moderationStatus`, `scheduledAt`, `mediaPaths`, `slideOverlays`); variants were raw rows (`sku`, `lowStockThreshold`). | `toPublicSellerProfile` / `toPublicPost` / `toPublicProduct` / `toPublicVariant` allow-lists. |
| `GET /api/public/drops/:id` | `seller` object spread `verificationStatus`, `activeStanding`, `policyRestricted`. | Only `displayName`, `brandName`, derived `verified`. |
| `GET /api/public/products`, `/products/:id` | Variants were raw rows (`sku`, `lowStockThreshold`). | `toPublicVariant`. |
| `GET /api/reviews/seller/:id`, `/product/:id` | Returned raw review rows including `orderId` — publishes *which purchase* a buyer made. | `toPublicReview` drops `orderId`. |
| `GET /api/public/users/:id/videos` | Owner saw private posts (correct) but there was no way to preview the stranger view. | `?as=visitor` can only *remove* owner access. |
| `GET /api/social/profile/:id` | Already `formatUser` allow-list (no email/phone/plan). | Pinned with a test that also asserts the exact key set for a buyer. |
| `GET /api/public/profiles/:username` | Already allow-listed. | Pinned with a test. |
| `GET /api/social/followers\|following?userId=` | Already `formatUser` rows. | — |
| `GET /api/seller/profile` | Returns plan, subscription, earnings, policies — **owner only**, scoped to the caller (`requireAuth`, reads the caller's own `clerkId`). | Test: 401 signed-out; a visitor only ever gets their own record; only the owner gets `subscriptionPlanId`. |
| `GET /api/buyer/orders`, `/addresses` | Owner-scoped (caller id only; `?userId=` ignored). | Test: 401 signed-out, no cross-account data for a visitor. |

Not audited in depth (separate directories, not buyer/seller profiles): manufacturer and freelancer public profiles.

## Screens audited

- `app/seller-profile.tsx` — trusted an `isOwner=true` **route param** to show owner UI. Now decided by ids only; param ignored for privilege.
- `app/buyer-other-profile.tsx` — top-right "Messages" button opened the *viewer's own* inbox (an owner shortcut on someone else's profile). Removed. Owner opening their own id is redirected to their owner profile.
- `app/(buyer)/profile.tsx` — Saved / Liked / Orders / Thread Cash / activity / settings remain owner-only (this screen is only reachable as the owner).
- `app/(tabs)/profile.tsx` — plan chip, dashboard, edit, inbox, drafts remain owner-only.
- `app/u/[username].tsx` — only calls the public profile endpoint.

## Tests

- `api-server/src/lib/publicProfile.test.ts` — every private key on a fake row never survives a projection.
- `api-server/src/routes/__tests__/profile-privacy.integration.test.ts` — real routes, visitor vs owner vs signed-out, deep key scan.
- `mobile/tests/profile-access.test.ts` — capability table.
- `mobile/tests/seller-profile-owner-follow.test.tsx` — seller: visitor / owner / preview / `isOwner` param abuse.
- `mobile/tests/buyer-other-profile-visitor.test.tsx` — buyer as seen by others: nothing private rendered, only public reads called.
- `mobile/tests/buyer-profile-tabs.test.tsx` — buyer owner: private tabs + View as visitor.
