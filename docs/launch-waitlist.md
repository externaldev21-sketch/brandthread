# Pre-launch email waitlist

The public cover at `/` (signed out) and `/welcome` collects only an email
address, signup timestamp, and source (`instagram` or `landing`). The visitor
explicitly requests launch email; this is not a seller marketing subscription
or a Brandthread account. No launch email is sent automatically.

`POST /api/launch-waitlist` accepts JSON `{ "email": "...", "source": "landing" }`.
Emails are trimmed and lowercased, with a case-insensitive database uniqueness
constraint. New and duplicate requests return the same success response. Five
attempts per IP per hour are allowed. No public email-list endpoint exists.

## Retrieve the launch list

Use the owner's production Database pane (never a public browser endpoint) and
export the results of this read-only query as CSV:

```sql
SELECT email, created_at, source
FROM launch_waitlist_signups
ORDER BY created_at;
```

The development list is separate from production. Development test submissions
are not launch subscribers and must not be exported for a campaign.

## Launch email

The list is stored in PostgreSQL only. Existing Resend marketing code is scoped
to individual sellers and their subscribers, not a platform-wide launch
audience. No audience ID is assumed, no contacts are silently subscribed to a
seller campaign, and no email is sent as part of joining. Export this list for
the approved launch announcement when the release is ready.

## Release

The additive schema/migration must be applied to development and included in
the normal Publish schema diff. Do not run production DDL or add deployment-time
migrations. Publish the updated API and web artifact together.

The Expo development domain and `/fast-preview/` remain app previews; explicit
`bt_preview=buyer|seller|guest` works on development hosts. Unknown root query
parameters (including Instagram tracking parameters) never open account
creation. Signed-in sessions may still use the actual app.
