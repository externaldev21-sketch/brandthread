# Invite-only launch mode

New accounts can be required to hold an invite code before they finish creating
their account. It is a feature flag and is **off by default**; with it off,
nothing about sign-up changes.

## How it works

- Flag: `inviteOnlySignup` in the existing `feature_flags` table (migration 241
  seeds it `false`). A missing row counts as off.
- Codes are the existing platform-admin invite codes (`admin_invite_codes`,
  `/api/admin/invites`): 8 characters from `crypto.randomInt`, optional max uses
  and expiry, revocable, redeemed atomically (a guarded counter, so concurrent
  redemptions never exceed `max_uses`; one redemption per account).
- Enforcement is server-side in `POST /api/auth/onboarding/complete`. Clerk is
  still the identity authority and can create the account; the account just
  can't finish onboarding (and so can't become a buyer or seller) without a
  redeemed code.
- Not gated: accounts that already finished onboarding (grandfathered) and
  platform staff (`users.role = 'admin'`).
- The app reads `GET /api/access/status` once for a not-yet-onboarded account.
  If `required` is true, `AuthGate` routes to `/access-code` instead of
  `/onboarding`. That screen takes a code or an email for the waitlist.
- Member referral codes (6 characters, `users.invite_code`) never unlock access.

## Endpoints

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/access/status` | signed in | `{ inviteOnly, redeemed, required }` |
| `POST /api/access/validate` | public, 10 / 15 min per client | `{ valid }`, one answer for every failure |
| `POST /api/access/redeem` | signed in, 10 / 15 min | spend a code for this account |
| `POST /api/access/waitlist` | public, 5 / hour per client | join with an email (idempotent, same response if already listed) |
| `GET /api/admin/access/waitlist` | admin | waitlist with counts |
| `POST /api/admin/access/waitlist/:id/invite` | admin | issues a single-use code (30 days), marks invited |
| `GET/POST /api/admin/invites`, `POST /api/admin/invites/:id/disable` | admin | list with usage, generate, revoke (existing) |
| `PUT /api/config/features/inviteOnlySignup` | admin | the switch (existing) |

## Runbook

1. Generate codes: in the app go to Settings, Privacy & safety, **Invites and
   waitlist** (moderators only), set how many codes and uses each, tap
   Generate, then Copy on a code. Or `POST /api/admin/invites` with
   `{ "count": 20, "maxUses": 1 }`.
2. Turn it on: flip **Invite-only signup** on that screen (or
   `PUT /api/config/features/inviteOnlySignup {"enabled": true}`). The flag
   endpoint is cached up to 60 s; the onboarding gate reads the database
   directly, so it takes effect immediately.
3. Invite people from the waitlist: Waitlist tab, **Invite**. The single-use
   code is copied to your clipboard and kept on the row; send it to them.
4. Revoke a code: Revoke on its card. Revoked, expired and used-up codes fail
   the same way for the person entering them.
5. Turn it off: flip the switch off. Everyone can finish onboarding again.
   Accounts that already redeemed keep their record.

People stuck mid-onboarding when you turn it on (account created, setup not
finished) are asked for a code; finished accounts are not.
