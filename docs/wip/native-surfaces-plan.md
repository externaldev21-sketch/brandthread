# WIP: native surfaces (Live Activity, widgets, Watch sale ping)

Paused at Dev's request before writing any code. Resume on "Go".

## Overlap found
- #803 already has the order Live Activity + Dynamic Island, APNs push-to-update from the
  tracking webhooks (`applyCarrierTracking`, `recordDelivery`), ending the activity on delivery,
  and a small/medium seller "Today" widget. Build on it (stack), don't duplicate.
- #969 already adds the `RichPushService` notification service extension (product image on pushes).
- #945 has a sales-today snapshot for Siri.

## Plan (3 PRs, each stacked, base dev)
1. Order Live Activity (on #803): one `nativeSurfaces` feature flag (migration seeds it OFF,
   server + client gate); drop the duplicate LA alert on updates (the normal push already
   notifies); push-to-start (iOS 17.2) so Shipped / Out for delivery start a fresh activity
   after ActivityKit's 8h limit, at most once per order per stage (`live_activity_remote_starts`),
   start tokens in `live_activity_start_tokens`; show the "Ordered" stage for orders placed < 8h ago.
2. Seller widgets (on 1): `GET /api/seller/widget-summary` (sales today, order count, to ship);
   separate "To ship" widget; lock-screen accessory families; tap routes to orders / to-ship;
   reload on new-order push.
3. Watch sale ping (on 1 + #969): "New order · $98" short title behind the flag, thread id for
   stacking, the extension downsizes the thumbnail to a small JPEG so it shows on Watch.
