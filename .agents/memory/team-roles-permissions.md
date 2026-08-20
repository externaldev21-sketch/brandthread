---
name: Team, Roles & Permissions
description: Team member invites, role tiers (owner/manager/staff), API role enforcement, and audit log — architecture and gotchas.
---

# Team, Roles & Permissions

## Role model (context-rewrite)
- `teamContext()` middleware (`api-server/src/middlewares/requireRole.ts`) looks up the caller in `team_members` (by `memberClerkId`, status `active`). If they're an active member of someone else's store, it **rewrites `req.clerkUserId` to the owner's id** so all existing owner-scoped handlers transparently operate on the owner's store, while preserving `req.actorClerkId` / `req.actorRole` for the audit log. Non-members act as owner of their own store (`TEAM_OWNER_BYPASS`). Fails open on DB errors.
- **Why:** avoids touching every handler's scoping logic; one middleware makes the whole seller API team-aware.
- **How to apply:** any new seller route file gets `router.use(requireAuth); router.use(teamContext());` then `requireRole("manager"|"staff"|"owner")` per route as needed.
- **Consequence to remember:** an active member always acts on the owner's store — they cannot manage a store of their own while the membership is active (store-switching is a known follow-up).

## Mounting rules (gotcha)
- `teamContext()` must be mounted **inside** routers right after `router.use(requireAuth)` — requireAuth re-sets `clerkUserId`, so an index-level mount would be clobbered.
- Standalone `requireRole('owner')` at index mount level IS safe (it reads Clerk getAuth itself): used for `/seller/connect`, `/seller/subscription`, `/finance` (billing/payouts owner-only).
- Gates: products create/update/delete/variants/import + inventory adjust + orders create = manager+; order status/tracking = staff+. 403 body: `{error, code:"ROLE_REQUIRED", requiredRole, currentRole, message}`.

## Express 5 middleware typing (gotcha)
- Middleware factories must be typed `RequestHandler<any, any, any, any>`. A factory returning `(req: Request, ...) => ...` breaks the route's path-literal param inference when added to a typed route — `req.params.x` becomes `string | string[]` across the whole handler and drizzle `eq()` calls stop compiling.

## Invites
- Keyed on (ownerId, email) upsert; re-invite of active member → 409; accept keeps token (link resolves to "accepted"); blocks self-accept (400) and used-by-other (409); soft-remove sets status `removed` + clears memberClerkId/token.
- Links: web `https://{domain}/team-invite?token=X` + `mobile://team-invite?token=X`. Resend email only if `RESEND_API_KEY` exists (connector NOT connected) — shareable link is the primary path; response carries `emailSent` flag. `inviteToken`/`inviteUrl` serialized only for owner viewers.
- Members list prepends a virtual owner row (id `'owner'`, always counted in roles); `isUuid()` guard before uuid queries — `'owner'` as a pg uuid param crashes.

## Audit log
- `logActivity()` in `api-server/src/lib/activityLog.ts` (never throws, resolves actorName). Action strings are human sentences rendered raw by the UI; machine filtering via resourceType/resourceId/metadata. Order-status logs only on genuine transitions.

## Mobile
- `team-invite.tsx` is the deep-link accept screen: public (AuthGate exempts segment), signed-out flow stashes token in AsyncStorage `bt:pendingTeamInvite`, AuthGate redirects back post-onboarding (single-shot; screen clears the key on mount).
- Don't gate a public screen's initial render on Clerk `isLoaded` — only gate the auth-dependent action buttons, or cold web boots sit on a spinner.
- Screens: team.tsx (invite modal → copy/share link, pending 'Invited' badges, server `online` flag, paginated audit log), roles.tsx (3 tiers → `/users?role=`), users.tsx (`?id=` detail with change-role/remove, `?role=` filtered list).

## Owner-only financial access
- Store subscription, Stripe Connect, balances, transactions, invoices, statements, and payout data are owner-only. Managers and staff must be denied in a joined-store context even after owner-id rewriting.
- **Why:** financial details and Stripe account identifiers belong to the store owner; rewriting the data scope must never be mistaken for rewriting the caller's authority.
- **How to apply:** resolve team context, then authorize from the preserved actor role. Every financial read and mutation must require owner; test joined-store requests for both manager and staff roles.

## Verifying expo-web captures
- Screenshot captures grab the first paint; in-flight fetches show as spinners even when the wiring is correct. Correlate with api-server request logs — a logged 404/401 (or `request aborted` when the capture browser closes) proves the call fired and settled. Don't chase capture-only spinners.

## Expiring invite reminders
- Reminder delivery uses a recoverable short lease plus a durable successful-send timestamp, and retries carry a deterministic Resend idempotency key derived from the invite and its current token.
- **Why:** email delivery and database persistence cannot be committed atomically; a crash after either step must neither permanently suppress a reminder nor send a duplicate.
- **How to apply:** any retryable Resend email with a once-only promise needs its own event-specific idempotency key. Regenerating an invite must clear both reminder fields so the new token is eligible independently.
