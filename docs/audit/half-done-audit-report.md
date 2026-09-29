# Half-done audit report

Generated 2026-09-29T22:25:24.484Z (partial run — time budget hit).

- Route files discovered: 274
- Route × role combinations audited: 451
- Unreachable: 4
- Total findings: 2069 (hard: 367, warn: 1702)

## Notes on this run

This is a time-budgeted pass, not full coverage — see `routesAudited` vs `routesDiscovered` above. One caveat found while producing it:

- **Group-root layouts under the "wrong" role are expected unreachable, not bugs**: `/(tabs)` is the seller tab root and `/(buyer)` is the buyer tab root — a `/(tabs)` load under `?bt_preview=buyer` (or vice versa) correctly renders nothing, the same way a signed-in buyer account would never land on the seller shell. Do not treat those specific role/route pairings in the Unreachable table below as findings.

An earlier version of this script flagged the *matching*-role case (e.g. `/(tabs)` under `seller`) as unreachable too, flakily — the fast client-side `history.pushState`/`popstate` navigation used between routes was occasionally still mid-render when the reachability check ran. The script now retries once with a real full-page reload before giving up, which fixed that: unreachable dropped from 72% of routes in the initial sample to a small handful in a full run. A route/role pair that still shows unreachable below reflects a real full-navigation blank body — either a genuine redirect-only route with no rendered content, or worth a closer look.

## Known, being rebuilt separately

The seller dashboard revenue chart (repeated axis labels, misaligned curve, no value on tap) is already being rebuilt in a separate session (019SGXKf). Findings from `/(tabs)` (seller dashboard root) related to that specific chart are listed below for completeness but should NOT be picked up by a follow-up fix PR — check with that session before touching it.

## Findings by type

| Type | Tier | Count |
|---|---|---|
| hit-target-too-small | warn | 684 |
| type-scale-drift | warn | 463 |
| console-error | hard | 345 |
| contrast-violation | warn | 207 |
| overlapping-text | warn | 143 |
| clipped-text | warn | 81 |
| min-size-violation | warn | 62 |
| font-family | warn | 44 |
| color-rule-violation | warn | 18 |
| placeholder-copy | hard | 14 |
| error-boundary | hard | 6 |
| repeated-labels | hard | 2 |

## Unreachable routes

| Route | Role | Reason |
|---|---|---|
| `/` | seller | blank page body |
| `/` | buyer | blank page body |
| `/request-sample` | seller | blank page body |
| `/request-sample` | buyer | blank page body |

## Findings by area

### Other (1081)

| Route | Role | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|
| `/(buyer)/activity` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/following` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/friends` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-friends/seller/00-initial.png) |
| `/(buyer)/friends` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-/seller/00-initial.png) |
| `/(buyer)` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/activity-center` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/activity-center/seller/00-initial.png) |
| `/activity-center` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/activity-center/buyer/00-initial.png) |
| `/activity-people` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/activity-people/seller/00-initial.png) |
| `/admin-reports` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/admin-reports/seller/00-initial.png) |
| `/admin-reports` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/admin-reports/buyer/00-initial.png) |
| `/app-icon` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/app-icon/seller/00-initial.png) |
| `/app-theme` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/app-theme/seller/00-initial.png) |
| `/automation` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/automation/seller/00-initial.png) |
| `/bg-removal` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/bg-removal/seller/00-initial.png) |
| `/biometric-unlock` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/biometric-unlock/seller/00-initial.png) |
| `/boost` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/boost/seller/00-initial.png) |
| `/boost` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/boost/buyer/00-initial.png) |
| `/brand` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/brand/seller/00-initial.png) |
| `/buyer-addresses` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-addresses/seller/00-initial.png) |
| `/buyer-addresses` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-addresses/buyer/00-initial.png) |
| `/buyer-archive` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-archive/seller/00-initial.png) |
| `/buyer-blocked` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-blocked/seller/00-initial.png) |
| `/buyer-blocked` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-blocked/buyer/00-initial.png) |
| `/buyer-close-friends` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-close-friends/seller/00-initial.png) |
| `/buyer-collection` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-collection/seller/00-initial.png) |
| `/buyer-collection` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-collection/buyer/00-initial.png) |
| `/buyer-conversation` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-conversation/seller/00-initial.png) |
| `/buyer-download-data` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-download-data/seller/00-initial.png) |
| `/buyer-drafts` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-drafts/seller/00-initial.png) |
| `/buyer-drop-detail` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-drop-detail/seller/00-initial.png) |
| `/buyer-drop-detail` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-drop-detail/buyer/00-initial.png) |
| `/buyer-friend-requests` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-friend-requests/seller/00-initial.png) |
| `/buyer-friend-requests` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-friend-requests/buyer/00-initial.png) |
| `/buyer-highlights-manager` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-highlights-manager/seller/00-initial.png) |
| `/buyer-invite` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-invite/seller/00-initial.png) |
| `/buyer-invite` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-invite/buyer/00-initial.png) |
| `/buyer-login-activity` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-login-activity/seller/00-initial.png) |
| `/buyer-login-activity` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-login-activity/buyer/00-initial.png) |
| `/buyer-muted` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-muted/seller/00-initial.png) |
| `/buyer-notifications` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-notifications/seller/00-initial.png) |
| `/buyer-payment-methods` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-payment-methods/seller/00-initial.png) |
| `/buyer-payment-methods` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-payment-methods/buyer/00-initial.png) |
| `/buyer-personal-details` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-personal-details/seller/00-initial.png) |
| `/buyer-post-comments` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-post-comments/seller/00-initial.png) |
| `/buyer-post-comments` | seller | console-error | hard | Failed to load resource: net::ERR_FAILED | [view](../../docs/audit/screenshots/buyer-post-comments/seller/00-initial.png) |
| `/buyer-post-comments` | buyer | console-error | hard | Failed to load resource: net::ERR_FAILED | [view](../../docs/audit/screenshots/buyer-post-comments/buyer/00-initial.png) |
| `/buyer-post-viewer` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-post-viewer/seller/00-initial.png) |
| `/buyer-post-viewer` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-post-viewer/buyer/00-initial.png) |
| `/buyer-problem-report` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-problem-report/seller/00-initial.png) |
| `/buyer-problem-report` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-problem-report/buyer/00-initial.png) |
| `/buyer-qr-code` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-qr-code/seller/00-initial.png) |
| `/buyer-refund-request` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-refund-request/seller/00-initial.png) |
| `/buyer-refund-request` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-refund-request/buyer/00-initial.png) |
| `/buyer-report` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-report/seller/00-initial.png) |
| `/buyer-restricted` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-restricted/seller/00-initial.png) |
| `/buyer-return-request` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-return-request/seller/00-initial.png) |
| `/buyer-return-request` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-return-request/buyer/00-initial.png) |
| `/buyer-saved` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-saved/seller/00-initial.png) |
| `/buyer-saved` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-saved/buyer/00-initial.png) |
| `/buyer-search-history` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-search-history/seller/00-initial.png) |
| `/buyer-search` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-search/seller/00-initial.png) |
| `/buyer-search` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-search/buyer/00-initial.png) |
| `/buyer-story-create` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-story-create/seller/00-initial.png) |
| `/buyer-story-viewer` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-story-viewer/seller/00-initial.png) |
| `/buyer-your-activity` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-your-activity/seller/00-initial.png) |
| `/call-screen` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/call-screen/seller/00-initial.png) |
| `/camera-capture` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/camera-capture/seller/00-initial.png) |
| `/community-guidelines` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/community-guidelines/seller/00-initial.png) |
| `/community` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/community/seller/00-initial.png) |
| `/community` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/community/buyer/00-initial.png) |
| `/connections` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/connections/seller/00-initial.png) |
| `/content` | seller | repeated-labels | hard | 4 adjacent identical labels: "0" | [view](../../docs/audit/screenshots/content/seller/00-initial.png) |
| `/content` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/content/seller/00-initial.png) |
| `/content` | buyer | repeated-labels | hard | 4 adjacent identical labels: "0" | [view](../../docs/audit/screenshots/content/buyer/00-initial.png) |
| `/content` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/content/buyer/00-initial.png) |
| `/conversation-details` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/conversation-details/seller/00-initial.png) |
| `/conversation-details` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/conversation-details/buyer/00-initial.png) |
| `/conversation-group-create` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/conversation-group-create/seller/00-initial.png) |
| `/conversation-nicknames` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/conversation-nicknames/seller/00-initial.png) |
| `/conversation-search` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/conversation-search/seller/00-initial.png) |
| `/create-post` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/create-post/seller/00-initial.png) |
| `/customer-events` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/customer-events/seller/00-initial.png) |
| `/customers` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/customers/seller/00-initial.png) |
| `/customers` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/customers/buyer/00-initial.png) |
| `/design-bg-removal` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/design-bg-removal/seller/00-initial.png) |
| `/design-bg-replace` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/design-bg-replace/seller/00-initial.png) |
| `/design-brand-assets` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/design-brand-assets/seller/00-initial.png) |
| `/design-campaign` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/design-campaign/seller/00-initial.png) |
| `/design-campaign` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/design-campaign/buyer/00-initial.png) |
| `/design-canvas` | seller | console-error | hard | Design Studio store context changed during sync. | [view](../../docs/audit/screenshots/design-canvas/seller/00-initial.png) |
| `/design-canvas` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/design-canvas/seller/00-initial.png) |
| `/design-canvas` | buyer | console-error | hard | Design Studio store context changed during sync. | [view](../../docs/audit/screenshots/design-canvas/buyer/00-initial.png) |
| `/design-export` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/design-export/seller/00-initial.png) |
| `/design-garment` | seller | error-boundary | hard | Error-boundary fallback UI rendered | [view](../../docs/audit/screenshots/design-garment/seller/00-initial.png) |
| `/design-garment` | seller | console-error | hard | TypeError: Cannot read properties of undefined (reading 'views')
    at R (http://127.0.0.1:39903/_expo/static/js/web/index-d1fceff539c57743473fb19132db2c2d.js: | [view](../../docs/audit/screenshots/design-garment/seller/00-initial.png) |
| `/design-garment` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/design-garment/seller/00-initial.png) |
| `/design-garment` | buyer | error-boundary | hard | Error-boundary fallback UI rendered | [view](../../docs/audit/screenshots/design-garment/buyer/00-initial.png) |
| `/design-garment` | buyer | console-error | hard | TypeError: Cannot read properties of undefined (reading 'views')
    at R (http://127.0.0.1:39903/_expo/static/js/web/index-d1fceff539c57743473fb19132db2c2d.js: | [view](../../docs/audit/screenshots/design-garment/buyer/00-initial.png) |
| `/design-mockup-preview` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/design-mockup-preview/seller/00-initial.png) |
| `/design-mockup-to-model` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/design-mockup-to-model/seller/00-initial.png) |
| `/design-project` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/design-project/seller/00-initial.png) |
| `/design-prompt-edit` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/design-prompt-edit/seller/00-initial.png) |
| `/design-templates` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/design-templates/seller/00-initial.png) |
| `/design-text-to-design` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/design-text-to-design/seller/00-initial.png) |
| `/design-upload-sketch` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/design-upload-sketch/seller/00-initial.png) |
| `/design-versions` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/design-versions/seller/00-initial.png) |
| `/design` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/design/seller/00-initial.png) |
| `/design` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/design/buyer/00-initial.png) |
| `/discounts` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/discounts/seller/00-initial.png) |
| `/discounts` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/discounts/buyer/00-initial.png) |
| `/dispute-detail` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/dispute-detail/seller/00-initial.png) |
| `/dispute-detail` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/dispute-detail/buyer/00-initial.png) |
| `/drafts` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/drafts/seller/00-initial.png) |
| `/finance` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/finance/seller/00-initial.png) |
| `/finance` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/finance/buyer/00-initial.png) |
| `/forgot-password` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/forgot-password/seller/00-initial.png) |
| `/freelancer-apply` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/freelancer-apply/seller/00-initial.png) |
| `/freelancer-apply` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/freelancer-apply/buyer/00-initial.png) |
| `/freelancer-jobs` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/freelancer-jobs/seller/00-initial.png) |
| `/freelancer-jobs` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/freelancer-jobs/buyer/00-initial.png) |
| `/fulfill-batch` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/fulfill-batch/seller/00-initial.png) |
| `/fulfill-batch` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/fulfill-batch/buyer/00-initial.png) |
| `/help` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/help/seller/00-initial.png) |
| `/integrations` | seller | placeholder-copy | hard | Text matches placeholder pattern: "Coming soon" | [view](../../docs/audit/screenshots/integrations/seller/00-initial.png) |
| `/integrations` | seller | placeholder-copy | hard | Text matches placeholder pattern: "Coming soon" | [view](../../docs/audit/screenshots/integrations/seller/00-initial.png) |
| `/integrations` | seller | placeholder-copy | hard | Text matches placeholder pattern: "Coming soon" | [view](../../docs/audit/screenshots/integrations/seller/00-initial.png) |
| `/integrations` | seller | placeholder-copy | hard | Text matches placeholder pattern: "Coming soon" | [view](../../docs/audit/screenshots/integrations/seller/00-initial.png) |
| `/integrations` | seller | placeholder-copy | hard | Text matches placeholder pattern: "Coming soon" | [view](../../docs/audit/screenshots/integrations/seller/00-initial.png) |
| `/integrations` | seller | placeholder-copy | hard | Text matches placeholder pattern: "Coming soon" | [view](../../docs/audit/screenshots/integrations/seller/00-initial.png) |
| `/integrations` | seller | placeholder-copy | hard | Text matches placeholder pattern: "Coming soon" | [view](../../docs/audit/screenshots/integrations/seller/00-initial.png) |
| `/integrations` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/integrations/seller/00-initial.png) |
| `/integrations` | buyer | placeholder-copy | hard | Text matches placeholder pattern: "Coming soon" | [view](../../docs/audit/screenshots/integrations/buyer/00-initial.png) |
| `/integrations` | buyer | placeholder-copy | hard | Text matches placeholder pattern: "Coming soon" | [view](../../docs/audit/screenshots/integrations/buyer/00-initial.png) |
| `/integrations` | buyer | placeholder-copy | hard | Text matches placeholder pattern: "Coming soon" | [view](../../docs/audit/screenshots/integrations/buyer/00-initial.png) |
| `/integrations` | buyer | placeholder-copy | hard | Text matches placeholder pattern: "Coming soon" | [view](../../docs/audit/screenshots/integrations/buyer/00-initial.png) |
| `/integrations` | buyer | placeholder-copy | hard | Text matches placeholder pattern: "Coming soon" | [view](../../docs/audit/screenshots/integrations/buyer/00-initial.png) |
| `/integrations` | buyer | placeholder-copy | hard | Text matches placeholder pattern: "Coming soon" | [view](../../docs/audit/screenshots/integrations/buyer/00-initial.png) |
| `/integrations` | buyer | placeholder-copy | hard | Text matches placeholder pattern: "Coming soon" | [view](../../docs/audit/screenshots/integrations/buyer/00-initial.png) |
| `/integrations` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/integrations/buyer/00-initial.png) |
| `/integrations/klaviyo` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/integrations-klaviyo/seller/00-initial.png) |
| `/integrations/klaviyo` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/integrations-klaviyo/buyer/00-initial.png) |
| `/integrations/shopify-fulfillment` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/integrations-shopify-fulfillment/seller/00-initial.png) |
| `/integrations/shopify-fulfillment` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/integrations-shopify-fulfillment/buyer/00-initial.png) |
| `/inventory-adjust` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/inventory-adjust/seller/00-initial.png) |
| `/inventory-adjust` | seller | console-error | hard | API 404: Not part of the demo data | [view](../../docs/audit/screenshots/inventory-adjust/seller/00-initial.png) |
| `/inventory-adjust` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/inventory-adjust/buyer/00-initial.png) |
| `/inventory-adjust` | buyer | console-error | hard | API 404: Not part of the demo data | [view](../../docs/audit/screenshots/inventory-adjust/buyer/00-initial.png) |
| `/inventory-count` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/inventory-count/seller/00-initial.png) |
| `/inventory-count` | seller | console-error | hard | API 404: Not part of the demo data | [view](../../docs/audit/screenshots/inventory-count/seller/00-initial.png) |
| `/inventory-count` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/inventory-count/buyer/00-initial.png) |
| `/inventory-count` | buyer | console-error | hard | API 404: Not part of the demo data | [view](../../docs/audit/screenshots/inventory-count/buyer/00-initial.png) |
| `/inventory-detail` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/inventory-detail/seller/00-initial.png) |
| `/inventory-incoming` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/inventory-incoming/seller/00-initial.png) |
| `/inventory-incoming` | seller | console-error | hard | API 404: Not part of the demo data | [view](../../docs/audit/screenshots/inventory-incoming/seller/00-initial.png) |
| `/inventory-incoming` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/inventory-incoming/buyer/00-initial.png) |
| `/inventory-incoming` | buyer | console-error | hard | API 404: Not part of the demo data | [view](../../docs/audit/screenshots/inventory-incoming/buyer/00-initial.png) |
| `/inventory-location` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/inventory-location/seller/00-initial.png) |
| `/inventory-transfer` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/inventory-transfer/seller/00-initial.png) |
| `/inventory-transfer` | seller | console-error | hard | API 404: Not part of the demo data | [view](../../docs/audit/screenshots/inventory-transfer/seller/00-initial.png) |
| `/inventory-transfer` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/inventory-transfer/buyer/00-initial.png) |
| `/inventory-transfer` | buyer | console-error | hard | API 404: Not part of the demo data | [view](../../docs/audit/screenshots/inventory-transfer/buyer/00-initial.png) |
| `/inventory` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/inventory/seller/00-initial.png) |
| `/inventory` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/inventory/buyer/00-initial.png) |
| `/ip-report` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/ip-report/seller/00-initial.png) |
| `/languages` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/languages/seller/00-initial.png) |
| `/languages` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/languages/buyer/00-initial.png) |
| `/lifestyle-images` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/lifestyle-images/seller/00-initial.png) |
| `/locations` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/locations/seller/00-initial.png) |
| `/locations` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/locations/buyer/00-initial.png) |
| `/login-activity` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/login-activity/seller/00-initial.png) |
| `/login-activity` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/login-activity/buyer/00-initial.png) |
| `/login-methods` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/login-methods/seller/00-initial.png) |
| `/loyalty` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/loyalty/seller/00-initial.png) |
| `/loyalty` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/loyalty/buyer/00-initial.png) |
| `/meta-ads-connect` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/meta-ads-connect/seller/00-initial.png) |
| `/meta-ads-connect` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/meta-ads-connect/buyer/00-initial.png) |
| `/meta-ads-manage` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/meta-ads-manage/seller/00-initial.png) |
| `/meta-ads-manage` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/meta-ads-manage/buyer/00-initial.png) |
| `/meta-ads-setup` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/meta-ads-setup/seller/00-initial.png) |
| `/meta-ads-setup` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/meta-ads-setup/buyer/00-initial.png) |
| `/metafields` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/metafields/seller/00-initial.png) |
| `/metafields` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/metafields/buyer/00-initial.png) |
| `/mobile-app-builder` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/mobile-app-builder/seller/00-initial.png) |
| `/muted-words` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/muted-words/seller/00-initial.png) |
| `/muted-words` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/muted-words/buyer/00-initial.png) |
| `/navigation-isolation-probe` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/navigation-isolation-probe/seller/00-initial.png) |
| `/onboarding` | seller | error-boundary | hard | Error-boundary fallback UI rendered | [view](../../docs/audit/screenshots/onboarding/seller/00-initial.png) |
| `/onboarding` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/onboarding/seller/00-initial.png) |
| `/onboarding` | seller | console-error | hard | TypeError: t.__internal_state.signUpSignal is not a function
    at http://127.0.0.1:39903/_expo/static/js/web/index-d1fceff539c57743473fb19132db2c2d.js:1626:25 | [view](../../docs/audit/screenshots/onboarding/seller/00-initial.png) |
| `/onboarding` | buyer | error-boundary | hard | Error-boundary fallback UI rendered | [view](../../docs/audit/screenshots/onboarding/buyer/00-initial.png) |
| `/onboarding` | buyer | console-error | hard | TypeError: t.__internal_state.signUpSignal is not a function
    at http://127.0.0.1:39903/_expo/static/js/web/index-d1fceff539c57743473fb19132db2c2d.js:1626:25 | [view](../../docs/audit/screenshots/onboarding/buyer/00-initial.png) |
| `/payments` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/payments/seller/00-initial.png) |
| `/payments` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/payments/buyer/00-initial.png) |
| `/payouts` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/payouts/seller/00-initial.png) |
| `/payouts` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/payouts/buyer/00-initial.png) |
| `/plans` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/plans/seller/00-initial.png) |
| `/push-notifications` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/push-notifications/seller/00-initial.png) |
| `/quote-compare` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/quote-compare/seller/00-initial.png) |
| `/quote-compare` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/quote-compare/buyer/00-initial.png) |
| `/quote-detail` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/quote-detail/seller/00-initial.png) |
| `/quote-detail` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/quote-detail/buyer/00-initial.png) |
| `/quote-request` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/quote-request/seller/00-initial.png) |
| `/refund-detail` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/refund-detail/seller/00-initial.png) |
| `/refund-detail` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/refund-detail/buyer/00-initial.png) |
| `/return-detail` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/return-detail/seller/00-initial.png) |
| `/return-detail` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/return-detail/buyer/00-initial.png) |
| `/return-request` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/return-request/seller/00-initial.png) |
| `/rfq-compare` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/rfq-compare/seller/00-initial.png) |
| `/rfq-compare` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/rfq-compare/buyer/00-initial.png) |
| `/rfq-list` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/rfq-list/seller/00-initial.png) |
| `/rfq-list` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/rfq-list/buyer/00-initial.png) |
| `/rfq-post` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/rfq-post/seller/00-initial.png) |
| `/rfq-post` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/rfq-post/buyer/00-initial.png) |
| `/roles` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/roles/seller/00-initial.png) |
| `/roles` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/roles/buyer/00-initial.png) |
| `/sample-detail` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/sample-detail/seller/00-initial.png) |
| `/sample-detail` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/sample-detail/buyer/00-initial.png) |
| `/(buyer)/activity` | seller | overlapping-text | warn | "Priya Shah" overlaps "started following you" | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | overlapping-text | warn | "started following you" overlaps "6h" | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | overlapping-text | warn | "Marcus Webb" overlaps "started following you" | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | overlapping-text | warn | "started following you" overlaps "1d" | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Activity" | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Follow back" | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Follow back" | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | hit-target-too-small | warn | 41x34px control "All" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | hit-target-too-small | warn | 74x34px control "Follows" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | hit-target-too-small | warn | 58x34px control "Likes" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | hit-target-too-small | warn | 95x34px control "Comments" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | hit-target-too-small | warn | 69x34px control "Orders" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | hit-target-too-small | warn | 234x40px control "PSPriya Shah started following you  6h" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | hit-target-too-small | warn | 115x32px control "Follow back" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | hit-target-too-small | warn | 234x40px control "MWMarcus Webb started following you  1d" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | hit-target-too-small | warn | 115x32px control "Follow back" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | hit-target-too-small | warn | 305x40px control "JLJordan Lee liked your post  3d" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | buyer | overlapping-text | warn | "Priya Shah" overlaps "started following you" | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | overlapping-text | warn | "started following you" overlaps "6h" | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | overlapping-text | warn | "Marcus Webb" overlaps "started following you" | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | overlapping-text | warn | "started following you" overlaps "1d" | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Activity" | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Follow back" | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Follow back" | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | hit-target-too-small | warn | 41x34px control "All" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | hit-target-too-small | warn | 74x34px control "Follows" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | hit-target-too-small | warn | 58x34px control "Likes" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | hit-target-too-small | warn | 95x34px control "Comments" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | hit-target-too-small | warn | 69x34px control "Orders" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | hit-target-too-small | warn | 234x40px control "PSPriya Shah started following you  6h" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | hit-target-too-small | warn | 115x32px control "Follow back" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | hit-target-too-small | warn | 234x40px control "MWMarcus Webb started following you  1d" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | hit-target-too-small | warn | 115x32px control "Follow back" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | hit-target-too-small | warn | 305x40px control "JLJordan Lee liked your post  3d" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/following` | seller | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Following" | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Northline Studio" | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "0 orders placed so far." | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Shop drop" | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Field Office" | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "0 orders placed so far." | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "View drop" | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | contrast-violation | warn | contrast 1.41:1 (need 4.5:1) for "Live" — rgb(51, 51, 56) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | contrast-violation | warn | contrast 1.40:1 (need 4.5:1) for "Live now" — rgb(255, 255, 255) on rgba(127, 240, 176, 0.8) | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | contrast-violation | warn | contrast 1.64:1 (need 4.5:1) for "Upcoming" — rgb(61, 61, 66) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | buyer | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Following" | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Northline Studio" | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "0 orders placed so far." | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Shop drop" | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Field Office" | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "0 orders placed so far." | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "View drop" | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | contrast-violation | warn | contrast 1.41:1 (need 4.5:1) for "Live" — rgb(51, 51, 56) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | contrast-violation | warn | contrast 1.40:1 (need 4.5:1) for "Live now" — rgb(255, 255, 255) on rgba(127, 240, 176, 0.8) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | contrast-violation | warn | contrast 1.64:1 (need 4.5:1) for "Upcoming" — rgb(61, 61, 66) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/friends` | seller | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Friends" | [view](../../docs/audit/screenshots/-buyer-friends/seller/00-initial.png) |
| `/(buyer)/friends` | buyer | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Friends" | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "See all" | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "See all" | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "MF" | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | hit-target-too-small | warn | 43x44px control "See all" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | hit-target-too-small | warn | 24x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | hit-target-too-small | warn | 24x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | hit-target-too-small | warn | 24x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | hit-target-too-small | warn | 43x44px control "See all" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)` | seller | overlapping-text | warn | "Check back soon for new drops" overlaps "Hold the right side" | [view](../../docs/audit/screenshots/-buyer-/seller/00-initial.png) |
| `/(buyer)` | seller | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "2x" | [view](../../docs/audit/screenshots/-buyer-/seller/00-initial.png) |
| `/(buyer)` | seller | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/seller/00-initial.png) |
| `/(buyer)` | seller | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/seller/00-initial.png) |
| `/(buyer)` | seller | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/seller/00-initial.png) |
| `/(buyer)` | seller | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/seller/00-initial.png) |
| `/(buyer)` | seller | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/seller/00-initial.png) |
| `/(buyer)` | buyer | clipped-text | warn | Text clipped (71px into 62px): "$220.00 +1" | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | overlapping-text | warn | "NO" overlaps "2x speed" | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Northline Studio" | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Drop 04 is live. Ember season, cut heavy and made to last." | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "2x" | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | hit-target-too-small | warn | 38x38px control "NO" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | hit-target-too-small | warn | 14x14px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | hit-target-too-small | warn | 38x44px control "612" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | hit-target-too-small | warn | 38x44px control "1,290" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |

### Seller dashboard / analytics (329)

| Route | Role | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|
| `/(tabs)/analytics` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/feed` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-tabs-feed/seller/00-initial.png) |
| `/(tabs)/following` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)/marketing` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-tabs-marketing/seller/00-initial.png) |
| `/(tabs)/marketing` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-tabs-marketing/buyer/00-initial.png) |
| `/(tabs)/more` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-tabs-more/seller/00-initial.png) |
| `/(tabs)/orders` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-tabs-orders/seller/00-initial.png) |
| `/(tabs)/products` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-tabs-products/seller/00-initial.png) |
| `/(tabs)/profile` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-tabs-profile/seller/00-initial.png) |
| `/(tabs)/profile` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-tabs-profile/buyer/00-initial.png) |
| `/(tabs)/studio` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-tabs-studio/seller/00-initial.png) |
| `/analytics-content` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/analytics-content/seller/00-initial.png) |
| `/analytics-customers` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/analytics-customers/seller/00-initial.png) |
| `/analytics-customers` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/analytics-customers/buyer/00-initial.png) |
| `/analytics-inventory` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/analytics-inventory/seller/00-initial.png) |
| `/analytics-marketing` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/analytics-marketing/seller/00-initial.png) |
| `/analytics-production` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/analytics-production/seller/00-initial.png) |
| `/analytics-products` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/analytics-products/seller/00-initial.png) |
| `/analytics-products` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/analytics-products/buyer/00-initial.png) |
| `/analytics-profit` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/analytics-profit/seller/00-initial.png) |
| `/analytics-sales` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/analytics-sales/seller/00-initial.png) |
| `/analytics-sales` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/analytics-sales/buyer/00-initial.png) |
| `/analytics-store` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/analytics-store/seller/00-initial.png) |
| `/post-analytics` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/post-analytics/seller/00-initial.png) |
| `/seller-conversation` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/seller-conversation/seller/00-initial.png) |
| `/seller-data-export` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/seller-data-export/seller/00-initial.png) |
| `/seller-drop-create` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/seller-drop-create/seller/00-initial.png) |
| `/seller-drop-create` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/seller-drop-create/buyer/00-initial.png) |
| `/seller-drop-preview` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/seller-drop-preview/seller/00-initial.png) |
| `/seller-drop-preview` | seller | console-error | hard | API 404: Not part of the demo data | [view](../../docs/audit/screenshots/seller-drop-preview/seller/00-initial.png) |
| `/seller-drop-preview` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/seller-drop-preview/buyer/00-initial.png) |
| `/seller-drop-preview` | buyer | console-error | hard | API 404: Not part of the demo data | [view](../../docs/audit/screenshots/seller-drop-preview/buyer/00-initial.png) |
| `/seller-drops` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/seller-drops/seller/00-initial.png) |
| `/seller-drops` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/seller-drops/buyer/00-initial.png) |
| `/seller-go-live` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/seller-go-live/seller/00-initial.png) |
| `/seller-inbox` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/seller-inbox/seller/00-initial.png) |
| `/seller-live` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/seller-live/seller/00-initial.png) |
| `/seller-profile` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/seller-profile/seller/00-initial.png) |
| `/(tabs)/analytics` | seller | type-scale-drift | warn | font-size 28px not on declared FS scale (nearest 26) on "Analytics" | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | seller | contrast-violation | warn | contrast 1.19:1 (need 4.5:1) for "$0" — rgb(0, 0, 0) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | seller | contrast-violation | warn | contrast 1.19:1 (need 4.5:1) for "Sep 12" — rgb(0, 0, 0) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | seller | contrast-violation | warn | contrast 1.19:1 (need 4.5:1) for "Sep 13" — rgb(0, 0, 0) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | seller | contrast-violation | warn | contrast 1.19:1 (need 4.5:1) for "Sep 14" — rgb(0, 0, 0) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | seller | contrast-violation | warn | contrast 1.19:1 (need 4.5:1) for "Sep 15" — rgb(0, 0, 0) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | seller | contrast-violation | warn | contrast 1.19:1 (need 4.5:1) for "Sep 16" — rgb(0, 0, 0) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | seller | contrast-violation | warn | contrast 1.19:1 (need 4.5:1) for "Sep 17" — rgb(0, 0, 0) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | seller | contrast-violation | warn | contrast 1.19:1 (need 4.5:1) for "Sep 18" — rgb(0, 0, 0) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | buyer | type-scale-drift | warn | font-size 28px not on declared FS scale (nearest 26) on "Analytics" | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/analytics` | buyer | contrast-violation | warn | contrast 1.19:1 (need 4.5:1) for "$0" — rgb(0, 0, 0) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/analytics` | buyer | contrast-violation | warn | contrast 1.19:1 (need 4.5:1) for "Sep 12" — rgb(0, 0, 0) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/analytics` | buyer | contrast-violation | warn | contrast 1.19:1 (need 4.5:1) for "Sep 13" — rgb(0, 0, 0) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/analytics` | buyer | contrast-violation | warn | contrast 1.19:1 (need 4.5:1) for "Sep 14" — rgb(0, 0, 0) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/analytics` | buyer | contrast-violation | warn | contrast 1.19:1 (need 4.5:1) for "Sep 15" — rgb(0, 0, 0) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/analytics` | buyer | contrast-violation | warn | contrast 1.19:1 (need 4.5:1) for "Sep 16" — rgb(0, 0, 0) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/analytics` | buyer | contrast-violation | warn | contrast 1.19:1 (need 4.5:1) for "Sep 17" — rgb(0, 0, 0) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/analytics` | buyer | contrast-violation | warn | contrast 1.19:1 (need 4.5:1) for "Sep 18" — rgb(0, 0, 0) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/feed` | seller | hit-target-too-small | warn | 34x34px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/seller/00-initial.png) |
| `/(tabs)/feed` | seller | hit-target-too-small | warn | 34x34px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/seller/00-initial.png) |
| `/(tabs)/feed` | seller | hit-target-too-small | warn | 60x25px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/seller/00-initial.png) |
| `/(tabs)/feed` | seller | hit-target-too-small | warn | 52x25px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/seller/00-initial.png) |
| `/(tabs)/feed` | buyer | clipped-text | warn | Text clipped (71px into 62px): "$220.00 +1" | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Northline Studio" | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Drop 04 is live. Ember season, cut heavy and made to last." | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | hit-target-too-small | warn | 38x38px control "NO" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | hit-target-too-small | warn | 14x14px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | hit-target-too-small | warn | 38x44px control "612" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | hit-target-too-small | warn | 38x44px control "1,290" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | hit-target-too-small | warn | 78x32px control "ShopField Shell Jacket — Rust$220.00 +1" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | hit-target-too-small | warn | 293x36px control "Northline Studio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | hit-target-too-small | warn | 215x24px control "Original Sound · northlinestudio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | hit-target-too-small | warn | 34x34px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | hit-target-too-small | warn | 34x34px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | hit-target-too-small | warn | 60x25px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | hit-target-too-small | warn | 52x25px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/following` | seller | overlapping-text | warn | "0 orders placed so far." overlaps "2" | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Following" | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Northline Studio" | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "0 orders placed so far." | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Shop drop" | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Field Office" | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "0 orders placed so far." | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "View drop" | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | contrast-violation | warn | contrast 1.41:1 (need 4.5:1) for "Live" — rgb(51, 51, 56) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | contrast-violation | warn | contrast 1.40:1 (need 4.5:1) for "Live now" — rgb(255, 255, 255) on rgba(127, 240, 176, 0.8) | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | contrast-violation | warn | contrast 1.64:1 (need 4.5:1) for "Upcoming" — rgb(61, 61, 66) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | buyer | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Following" | [view](../../docs/audit/screenshots/-tabs-following/buyer/00-initial.png) |
| `/(tabs)/following` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Northline Studio" | [view](../../docs/audit/screenshots/-tabs-following/buyer/00-initial.png) |
| `/(tabs)/following` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "0 orders placed so far." | [view](../../docs/audit/screenshots/-tabs-following/buyer/00-initial.png) |
| `/(tabs)/following` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Shop drop" | [view](../../docs/audit/screenshots/-tabs-following/buyer/00-initial.png) |
| `/(tabs)/following` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Field Office" | [view](../../docs/audit/screenshots/-tabs-following/buyer/00-initial.png) |
| `/(tabs)/following` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "0 orders placed so far." | [view](../../docs/audit/screenshots/-tabs-following/buyer/00-initial.png) |
| `/(tabs)/following` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "View drop" | [view](../../docs/audit/screenshots/-tabs-following/buyer/00-initial.png) |
| `/(tabs)/following` | buyer | contrast-violation | warn | contrast 1.41:1 (need 4.5:1) for "Live" — rgb(51, 51, 56) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/-tabs-following/buyer/00-initial.png) |
| `/(tabs)/following` | buyer | contrast-violation | warn | contrast 1.40:1 (need 4.5:1) for "Live now" — rgb(255, 255, 255) on rgba(127, 240, 176, 0.8) | [view](../../docs/audit/screenshots/-tabs-following/buyer/00-initial.png) |
| `/(tabs)/following` | buyer | contrast-violation | warn | contrast 1.64:1 (need 4.5:1) for "Upcoming" — rgb(61, 61, 66) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/-tabs-following/buyer/00-initial.png) |
| `/(tabs)` | seller | clipped-text | warn | Text clipped (323px into 285px): "Finish seller signup and onboarding to open your workspace" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | overlapping-text | warn | "Week" overlaps "Add your first product" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | overlapping-text | warn | "Month" overlaps "Add your first product" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | overlapping-text | warn | "Year" overlaps "Add your first product" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | overlapping-text | warn | "All" overlaps "Add your first product" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | overlapping-text | warn | "Sun" overlaps "Create a product and add it to your catalog" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | overlapping-text | warn | "Mon" overlaps "Create a product and add it to your catalog" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | overlapping-text | warn | "Tue" overlaps "Create a product and add it to your catalog" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | overlapping-text | warn | "Wed" overlaps "Create a product and add it to your catalog" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | overlapping-text | warn | "Thu" overlaps "Create a product and add it to your catalog" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | overlapping-text | warn | "171" overlaps "Customize your storefront" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | overlapping-text | warn | "9,876" overlaps "Customize your storefront" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | overlapping-text | warn | "1.7%" overlaps "Publish your storefront" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | overlapping-text | warn | "↑ New" overlaps "Make your store live and visible to buyers" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | overlapping-text | warn | "$97.86" overlaps "Publish your storefront" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | overlapping-text | warn | "↑ New" overlaps "Make your store live and visible to buyers" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | overlapping-text | warn | "Available balance" overlaps "Connect a manufacturer (optional)" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | overlapping-text | warn | "$1,842.50" overlaps "Find or invite a manufacturer to produce your drops" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | overlapping-text | warn | "Withdraw" overlaps "Connect a manufacturer (optional)" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | overlapping-text | warn | "Some dashboard data couldn’t load." overlaps "Done" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | overlapping-text | warn | "Traffic sources" overlaps "2" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | overlapping-text | warn | "2" overlaps "Continue setup later" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Dashboard" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | type-scale-drift | warn | font-size 52px not on declared FS scale (nearest 36) on "$16.6K" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | type-scale-drift | warn | font-size 9px not on declared FS scale (nearest 11) on "Sat" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | type-scale-drift | warn | font-size 9px not on declared FS scale (nearest 11) on "Sun" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | type-scale-drift | warn | font-size 9px not on declared FS scale (nearest 11) on "Mon" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | type-scale-drift | warn | font-size 9px not on declared FS scale (nearest 11) on "Tue" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | type-scale-drift | warn | font-size 9px not on declared FS scale (nearest 11) on "Wed" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | type-scale-drift | warn | font-size 9px not on declared FS scale (nearest 11) on "Thu" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | type-scale-drift | warn | font-size 9px not on declared FS scale (nearest 11) on "Fri" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | min-size-violation | warn | font-size 9px below the 11pt caption floor on "Sat" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | min-size-violation | warn | font-size 9px below the 11pt caption floor on "Sun" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | min-size-violation | warn | font-size 9px below the 11pt caption floor on "Mon" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | min-size-violation | warn | font-size 9px below the 11pt caption floor on "Tue" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | min-size-violation | warn | font-size 9px below the 11pt caption floor on "Wed" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | min-size-violation | warn | font-size 9px below the 11pt caption floor on "Thu" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | min-size-violation | warn | font-size 9px below the 11pt caption floor on "Fri" | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | hit-target-too-small | warn | 69x36px control "Today" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | hit-target-too-small | warn | 69x36px control "Week" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | hit-target-too-small | warn | 69x36px control "Month" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | hit-target-too-small | warn | 69x36px control "Year" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | hit-target-too-small | warn | 69x36px control "All" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | hit-target-too-small | warn | 94x40px control "Withdraw" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | hit-target-too-small | warn | 35x16px control "Retry" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | seller | hit-target-too-small | warn | 20x23px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-/seller/00-initial.png) |
| `/(tabs)` | buyer | clipped-text | warn | Text clipped (323px into 254px): "Finish seller signup and onboarding to open your workspace" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | clipped-text | warn | Text clipped (274px into 254px): "Configure your shipping zones and rates for buyers" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | clipped-text | warn | Text clipped (299px into 254px): "Verify a custom domain you already own from a registrar" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | clipped-text | warn | Text clipped (264px into 254px): "Share content to the Thread feed to attract buyers" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | clipped-text | warn | Text clipped (275px into 254px): "Find or invite a manufacturer to produce your drops" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | overlapping-text | warn | "Week" overlaps "Add your first product" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | overlapping-text | warn | "Month" overlaps "Add your first product" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | overlapping-text | warn | "Year" overlaps "Add your first product" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | overlapping-text | warn | "Sun" overlaps "Create a product and add it to your catalog" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | overlapping-text | warn | "Mon" overlaps "Create a product and add it to your catalog" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | overlapping-text | warn | "Tue" overlaps "Create a product and add it to your catalog" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | overlapping-text | warn | "Wed" overlaps "Create a product and add it to your catalog" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | overlapping-text | warn | "Thu" overlaps "Create a product and add it to your catalog" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | overlapping-text | warn | "171" overlaps "Customize your storefront" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | overlapping-text | warn | "9,876" overlaps "Customize your storefront" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | overlapping-text | warn | "1.7%" overlaps "Publish your storefront" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | overlapping-text | warn | "↑ New" overlaps "Make your store live and visible to buyers" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | overlapping-text | warn | "$97.86" overlaps "Publish your storefront" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | overlapping-text | warn | "↑ New" overlaps "Make your store live and visible to buyers" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | overlapping-text | warn | "Available balance" overlaps "Connect a manufacturer (optional)" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | overlapping-text | warn | "$1,842.50" overlaps "Find or invite a manufacturer to produce your drops" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | overlapping-text | warn | "Withdraw" overlaps "Skip" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | overlapping-text | warn | "Some dashboard data couldn’t load." overlaps "Continue: Create your seller account" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | overlapping-text | warn | "Traffic sources" overlaps "Continue setup later" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Dashboard" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | type-scale-drift | warn | font-size 52px not on declared FS scale (nearest 36) on "$16.7K" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | type-scale-drift | warn | font-size 9px not on declared FS scale (nearest 11) on "Sat" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | type-scale-drift | warn | font-size 9px not on declared FS scale (nearest 11) on "Sun" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | type-scale-drift | warn | font-size 9px not on declared FS scale (nearest 11) on "Mon" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | type-scale-drift | warn | font-size 9px not on declared FS scale (nearest 11) on "Tue" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | type-scale-drift | warn | font-size 9px not on declared FS scale (nearest 11) on "Wed" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | type-scale-drift | warn | font-size 9px not on declared FS scale (nearest 11) on "Thu" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | type-scale-drift | warn | font-size 9px not on declared FS scale (nearest 11) on "Fri" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | min-size-violation | warn | font-size 9px below the 11pt caption floor on "Sat" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | min-size-violation | warn | font-size 9px below the 11pt caption floor on "Sun" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | min-size-violation | warn | font-size 9px below the 11pt caption floor on "Mon" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | min-size-violation | warn | font-size 9px below the 11pt caption floor on "Tue" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | min-size-violation | warn | font-size 9px below the 11pt caption floor on "Wed" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | min-size-violation | warn | font-size 9px below the 11pt caption floor on "Thu" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | min-size-violation | warn | font-size 9px below the 11pt caption floor on "Fri" | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | hit-target-too-small | warn | 69x36px control "Today" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | hit-target-too-small | warn | 69x36px control "Week" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | hit-target-too-small | warn | 69x36px control "Month" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | hit-target-too-small | warn | 69x36px control "Year" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | hit-target-too-small | warn | 69x36px control "All" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | hit-target-too-small | warn | 94x40px control "Withdraw" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | hit-target-too-small | warn | 35x16px control "Retry" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)` | buyer | hit-target-too-small | warn | 20x23px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-/buyer/00-initial.png) |
| `/(tabs)/marketing` | seller | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "0" | [view](../../docs/audit/screenshots/-tabs-marketing/seller/00-initial.png) |
| `/(tabs)/marketing` | seller | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "0" | [view](../../docs/audit/screenshots/-tabs-marketing/seller/00-initial.png) |
| `/(tabs)/marketing` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Connect Klaviyo: Email Marketing & SMS" | [view](../../docs/audit/screenshots/-tabs-marketing/seller/00-initial.png) |
| `/(tabs)/marketing` | seller | contrast-violation | warn | contrast 1.12:1 (need 4.5:1) for "Create a campaign" — rgb(10, 10, 11) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/-tabs-marketing/seller/00-initial.png) |
| `/(tabs)/marketing` | seller | contrast-violation | warn | contrast 1.12:1 (need 4.5:1) for "Create a discount" — rgb(10, 10, 11) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/-tabs-marketing/seller/00-initial.png) |
| `/(tabs)/marketing` | buyer | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "0" | [view](../../docs/audit/screenshots/-tabs-marketing/buyer/00-initial.png) |
| `/(tabs)/marketing` | buyer | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "0" | [view](../../docs/audit/screenshots/-tabs-marketing/buyer/00-initial.png) |
| `/(tabs)/marketing` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Connect Klaviyo: Email Marketing & SMS" | [view](../../docs/audit/screenshots/-tabs-marketing/buyer/00-initial.png) |
| `/(tabs)/marketing` | buyer | contrast-violation | warn | contrast 1.12:1 (need 4.5:1) for "Create a campaign" — rgb(10, 10, 11) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/-tabs-marketing/buyer/00-initial.png) |
| `/(tabs)/marketing` | buyer | contrast-violation | warn | contrast 1.12:1 (need 4.5:1) for "Create a discount" — rgb(10, 10, 11) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/-tabs-marketing/buyer/00-initial.png) |
| `/(tabs)/orders` | seller | color-rule-violation | warn | Non-monochrome, non-allowed color rgb(255, 213, 128) on "NEW" | [view](../../docs/audit/screenshots/-tabs-orders/seller/00-initial.png) |
| `/(tabs)/orders` | seller | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Orders" | [view](../../docs/audit/screenshots/-tabs-orders/seller/00-initial.png) |
| `/(tabs)/orders` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Accept" | [view](../../docs/audit/screenshots/-tabs-orders/seller/00-initial.png) |
| `/(tabs)/orders` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Accept" | [view](../../docs/audit/screenshots/-tabs-orders/seller/00-initial.png) |
| `/(tabs)/orders` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Ready" | [view](../../docs/audit/screenshots/-tabs-orders/seller/00-initial.png) |
| `/(tabs)/orders` | seller | hit-target-too-small | warn | 87x24px control "Orders" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-orders/seller/00-initial.png) |
| `/(tabs)/orders` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-orders/seller/00-initial.png) |
| `/(tabs)/orders` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-orders/seller/00-initial.png) |
| `/(tabs)/orders` | seller | hit-target-too-small | warn | 121x36px control "Accept" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-orders/seller/00-initial.png) |
| `/(tabs)/orders` | seller | hit-target-too-small | warn | 121x36px control "Accept" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-orders/seller/00-initial.png) |
| `/(tabs)/orders` | seller | hit-target-too-small | warn | 115x36px control "Ready" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-orders/seller/00-initial.png) |
| `/(tabs)/orders` | seller | hit-target-too-small | warn | 103x36px control "Ship" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-orders/seller/00-initial.png) |
| `/(tabs)/orders` | buyer | color-rule-violation | warn | Non-monochrome, non-allowed color rgb(255, 213, 128) on "NEW" | [view](../../docs/audit/screenshots/-tabs-orders/buyer/00-initial.png) |
| `/(tabs)/orders` | buyer | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Orders" | [view](../../docs/audit/screenshots/-tabs-orders/buyer/00-initial.png) |
| `/(tabs)/orders` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Accept" | [view](../../docs/audit/screenshots/-tabs-orders/buyer/00-initial.png) |
| `/(tabs)/orders` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Accept" | [view](../../docs/audit/screenshots/-tabs-orders/buyer/00-initial.png) |
| `/(tabs)/orders` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Ready" | [view](../../docs/audit/screenshots/-tabs-orders/buyer/00-initial.png) |
| `/(tabs)/orders` | buyer | hit-target-too-small | warn | 87x24px control "Orders" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-orders/buyer/00-initial.png) |
| `/(tabs)/orders` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-orders/buyer/00-initial.png) |
| `/(tabs)/orders` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-orders/buyer/00-initial.png) |
| `/(tabs)/orders` | buyer | hit-target-too-small | warn | 121x36px control "Accept" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-orders/buyer/00-initial.png) |
| `/(tabs)/orders` | buyer | hit-target-too-small | warn | 121x36px control "Accept" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-orders/buyer/00-initial.png) |
| `/(tabs)/orders` | buyer | hit-target-too-small | warn | 115x36px control "Ready" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-orders/buyer/00-initial.png) |
| `/(tabs)/orders` | buyer | hit-target-too-small | warn | 103x36px control "Ship" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-orders/buyer/00-initial.png) |
| `/(tabs)/products` | seller | clipped-text | warn | Text clipped (189px into 159px): "Heavyweight Hoodie — Ember" | [view](../../docs/audit/screenshots/-tabs-products/seller/00-initial.png) |
| `/(tabs)/products` | seller | clipped-text | warn | Text clipped (183px into 159px): "Heavyweight Hoodie — Moss" | [view](../../docs/audit/screenshots/-tabs-products/seller/00-initial.png) |
| `/(tabs)/products` | seller | color-rule-violation | warn | Non-monochrome, non-allowed color rgb(249, 115, 22) on "Draft" | [view](../../docs/audit/screenshots/-tabs-products/seller/00-initial.png) |
| `/(tabs)/products` | seller | color-rule-violation | warn | Non-monochrome, non-allowed color rgb(16, 185, 129) on "Active" | [view](../../docs/audit/screenshots/-tabs-products/seller/00-initial.png) |
| `/(tabs)/products` | seller | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Products" | [view](../../docs/audit/screenshots/-tabs-products/seller/00-initial.png) |
| `/(tabs)/products` | seller | hit-target-too-small | warn | 36x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-products/seller/00-initial.png) |
| `/(tabs)/products` | seller | hit-target-too-small | warn | 36x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-products/seller/00-initial.png) |
| `/(tabs)/products` | buyer | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Products" | [view](../../docs/audit/screenshots/-tabs-products/buyer/00-initial.png) |
| `/(tabs)/products` | buyer | hit-target-too-small | warn | 36x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-products/buyer/00-initial.png) |
| `/(tabs)/products` | buyer | hit-target-too-small | warn | 36x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-products/buyer/00-initial.png) |
| `/(tabs)/profile` | seller | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "Northline Studio" | [view](../../docs/audit/screenshots/-tabs-profile/seller/00-initial.png) |
| `/(tabs)/profile` | seller | hit-target-too-small | warn | 22x22px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-profile/seller/00-initial.png) |
| `/(tabs)/profile` | seller | hit-target-too-small | warn | 60x38px control "1,280Followers" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-profile/seller/00-initial.png) |
| `/(tabs)/profile` | seller | hit-target-too-small | warn | 59x38px control "340Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-profile/seller/00-initial.png) |
| `/(tabs)/profile` | buyer | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "Northline Studio" | [view](../../docs/audit/screenshots/-tabs-profile/buyer/00-initial.png) |
| `/(tabs)/profile` | buyer | hit-target-too-small | warn | 22x22px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-profile/buyer/00-initial.png) |
| `/(tabs)/profile` | buyer | hit-target-too-small | warn | 60x38px control "1,280Followers" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-profile/buyer/00-initial.png) |
| `/(tabs)/profile` | buyer | hit-target-too-small | warn | 59x38px control "340Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-profile/buyer/00-initial.png) |
| `/(tabs)/studio` | seller | overlapping-text | warn | "Describe your idea and create unique designs." overlaps "2" | [view](../../docs/audit/screenshots/-tabs-studio/seller/00-initial.png) |
| `/(tabs)/studio` | seller | color-rule-violation | warn | Non-monochrome, non-allowed color rgb(249, 115, 22) on "Open →" | [view](../../docs/audit/screenshots/-tabs-studio/seller/00-initial.png) |
| `/(tabs)/studio` | seller | color-rule-violation | warn | Non-monochrome, non-allowed color rgb(16, 185, 129) on "Open →" | [view](../../docs/audit/screenshots/-tabs-studio/seller/00-initial.png) |
| `/(tabs)/studio` | seller | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Studio" | [view](../../docs/audit/screenshots/-tabs-studio/seller/00-initial.png) |
| `/(tabs)/studio` | buyer | color-rule-violation | warn | Non-monochrome, non-allowed color rgb(249, 115, 22) on "Open →" | [view](../../docs/audit/screenshots/-tabs-studio/buyer/00-initial.png) |
| `/(tabs)/studio` | buyer | color-rule-violation | warn | Non-monochrome, non-allowed color rgb(16, 185, 129) on "Open →" | [view](../../docs/audit/screenshots/-tabs-studio/buyer/00-initial.png) |
| `/(tabs)/studio` | buyer | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Studio" | [view](../../docs/audit/screenshots/-tabs-studio/buyer/00-initial.png) |
| `/analytics-profit` | seller | hit-target-too-small | warn | 51x36px control "Profit" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/analytics-profit/seller/00-initial.png) |
| `/analytics-profit` | seller | hit-target-too-small | warn | 65x36px control "Payouts" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/analytics-profit/seller/00-initial.png) |
| `/analytics-profit` | seller | hit-target-too-small | warn | 281x36px control "Couldn't load profit data — Tap to retry" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/analytics-profit/seller/00-initial.png) |
| `/analytics-profit` | buyer | hit-target-too-small | warn | 51x36px control "Profit" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/analytics-profit/buyer/00-initial.png) |
| `/analytics-profit` | buyer | hit-target-too-small | warn | 65x36px control "Payouts" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/analytics-profit/buyer/00-initial.png) |
| `/analytics-profit` | buyer | hit-target-too-small | warn | 281x36px control "Couldn't load profit data — Tap to retry" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/analytics-profit/buyer/00-initial.png) |
| `/post-analytics` | seller | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Try again" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/post-analytics/seller/00-initial.png) |
| `/post-analytics` | buyer | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Try again" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/post-analytics/buyer/00-initial.png) |
| `/seller-conversation` | seller | hit-target-too-small | warn | 32x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/seller-conversation/seller/00-initial.png) |
| `/seller-conversation` | seller | hit-target-too-small | warn | 43x44px control "Buyer" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/seller-conversation/seller/00-initial.png) |
| `/seller-conversation` | seller | hit-target-too-small | warn | 36x46px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/seller-conversation/seller/00-initial.png) |
| `/seller-conversation` | seller | hit-target-too-small | warn | 36x46px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/seller-conversation/seller/00-initial.png) |
| `/seller-conversation` | seller | hit-target-too-small | warn | 36x46px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/seller-conversation/seller/00-initial.png) |
| `/seller-conversation` | buyer | hit-target-too-small | warn | 32x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/seller-conversation/buyer/00-initial.png) |
| `/seller-conversation` | buyer | hit-target-too-small | warn | 43x44px control "Buyer" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/seller-conversation/buyer/00-initial.png) |
| `/seller-conversation` | buyer | hit-target-too-small | warn | 36x46px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/seller-conversation/buyer/00-initial.png) |
| `/seller-conversation` | buyer | hit-target-too-small | warn | 36x46px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/seller-conversation/buyer/00-initial.png) |
| `/seller-conversation` | buyer | hit-target-too-small | warn | 36x46px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/seller-conversation/buyer/00-initial.png) |
| `/seller-data-export` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Products" | [view](../../docs/audit/screenshots/seller-data-export/seller/00-initial.png) |
| `/seller-data-export` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Orders" | [view](../../docs/audit/screenshots/seller-data-export/seller/00-initial.png) |
| `/seller-data-export` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Customers" | [view](../../docs/audit/screenshots/seller-data-export/seller/00-initial.png) |
| `/seller-data-export` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "JSON" | [view](../../docs/audit/screenshots/seller-data-export/seller/00-initial.png) |
| `/seller-data-export` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "CSV" | [view](../../docs/audit/screenshots/seller-data-export/seller/00-initial.png) |
| `/seller-data-export` | seller | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Generate Export" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/seller-data-export/seller/00-initial.png) |
| `/seller-data-export` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/seller-data-export/seller/00-initial.png) |
| `/seller-data-export` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Products" | [view](../../docs/audit/screenshots/seller-data-export/buyer/00-initial.png) |
| `/seller-data-export` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Orders" | [view](../../docs/audit/screenshots/seller-data-export/buyer/00-initial.png) |
| `/seller-data-export` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Customers" | [view](../../docs/audit/screenshots/seller-data-export/buyer/00-initial.png) |
| `/seller-data-export` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "JSON" | [view](../../docs/audit/screenshots/seller-data-export/buyer/00-initial.png) |
| `/seller-data-export` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "CSV" | [view](../../docs/audit/screenshots/seller-data-export/buyer/00-initial.png) |
| `/seller-data-export` | buyer | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Generate Export" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/seller-data-export/buyer/00-initial.png) |
| `/seller-data-export` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/seller-data-export/buyer/00-initial.png) |
| `/seller-drop-create` | seller | overlapping-text | warn | "Add a product first, then come back to include it." overlaps "2" | [view](../../docs/audit/screenshots/seller-drop-create/seller/00-initial.png) |
| `/seller-drop-create` | seller | font-family | warn | Non-Inter font-family "-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif" on "This is the wall-clock time in the timezone abov | [view](../../docs/audit/screenshots/seller-drop-create/seller/00-initial.png) |
| `/seller-drop-create` | seller | font-family | warn | Non-Inter font-family "-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif" on "Add a product first, then come back to include i | [view](../../docs/audit/screenshots/seller-drop-create/seller/00-initial.png) |
| `/seller-drop-create` | seller | font-family | warn | Non-Inter font-family "-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif" on "Limited quantity per product is set via each pro | [view](../../docs/audit/screenshots/seller-drop-create/seller/00-initial.png) |
| `/seller-drop-create` | seller | hit-target-too-small | warn | 69x40px control "Today" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/seller-drop-create/seller/00-initial.png) |
| `/seller-drop-create` | seller | hit-target-too-small | warn | 95x40px control "Tomorrow" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/seller-drop-create/seller/00-initial.png) |
| `/seller-drop-create` | seller | hit-target-too-small | warn | 105x40px control "Sun, Sep 20" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/seller-drop-create/seller/00-initial.png) |
| `/seller-drop-create` | seller | hit-target-too-small | warn | 106x40px control "Mon, Sep 21" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/seller-drop-create/seller/00-initial.png) |
| `/seller-drop-create` | seller | hit-target-too-small | warn | 90x40px control "12:00 AM" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/seller-drop-create/seller/00-initial.png) |
| `/seller-drop-create` | seller | hit-target-too-small | warn | 89x40px control "12:30 AM" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/seller-drop-create/seller/00-initial.png) |
| `/seller-drop-create` | seller | hit-target-too-small | warn | 82x40px control "1:00 AM" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/seller-drop-create/seller/00-initial.png) |
| `/seller-drop-create` | seller | hit-target-too-small | warn | 81x40px control "1:30 AM" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/seller-drop-create/seller/00-initial.png) |
| `/seller-drop-create` | seller | hit-target-too-small | warn | 84x40px control "2:00 AM" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/seller-drop-create/seller/00-initial.png) |
| `/seller-drop-create` | buyer | font-family | warn | Non-Inter font-family "-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif" on "This is the wall-clock time in the timezone abov | [view](../../docs/audit/screenshots/seller-drop-create/buyer/00-initial.png) |

### Profile / settings (173)

| Route | Role | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|
| `/(buyer)/edit-profile` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-edit-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/account-type-settings` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/account-type-settings/seller/00-initial.png) |
| `/account-type` | seller | error-boundary | hard | Error-boundary fallback UI rendered | [view](../../docs/audit/screenshots/account-type/seller/00-initial.png) |
| `/account-type` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/account-type/seller/00-initial.png) |
| `/account-type` | seller | console-error | hard | TypeError: t.__internal_state.signUpSignal is not a function
    at http://127.0.0.1:39903/_expo/static/js/web/index-d1fceff539c57743473fb19132db2c2d.js:1626:25 | [view](../../docs/audit/screenshots/account-type/seller/00-initial.png) |
| `/account-type` | buyer | error-boundary | hard | Error-boundary fallback UI rendered | [view](../../docs/audit/screenshots/account-type/buyer/00-initial.png) |
| `/account-type` | buyer | console-error | hard | TypeError: t.__internal_state.signUpSignal is not a function
    at http://127.0.0.1:39903/_expo/static/js/web/index-d1fceff539c57743473fb19132db2c2d.js:1626:25 | [view](../../docs/audit/screenshots/account-type/buyer/00-initial.png) |
| `/ai-settings` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/ai-settings/seller/00-initial.png) |
| `/billing` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/billing/seller/00-initial.png) |
| `/billing` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/billing/buyer/00-initial.png) |
| `/buyer-account-center` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-account-center/seller/00-initial.png) |
| `/buyer-account-control` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-account-control/seller/00-initial.png) |
| `/buyer-account-control` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-account-control/buyer/00-initial.png) |
| `/buyer-other-profile` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-other-profile/seller/00-initial.png) |
| `/buyer-other-profile` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-other-profile/buyer/00-initial.png) |
| `/buyer-privacy-settings` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-privacy-settings/seller/00-initial.png) |
| `/buyer-privacy-settings` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-privacy-settings/buyer/00-initial.png) |
| `/buyer-security` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-security/seller/00-initial.png) |
| `/buyer-settings-detail` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-settings-detail/seller/00-initial.png) |
| `/buyer-settings-menu` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-settings-menu/seller/00-initial.png) |
| `/buyer-settings` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-settings/seller/00-initial.png) |
| `/conversation-privacy-safety` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/conversation-privacy-safety/seller/00-initial.png) |
| `/customer-accounts` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/customer-accounts/seller/00-initial.png) |
| `/customer-privacy` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/customer-privacy/seller/00-initial.png) |
| `/delete-account` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/delete-account/seller/00-initial.png) |
| `/delete-account` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/delete-account/buyer/00-initial.png) |
| `/edit-profile` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/edit-profile/seller/00-initial.png) |
| `/freelancer-profile` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/freelancer-profile/seller/00-initial.png) |
| `/freelancer-profile` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/freelancer-profile/buyer/00-initial.png) |
| `/general-settings` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/general-settings/seller/00-initial.png) |
| `/manufacturer-profile` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/manufacturer-profile/seller/00-initial.png) |
| `/notifications-settings` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/notifications-settings/seller/00-initial.png) |
| `/notifications-settings` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/notifications-settings/buyer/00-initial.png) |
| `/privacy` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/privacy/seller/00-initial.png) |
| `/profile-products` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/profile-products/seller/00-initial.png) |
| `/profile-videos` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/profile-videos/seller/00-initial.png) |
| `/security` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/security/seller/00-initial.png) |
| `/(buyer)/edit-profile` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Change profile photo or video" | [view](../../docs/audit/screenshots/-buyer-edit-profile/seller/00-initial.png) |
| `/(buyer)/edit-profile` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Add profile video" | [view](../../docs/audit/screenshots/-buyer-edit-profile/seller/00-initial.png) |
| `/(buyer)/edit-profile` | seller | hit-target-too-small | warn | 116x17px control "Add profile video" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/seller/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Change profile photo or video" | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Add profile video" | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | hit-target-too-small | warn | 116x17px control "Add profile video" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | seller | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "@northlinestudio" | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "Maya Okafor" | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "@northlinestudio" | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Edit profile" | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Share profile" | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | hit-target-too-small | warn | 24x24px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | hit-target-too-small | warn | 24x24px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | hit-target-too-small | warn | 22x22px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | hit-target-too-small | warn | 60x38px control "1,280Followers" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | hit-target-too-small | warn | 59x38px control "340Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | hit-target-too-small | warn | 157x36px control "Edit profile" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | hit-target-too-small | warn | 157x36px control "Share profile" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | buyer | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "@jordanreyes" | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "Jordan Reyes" | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "@jordanreyes" | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Edit profile" | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Share profile" | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | hit-target-too-small | warn | 24x24px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | hit-target-too-small | warn | 24x24px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | hit-target-too-small | warn | 22x22px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | hit-target-too-small | warn | 60x38px control "1,280Followers" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | hit-target-too-small | warn | 59x38px control "340Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | hit-target-too-small | warn | 157x36px control "Edit profile" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | hit-target-too-small | warn | 157x36px control "Share profile" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/account-type-settings` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/account-type-settings/seller/00-initial.png) |
| `/account-type-settings` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/account-type-settings/buyer/00-initial.png) |
| `/account-type` | seller | type-scale-drift | warn | font-size 28px not on declared FS scale (nearest 26) on "Something went wrong" | [view](../../docs/audit/screenshots/account-type/seller/00-initial.png) |
| `/account-type` | seller | hit-target-too-small | warn | 119x24px control "Go back" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/account-type/seller/00-initial.png) |
| `/account-type` | seller | hit-target-too-small | warn | 123x24px control "Go home" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/account-type/seller/00-initial.png) |
| `/account-type` | buyer | type-scale-drift | warn | font-size 28px not on declared FS scale (nearest 26) on "Something went wrong" | [view](../../docs/audit/screenshots/account-type/buyer/00-initial.png) |
| `/account-type` | buyer | hit-target-too-small | warn | 119x24px control "Go back" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/account-type/buyer/00-initial.png) |
| `/account-type` | buyer | hit-target-too-small | warn | 123x24px control "Go home" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/account-type/buyer/00-initial.png) |
| `/billing` | seller | type-scale-drift | warn | font-size 28px not on declared FS scale (nearest 26) on "$0.00" | [view](../../docs/audit/screenshots/billing/seller/00-initial.png) |
| `/billing` | buyer | type-scale-drift | warn | font-size 28px not on declared FS scale (nearest 26) on "$0.00" | [view](../../docs/audit/screenshots/billing/buyer/00-initial.png) |
| `/buyer-account-center` | seller | clipped-text | warn | Text clipped (324px into 253px): "Password, two-factor authentication and login alerts" | [view](../../docs/audit/screenshots/buyer-account-center/seller/00-initial.png) |
| `/buyer-account-center` | seller | clipped-text | warn | Text clipped (270px into 253px): "Ad and recommendation preferences" | [view](../../docs/audit/screenshots/buyer-account-center/seller/00-initial.png) |
| `/buyer-account-center` | seller | clipped-text | warn | Text clipped (262px into 253px): "Permanently delete your account and data" | [view](../../docs/audit/screenshots/buyer-account-center/seller/00-initial.png) |
| `/buyer-account-center` | seller | type-scale-drift | warn | font-size 24px not on declared FS scale (nearest 22) on "B" | [view](../../docs/audit/screenshots/buyer-account-center/seller/00-initial.png) |
| `/buyer-account-center` | buyer | clipped-text | warn | Text clipped (324px into 253px): "Password, two-factor authentication and login alerts" | [view](../../docs/audit/screenshots/buyer-account-center/buyer/00-initial.png) |
| `/buyer-account-center` | buyer | clipped-text | warn | Text clipped (270px into 253px): "Ad and recommendation preferences" | [view](../../docs/audit/screenshots/buyer-account-center/buyer/00-initial.png) |
| `/buyer-account-center` | buyer | clipped-text | warn | Text clipped (262px into 253px): "Permanently delete your account and data" | [view](../../docs/audit/screenshots/buyer-account-center/buyer/00-initial.png) |
| `/buyer-account-center` | buyer | type-scale-drift | warn | font-size 24px not on declared FS scale (nearest 22) on "B" | [view](../../docs/audit/screenshots/buyer-account-center/buyer/00-initial.png) |
| `/buyer-account-control` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/buyer-account-control/seller/00-initial.png) |
| `/buyer-account-control` | seller | hit-target-too-small | warn | 34x44px control "Retry" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/buyer-account-control/seller/00-initial.png) |
| `/buyer-account-control` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/buyer-account-control/buyer/00-initial.png) |
| `/buyer-account-control` | buyer | hit-target-too-small | warn | 34x44px control "Retry" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/buyer-account-control/buyer/00-initial.png) |
| `/buyer-other-profile` | seller | type-scale-drift | warn | font-size 44px not on declared FS scale (nearest 36) on "Northline Studio" | [view](../../docs/audit/screenshots/buyer-other-profile/seller/00-initial.png) |
| `/buyer-other-profile` | seller | type-scale-drift | warn | font-size 28px not on declared FS scale (nearest 26) on "1,280" | [view](../../docs/audit/screenshots/buyer-other-profile/seller/00-initial.png) |
| `/buyer-other-profile` | seller | type-scale-drift | warn | font-size 28px not on declared FS scale (nearest 26) on "340" | [view](../../docs/audit/screenshots/buyer-other-profile/seller/00-initial.png) |
| `/buyer-other-profile` | buyer | type-scale-drift | warn | font-size 44px not on declared FS scale (nearest 36) on "Jordan Reyes" | [view](../../docs/audit/screenshots/buyer-other-profile/buyer/00-initial.png) |
| `/buyer-other-profile` | buyer | type-scale-drift | warn | font-size 28px not on declared FS scale (nearest 26) on "1,280" | [view](../../docs/audit/screenshots/buyer-other-profile/buyer/00-initial.png) |
| `/buyer-other-profile` | buyer | type-scale-drift | warn | font-size 28px not on declared FS scale (nearest 26) on "340" | [view](../../docs/audit/screenshots/buyer-other-profile/buyer/00-initial.png) |
| `/buyer-privacy-settings` | seller | clipped-text | warn | Text clipped (434px into 231px): "Find friends from contacts (no contacts uploaded without permission)" | [view](../../docs/audit/screenshots/buyer-privacy-settings/seller/00-initial.png) |
| `/buyer-privacy-settings` | seller | overlapping-text | warn | "Let others find your profile in search" overlaps "2" | [view](../../docs/audit/screenshots/buyer-privacy-settings/seller/00-initial.png) |
| `/buyer-privacy-settings` | buyer | clipped-text | warn | Text clipped (434px into 231px): "Find friends from contacts (no contacts uploaded without permission)" | [view](../../docs/audit/screenshots/buyer-privacy-settings/buyer/00-initial.png) |
| `/buyer-settings-menu` | seller | overlapping-text | warn | "Rewards" overlaps "2" | [view](../../docs/audit/screenshots/buyer-settings-menu/seller/00-initial.png) |
| `/buyer-settings-menu` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/buyer-settings-menu/seller/00-initial.png) |
| `/buyer-settings-menu` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/buyer-settings-menu/buyer/00-initial.png) |
| `/buyer-settings` | seller | clipped-text | warn | Text clipped (285px into 253px): "Password, email, phone, and sign-in methods" | [view](../../docs/audit/screenshots/buyer-settings/seller/00-initial.png) |
| `/buyer-settings` | seller | clipped-text | warn | Text clipped (339px into 253px): "Switch between buyer and seller account experiences" | [view](../../docs/audit/screenshots/buyer-settings/seller/00-initial.png) |
| `/buyer-settings` | seller | clipped-text | warn | Text clipped (269px into 253px): "Likes, comments, searches, and time spent" | [view](../../docs/audit/screenshots/buyer-settings/seller/00-initial.png) |
| `/buyer-settings` | seller | clipped-text | warn | Text clipped (266px into 253px): "Posts, products, and collections you saved" | [view](../../docs/audit/screenshots/buyer-settings/seller/00-initial.png) |
| `/buyer-settings` | seller | overlapping-text | warn | "Invite friends" overlaps "2" | [view](../../docs/audit/screenshots/buyer-settings/seller/00-initial.png) |
| `/buyer-settings` | seller | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "MO" | [view](../../docs/audit/screenshots/buyer-settings/seller/00-initial.png) |
| `/buyer-settings` | buyer | clipped-text | warn | Text clipped (285px into 253px): "Password, email, phone, and sign-in methods" | [view](../../docs/audit/screenshots/buyer-settings/buyer/00-initial.png) |
| `/buyer-settings` | buyer | clipped-text | warn | Text clipped (339px into 253px): "Switch between buyer and seller account experiences" | [view](../../docs/audit/screenshots/buyer-settings/buyer/00-initial.png) |
| `/buyer-settings` | buyer | clipped-text | warn | Text clipped (269px into 253px): "Likes, comments, searches, and time spent" | [view](../../docs/audit/screenshots/buyer-settings/buyer/00-initial.png) |
| `/buyer-settings` | buyer | clipped-text | warn | Text clipped (266px into 253px): "Posts, products, and collections you saved" | [view](../../docs/audit/screenshots/buyer-settings/buyer/00-initial.png) |
| `/buyer-settings` | buyer | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "JR" | [view](../../docs/audit/screenshots/buyer-settings/buyer/00-initial.png) |
| `/conversation-privacy-safety` | seller | hit-target-too-small | warn | 36x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/conversation-privacy-safety/seller/00-initial.png) |
| `/conversation-privacy-safety` | buyer | hit-target-too-small | warn | 36x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/conversation-privacy-safety/buyer/00-initial.png) |
| `/delete-account` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/delete-account/seller/00-initial.png) |
| `/delete-account` | seller | hit-target-too-small | warn | 34x44px control "Retry" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/delete-account/seller/00-initial.png) |
| `/delete-account` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/delete-account/buyer/00-initial.png) |
| `/delete-account` | buyer | hit-target-too-small | warn | 34x44px control "Retry" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/delete-account/buyer/00-initial.png) |
| `/edit-profile` | seller | clipped-text | warn | Text clipped (243px into 190px): "brandthread.app/u/northlinestudio" | [view](../../docs/audit/screenshots/edit-profile/seller/00-initial.png) |
| `/edit-profile` | seller | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Northline Studio" | [view](../../docs/audit/screenshots/edit-profile/seller/00-initial.png) |
| `/edit-profile` | buyer | clipped-text | warn | Text clipped (243px into 190px): "brandthread.app/u/northlinestudio" | [view](../../docs/audit/screenshots/edit-profile/buyer/00-initial.png) |
| `/edit-profile` | buyer | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Northline Studio" | [view](../../docs/audit/screenshots/edit-profile/buyer/00-initial.png) |
| `/general-settings` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Northline Studio" | [view](../../docs/audit/screenshots/general-settings/seller/00-initial.png) |
| `/general-settings` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Change log" | [view](../../docs/audit/screenshots/general-settings/seller/00-initial.png) |
| `/general-settings` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Brandthread Help Center" | [view](../../docs/audit/screenshots/general-settings/seller/00-initial.png) |
| `/general-settings` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Hire a Brandthread Partner" | [view](../../docs/audit/screenshots/general-settings/seller/00-initial.png) |
| `/general-settings` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Northline Studio" | [view](../../docs/audit/screenshots/general-settings/buyer/00-initial.png) |
| `/general-settings` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Change log" | [view](../../docs/audit/screenshots/general-settings/buyer/00-initial.png) |
| `/general-settings` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Brandthread Help Center" | [view](../../docs/audit/screenshots/general-settings/buyer/00-initial.png) |
| `/general-settings` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Hire a Brandthread Partner" | [view](../../docs/audit/screenshots/general-settings/buyer/00-initial.png) |
| `/manufacturer-profile` | seller | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Back to directory" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/manufacturer-profile/seller/00-initial.png) |
| `/manufacturer-profile` | buyer | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Back to directory" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/manufacturer-profile/buyer/00-initial.png) |
| `/notifications-settings` | seller | clipped-text | warn | Text clipped (310px into 231px): "Turn all push notifications on or off for this device" | [view](../../docs/audit/screenshots/notifications-settings/seller/00-initial.png) |
| `/notifications-settings` | seller | clipped-text | warn | Text clipped (286px into 239px): "Get notified when a customer places an order" | [view](../../docs/audit/screenshots/notifications-settings/seller/00-initial.png) |
| `/notifications-settings` | seller | clipped-text | warn | Text clipped (287px into 239px): "Sampling, production, and fulfillment progress" | [view](../../docs/audit/screenshots/notifications-settings/seller/00-initial.png) |
| `/notifications-settings` | seller | clipped-text | warn | Text clipped (274px into 239px): "Payout sent, completed, or delayed updates" | [view](../../docs/audit/screenshots/notifications-settings/seller/00-initial.png) |
| `/notifications-settings` | seller | overlapping-text | warn | "Sampling, production, and fulfillment progress" overlaps "2" | [view](../../docs/audit/screenshots/notifications-settings/seller/00-initial.png) |
| `/notifications-settings` | seller | contrast-violation | warn | contrast 1.12:1 (need 4.5:1) for "Real-time" — rgb(10, 10, 11) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/notifications-settings/seller/00-initial.png) |
| `/notifications-settings` | seller | hit-target-too-small | warn | 45x34px control "Off" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/notifications-settings/seller/00-initial.png) |
| `/notifications-settings` | seller | hit-target-too-small | warn | 106x34px control "10 PM – 7 AM" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/notifications-settings/seller/00-initial.png) |
| `/notifications-settings` | seller | hit-target-too-small | warn | 104x34px control "11 PM – 8 AM" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/notifications-settings/seller/00-initial.png) |
| `/notifications-settings` | seller | hit-target-too-small | warn | 102x34px control "9 PM – 6 AM" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/notifications-settings/seller/00-initial.png) |
| `/notifications-settings` | seller | hit-target-too-small | warn | 177x32px control "Real-time" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/notifications-settings/seller/00-initial.png) |
| `/notifications-settings` | seller | hit-target-too-small | warn | 177x32px control "Daily digest" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/notifications-settings/seller/00-initial.png) |
| `/notifications-settings` | buyer | clipped-text | warn | Text clipped (310px into 231px): "Turn all push notifications on or off for this device" | [view](../../docs/audit/screenshots/notifications-settings/buyer/00-initial.png) |
| `/notifications-settings` | buyer | clipped-text | warn | Text clipped (286px into 239px): "Get notified when a customer places an order" | [view](../../docs/audit/screenshots/notifications-settings/buyer/00-initial.png) |
| `/notifications-settings` | buyer | clipped-text | warn | Text clipped (287px into 239px): "Sampling, production, and fulfillment progress" | [view](../../docs/audit/screenshots/notifications-settings/buyer/00-initial.png) |
| `/notifications-settings` | buyer | clipped-text | warn | Text clipped (274px into 239px): "Payout sent, completed, or delayed updates" | [view](../../docs/audit/screenshots/notifications-settings/buyer/00-initial.png) |
| `/notifications-settings` | buyer | contrast-violation | warn | contrast 1.12:1 (need 4.5:1) for "Real-time" — rgb(10, 10, 11) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/notifications-settings/buyer/00-initial.png) |
| `/notifications-settings` | buyer | hit-target-too-small | warn | 45x34px control "Off" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/notifications-settings/buyer/00-initial.png) |
| `/notifications-settings` | buyer | hit-target-too-small | warn | 106x34px control "10 PM – 7 AM" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/notifications-settings/buyer/00-initial.png) |
| `/notifications-settings` | buyer | hit-target-too-small | warn | 104x34px control "11 PM – 8 AM" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/notifications-settings/buyer/00-initial.png) |
| `/notifications-settings` | buyer | hit-target-too-small | warn | 102x34px control "9 PM – 6 AM" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/notifications-settings/buyer/00-initial.png) |
| `/notifications-settings` | buyer | hit-target-too-small | warn | 177x32px control "Real-time" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/notifications-settings/buyer/00-initial.png) |
| `/notifications-settings` | buyer | hit-target-too-small | warn | 177x32px control "Daily digest" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/notifications-settings/buyer/00-initial.png) |
| `/privacy` | seller | type-scale-drift | warn | font-size 42px not on declared FS scale (nearest 36) on "Privacy Policy" | [view](../../docs/audit/screenshots/privacy/seller/00-initial.png) |
| `/privacy` | seller | hit-target-too-small | warn | 146x34px control "Brandthread" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/privacy/seller/00-initial.png) |
| `/privacy` | seller | hit-target-too-small | warn | 72x34px control "Terms" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/privacy/seller/00-initial.png) |
| `/privacy` | seller | hit-target-too-small | warn | 98x34px control "Guidelines" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/privacy/seller/00-initial.png) |
| `/privacy` | seller | hit-target-too-small | warn | 79x34px control "Privacy" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/privacy/seller/00-initial.png) |
| `/privacy` | buyer | type-scale-drift | warn | font-size 42px not on declared FS scale (nearest 36) on "Privacy Policy" | [view](../../docs/audit/screenshots/privacy/buyer/00-initial.png) |
| `/privacy` | buyer | hit-target-too-small | warn | 146x34px control "Brandthread" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/privacy/buyer/00-initial.png) |
| `/privacy` | buyer | hit-target-too-small | warn | 72x34px control "Terms" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/privacy/buyer/00-initial.png) |
| `/privacy` | buyer | hit-target-too-small | warn | 98x34px control "Guidelines" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/privacy/buyer/00-initial.png) |
| `/privacy` | buyer | hit-target-too-small | warn | 79x34px control "Privacy" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/privacy/buyer/00-initial.png) |
| `/security` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "View" | [view](../../docs/audit/screenshots/security/seller/00-initial.png) |
| `/security` | seller | hit-target-too-small | warn | 84x36px control "View" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/security/seller/00-initial.png) |
| `/security` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "View" | [view](../../docs/audit/screenshots/security/buyer/00-initial.png) |
| `/security` | buyer | hit-target-too-small | warn | 84x36px control "View" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/security/buyer/00-initial.png) |

### Buyer discover / feed (118)

| Route | Role | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|
| `/(buyer)/discover-feed` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-discover-feed/seller/00-initial.png) |
| `/(buyer)/discover-feed` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-discover-feed/buyer/00-initial.png) |
| `/(buyer)/discover` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/feed` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/buyer-drops` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-drops/seller/00-initial.png) |
| `/c/col_nl_ember` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/c-col_nl_ember/seller/00-initial.png) |
| `/c/col_nl_ember` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/c-col_nl_ember/buyer/00-initial.png) |
| `/drops/drop_nl_04` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/drops-drop_nl_04/seller/00-initial.png) |
| `/drops/drop_nl_04` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/drops-drop_nl_04/buyer/00-initial.png) |
| `/live-feed` | seller | console-error | hard | Failed to load because no supported source was found. | [view](../../docs/audit/screenshots/live-feed/seller/00-initial.png) |
| `/live-feed` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/live-feed/seller/00-initial.png) |
| `/live-feed` | buyer | console-error | hard | Failed to load because no supported source was found. | [view](../../docs/audit/screenshots/live-feed/buyer/00-initial.png) |
| `/(buyer)/discover-feed` | seller | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Retry" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/-buyer-discover-feed/seller/00-initial.png) |
| `/(buyer)/discover-feed` | buyer | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Retry" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/-buyer-discover-feed/buyer/00-initial.png) |
| `/(buyer)/discover` | seller | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Discover" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "N" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "F" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "Q" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "E" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "N" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "F" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Heavyweight Hoodie — Ember" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Field Shell Jacket — Rust" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Boxy Fleece Hoodie — Graphite" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | hit-target-too-small | warn | 210x36px control "Search" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | hit-target-too-small | warn | 82x34px control "For You" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | hit-target-too-small | warn | 56x34px control "Fits" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | hit-target-too-small | warn | 78x34px control "Brands" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | hit-target-too-small | warn | 77x34px control "People" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | hit-target-too-small | warn | 71x34px control "Drops" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | buyer | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Discover" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "N" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "F" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "Q" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "E" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "N" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "F" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Heavyweight Hoodie — Ember" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Field Shell Jacket — Rust" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Boxy Fleece Hoodie — Graphite" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | hit-target-too-small | warn | 210x36px control "Search" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | hit-target-too-small | warn | 82x34px control "For You" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | hit-target-too-small | warn | 56x34px control "Fits" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | hit-target-too-small | warn | 78x34px control "Brands" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | hit-target-too-small | warn | 77x34px control "People" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | hit-target-too-small | warn | 71x34px control "Drops" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "212 claimed" overlaps "Watching Threads" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "·" overlaps "Watching Threads" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "38 left" overlaps "Watching Threads" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "08:59:57" overlaps "Watching Threads" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "64 claimed" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "·" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "11 left" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "17:59:57" overlaps "Next video" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "$220.00" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "Boxy Fleece Hoodie — Graphite" overlaps "Double tap" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "Ember & Ash" overlaps "Like" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "$88.00" overlaps "Like" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "91 claimed" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "·" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "9 left" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "35:59:57" overlaps "Scrub through the video" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "$165.00" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "Garment-Dyed Hoodie — Moss" overlaps "Tap to keep watching" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "Quiet Hours" overlaps "Tap to keep watching" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "High Demand" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "2x" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | buyer | overlapping-text | warn | "212 claimed" overlaps "Watching Threads" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | overlapping-text | warn | "·" overlaps "Watching Threads" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | overlapping-text | warn | "38 left" overlaps "Watching Threads" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | overlapping-text | warn | "08:59:56" overlaps "Watching Threads" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | overlapping-text | warn | "64 claimed" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | overlapping-text | warn | "·" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | overlapping-text | warn | "11 left" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | overlapping-text | warn | "17:59:56" overlaps "Next video" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | overlapping-text | warn | "$220.00" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | overlapping-text | warn | "Boxy Fleece Hoodie — Graphite" overlaps "Double tap" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | overlapping-text | warn | "Ember & Ash" overlaps "Like" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | overlapping-text | warn | "$88.00" overlaps "Like" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | overlapping-text | warn | "91 claimed" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | overlapping-text | warn | "·" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | overlapping-text | warn | "9 left" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | overlapping-text | warn | "35:59:56" overlaps "Scrub through the video" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | overlapping-text | warn | "$165.00" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | overlapping-text | warn | "Garment-Dyed Hoodie — Moss" overlaps "Tap to keep watching" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | overlapping-text | warn | "Quiet Hours" overlaps "Tap to keep watching" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "High Demand" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "2x" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/c/col_nl_ember` | seller | font-family | warn | Non-Inter font-family "-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif" on "This collection may be private or no longer exis | [view](../../docs/audit/screenshots/c-col_nl_ember/seller/00-initial.png) |
| `/c/col_nl_ember` | buyer | font-family | warn | Non-Inter font-family "-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif" on "This collection may be private or no longer exis | [view](../../docs/audit/screenshots/c-col_nl_ember/buyer/00-initial.png) |
| `/drops/drop_nl_04` | seller | type-scale-drift | warn | font-size 39px not on declared FS scale (nearest 36) on "Drop 04 — Ember Season" | [view](../../docs/audit/screenshots/drops-drop_nl_04/seller/00-initial.png) |
| `/drops/drop_nl_04` | buyer | type-scale-drift | warn | font-size 39px not on declared FS scale (nearest 36) on "Drop 04 — Ember Season" | [view](../../docs/audit/screenshots/drops-drop_nl_04/buyer/00-initial.png) |
| `/live-feed` | seller | type-scale-drift | warn | font-size 9px not on declared FS scale (nearest 11) on "LIVE" | [view](../../docs/audit/screenshots/live-feed/seller/00-initial.png) |
| `/live-feed` | seller | min-size-violation | warn | font-size 9px below the 11pt caption floor on "LIVE" | [view](../../docs/audit/screenshots/live-feed/seller/00-initial.png) |
| `/live-feed` | seller | contrast-violation | warn | contrast 3.55:1 (need 4.5:1) for "LIVE" — rgb(255, 255, 255) on rgb(255, 59, 48) | [view](../../docs/audit/screenshots/live-feed/seller/00-initial.png) |
| `/live-feed` | seller | hit-target-too-small | warn | 36x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/live-feed/seller/00-initial.png) |
| `/live-feed` | seller | hit-target-too-small | warn | 38x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/live-feed/seller/00-initial.png) |
| `/live-feed` | seller | hit-target-too-small | warn | 38x44px control "button" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/live-feed/seller/00-initial.png) |
| `/live-feed` | seller | hit-target-too-small | warn | 38x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/live-feed/seller/00-initial.png) |
| `/live-feed` | buyer | type-scale-drift | warn | font-size 9px not on declared FS scale (nearest 11) on "LIVE" | [view](../../docs/audit/screenshots/live-feed/buyer/00-initial.png) |
| `/live-feed` | buyer | min-size-violation | warn | font-size 9px below the 11pt caption floor on "LIVE" | [view](../../docs/audit/screenshots/live-feed/buyer/00-initial.png) |
| `/live-feed` | buyer | contrast-violation | warn | contrast 3.55:1 (need 4.5:1) for "LIVE" — rgb(255, 255, 255) on rgb(255, 59, 48) | [view](../../docs/audit/screenshots/live-feed/buyer/00-initial.png) |
| `/live-feed` | buyer | hit-target-too-small | warn | 36x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/live-feed/buyer/00-initial.png) |
| `/live-feed` | buyer | hit-target-too-small | warn | 38x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/live-feed/buyer/00-initial.png) |
| `/live-feed` | buyer | hit-target-too-small | warn | 38x44px control "button" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/live-feed/buyer/00-initial.png) |
| `/live-feed` | buyer | hit-target-too-small | warn | 38x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/live-feed/buyer/00-initial.png) |

### Manufacturer hub (117)

| Route | Role | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|
| `/invite-manufacturer` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/invite-manufacturer/seller/00-initial.png) |
| `/invite-manufacturer` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/invite-manufacturer/buyer/00-initial.png) |
| `/manufacturer-compare` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/manufacturer-compare/seller/00-initial.png) |
| `/manufacturer-hub` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/manufacturer-hub/seller/00-initial.png) |
| `/manufacturer-onboard` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/manufacturer-onboard/seller/00-initial.png) |
| `/manufacturer-product` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/manufacturer-product/seller/00-initial.png) |
| `/manufacturer` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/manufacturer/seller/00-initial.png) |
| `/invite-manufacturer` | seller | contrast-violation | warn | contrast 1.12:1 (need 4.5:1) for "Create private invite link" — rgb(10, 10, 11) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/invite-manufacturer/seller/00-initial.png) |
| `/invite-manufacturer` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/invite-manufacturer/seller/00-initial.png) |
| `/invite-manufacturer` | buyer | contrast-violation | warn | contrast 1.12:1 (need 4.5:1) for "Create private invite link" — rgb(10, 10, 11) on rgb(24, 24, 27) | [view](../../docs/audit/screenshots/invite-manufacturer/buyer/00-initial.png) |
| `/invite-manufacturer` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/invite-manufacturer/buyer/00-initial.png) |
| `/manufacturer-compare` | seller | clipped-text | warn | Text clipped (129px into 126px): "Porto Knit Collective" | [view](../../docs/audit/screenshots/manufacturer-compare/seller/00-initial.png) |
| `/manufacturer-compare` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer-compare/seller/00-initial.png) |
| `/manufacturer-compare` | buyer | clipped-text | warn | Text clipped (129px into 126px): "Porto Knit Collective" | [view](../../docs/audit/screenshots/manufacturer-compare/buyer/00-initial.png) |
| `/manufacturer-compare` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer-compare/buyer/00-initial.png) |
| `/manufacturer-hub` | seller | clipped-text | warn | Text clipped (111px into 108px): "Porto Knit Collective" | [view](../../docs/audit/screenshots/manufacturer-hub/seller/00-initial.png) |
| `/manufacturer-hub` | seller | clipped-text | warn | Text clipped (123px into 108px): "Ho Chi Minh City, Vietnam" | [view](../../docs/audit/screenshots/manufacturer-hub/seller/00-initial.png) |
| `/manufacturer-hub` | seller | clipped-text | warn | Text clipped (295px into 245px): "Panels are cut — sending sewing line photos tomorrow." | [view](../../docs/audit/screenshots/manufacturer-hub/seller/00-initial.png) |
| `/manufacturer-hub` | seller | overlapping-text | warn | "LA Garment Works" overlaps "2" | [view](../../docs/audit/screenshots/manufacturer-hub/seller/00-initial.png) |
| `/manufacturer-hub` | seller | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "Porto, Portugal" | [view](../../docs/audit/screenshots/manufacturer-hub/seller/00-initial.png) |
| `/manufacturer-hub` | seller | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "Los Angeles, USA" | [view](../../docs/audit/screenshots/manufacturer-hub/seller/00-initial.png) |
| `/manufacturer-hub` | seller | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "Ho Chi Minh City, Vietnam" | [view](../../docs/audit/screenshots/manufacturer-hub/seller/00-initial.png) |
| `/manufacturer-hub` | seller | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "Tiruppur, India" | [view](../../docs/audit/screenshots/manufacturer-hub/seller/00-initial.png) |
| `/manufacturer-hub` | seller | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "2" | [view](../../docs/audit/screenshots/manufacturer-hub/seller/00-initial.png) |
| `/manufacturer-hub` | seller | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "1" | [view](../../docs/audit/screenshots/manufacturer-hub/seller/00-initial.png) |
| `/manufacturer-hub` | seller | min-size-violation | warn | font-size 10px below the 11pt caption floor on "Porto, Portugal" | [view](../../docs/audit/screenshots/manufacturer-hub/seller/00-initial.png) |
| `/manufacturer-hub` | seller | min-size-violation | warn | font-size 10px below the 11pt caption floor on "Los Angeles, USA" | [view](../../docs/audit/screenshots/manufacturer-hub/seller/00-initial.png) |
| `/manufacturer-hub` | seller | min-size-violation | warn | font-size 10px below the 11pt caption floor on "Ho Chi Minh City, Vietnam" | [view](../../docs/audit/screenshots/manufacturer-hub/seller/00-initial.png) |
| `/manufacturer-hub` | seller | min-size-violation | warn | font-size 10px below the 11pt caption floor on "Tiruppur, India" | [view](../../docs/audit/screenshots/manufacturer-hub/seller/00-initial.png) |
| `/manufacturer-hub` | seller | min-size-violation | warn | font-size 10px below the 11pt caption floor on "2" | [view](../../docs/audit/screenshots/manufacturer-hub/seller/00-initial.png) |
| `/manufacturer-hub` | seller | min-size-violation | warn | font-size 10px below the 11pt caption floor on "1" | [view](../../docs/audit/screenshots/manufacturer-hub/seller/00-initial.png) |
| `/manufacturer-hub` | seller | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Request for Quotation" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/manufacturer-hub/seller/00-initial.png) |
| `/manufacturer-hub` | seller | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Broadcast one request to up to 10 manufacturers" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/manufacturer-hub/seller/00-initial.png) |
| `/manufacturer-hub` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer-hub/seller/00-initial.png) |
| `/manufacturer-hub` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer-hub/seller/00-initial.png) |
| `/manufacturer-hub` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer-hub/seller/00-initial.png) |
| `/manufacturer-hub` | seller | hit-target-too-small | warn | 40x16px control "See all" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer-hub/seller/00-initial.png) |
| `/manufacturer-hub` | seller | hit-target-too-small | warn | 40x16px control "See all" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer-hub/seller/00-initial.png) |
| `/manufacturer-hub` | buyer | clipped-text | warn | Text clipped (111px into 108px): "Porto Knit Collective" | [view](../../docs/audit/screenshots/manufacturer-hub/buyer/00-initial.png) |
| `/manufacturer-hub` | buyer | clipped-text | warn | Text clipped (123px into 108px): "Ho Chi Minh City, Vietnam" | [view](../../docs/audit/screenshots/manufacturer-hub/buyer/00-initial.png) |
| `/manufacturer-hub` | buyer | clipped-text | warn | Text clipped (295px into 245px): "Panels are cut — sending sewing line photos tomorrow." | [view](../../docs/audit/screenshots/manufacturer-hub/buyer/00-initial.png) |
| `/manufacturer-hub` | buyer | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "Porto, Portugal" | [view](../../docs/audit/screenshots/manufacturer-hub/buyer/00-initial.png) |
| `/manufacturer-hub` | buyer | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "Los Angeles, USA" | [view](../../docs/audit/screenshots/manufacturer-hub/buyer/00-initial.png) |
| `/manufacturer-hub` | buyer | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "Ho Chi Minh City, Vietnam" | [view](../../docs/audit/screenshots/manufacturer-hub/buyer/00-initial.png) |
| `/manufacturer-hub` | buyer | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "Tiruppur, India" | [view](../../docs/audit/screenshots/manufacturer-hub/buyer/00-initial.png) |
| `/manufacturer-hub` | buyer | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "2" | [view](../../docs/audit/screenshots/manufacturer-hub/buyer/00-initial.png) |
| `/manufacturer-hub` | buyer | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "1" | [view](../../docs/audit/screenshots/manufacturer-hub/buyer/00-initial.png) |
| `/manufacturer-hub` | buyer | min-size-violation | warn | font-size 10px below the 11pt caption floor on "Porto, Portugal" | [view](../../docs/audit/screenshots/manufacturer-hub/buyer/00-initial.png) |
| `/manufacturer-hub` | buyer | min-size-violation | warn | font-size 10px below the 11pt caption floor on "Los Angeles, USA" | [view](../../docs/audit/screenshots/manufacturer-hub/buyer/00-initial.png) |
| `/manufacturer-hub` | buyer | min-size-violation | warn | font-size 10px below the 11pt caption floor on "Ho Chi Minh City, Vietnam" | [view](../../docs/audit/screenshots/manufacturer-hub/buyer/00-initial.png) |
| `/manufacturer-hub` | buyer | min-size-violation | warn | font-size 10px below the 11pt caption floor on "Tiruppur, India" | [view](../../docs/audit/screenshots/manufacturer-hub/buyer/00-initial.png) |
| `/manufacturer-hub` | buyer | min-size-violation | warn | font-size 10px below the 11pt caption floor on "2" | [view](../../docs/audit/screenshots/manufacturer-hub/buyer/00-initial.png) |
| `/manufacturer-hub` | buyer | min-size-violation | warn | font-size 10px below the 11pt caption floor on "1" | [view](../../docs/audit/screenshots/manufacturer-hub/buyer/00-initial.png) |
| `/manufacturer-hub` | buyer | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Request for Quotation" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/manufacturer-hub/buyer/00-initial.png) |
| `/manufacturer-hub` | buyer | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Broadcast one request to up to 10 manufacturers" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/manufacturer-hub/buyer/00-initial.png) |
| `/manufacturer-hub` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer-hub/buyer/00-initial.png) |
| `/manufacturer-hub` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer-hub/buyer/00-initial.png) |
| `/manufacturer-hub` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer-hub/buyer/00-initial.png) |
| `/manufacturer-hub` | buyer | hit-target-too-small | warn | 40x16px control "See all" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer-hub/buyer/00-initial.png) |
| `/manufacturer-hub` | buyer | hit-target-too-small | warn | 40x16px control "See all" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer-hub/buyer/00-initial.png) |
| `/manufacturer-onboard` | seller | type-scale-drift | warn | font-size 28px not on declared FS scale (nearest 26) on "List your factory on Brandthread" | [view](../../docs/audit/screenshots/manufacturer-onboard/seller/00-initial.png) |
| `/manufacturer-onboard` | seller | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Open the manufacturer portal" | [view](../../docs/audit/screenshots/manufacturer-onboard/seller/00-initial.png) |
| `/manufacturer-onboard` | seller | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Open the manufacturer portal" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/manufacturer-onboard/seller/00-initial.png) |
| `/manufacturer-onboard` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer-onboard/seller/00-initial.png) |
| `/manufacturer-onboard` | buyer | type-scale-drift | warn | font-size 28px not on declared FS scale (nearest 26) on "List your factory on Brandthread" | [view](../../docs/audit/screenshots/manufacturer-onboard/buyer/00-initial.png) |
| `/manufacturer-onboard` | buyer | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Open the manufacturer portal" | [view](../../docs/audit/screenshots/manufacturer-onboard/buyer/00-initial.png) |
| `/manufacturer-onboard` | buyer | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Open the manufacturer portal" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/manufacturer-onboard/buyer/00-initial.png) |
| `/manufacturer-onboard` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer-onboard/buyer/00-initial.png) |
| `/manufacturer-product` | seller | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Retry" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/manufacturer-product/seller/00-initial.png) |
| `/manufacturer-product` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer-product/seller/00-initial.png) |
| `/manufacturer-product` | buyer | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Retry" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/manufacturer-product/buyer/00-initial.png) |
| `/manufacturer-product` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer-product/buyer/00-initial.png) |
| `/manufacturer` | seller | clipped-text | warn | Text clipped (111px into 108px): "Porto Knit Collective" | [view](../../docs/audit/screenshots/manufacturer/seller/00-initial.png) |
| `/manufacturer` | seller | clipped-text | warn | Text clipped (123px into 108px): "Ho Chi Minh City, Vietnam" | [view](../../docs/audit/screenshots/manufacturer/seller/00-initial.png) |
| `/manufacturer` | seller | clipped-text | warn | Text clipped (295px into 245px): "Panels are cut — sending sewing line photos tomorrow." | [view](../../docs/audit/screenshots/manufacturer/seller/00-initial.png) |
| `/manufacturer` | seller | overlapping-text | warn | "LA Garment Works" overlaps "2" | [view](../../docs/audit/screenshots/manufacturer/seller/00-initial.png) |
| `/manufacturer` | seller | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "Porto, Portugal" | [view](../../docs/audit/screenshots/manufacturer/seller/00-initial.png) |
| `/manufacturer` | seller | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "Los Angeles, USA" | [view](../../docs/audit/screenshots/manufacturer/seller/00-initial.png) |
| `/manufacturer` | seller | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "Ho Chi Minh City, Vietnam" | [view](../../docs/audit/screenshots/manufacturer/seller/00-initial.png) |
| `/manufacturer` | seller | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "Tiruppur, India" | [view](../../docs/audit/screenshots/manufacturer/seller/00-initial.png) |
| `/manufacturer` | seller | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "2" | [view](../../docs/audit/screenshots/manufacturer/seller/00-initial.png) |
| `/manufacturer` | seller | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "1" | [view](../../docs/audit/screenshots/manufacturer/seller/00-initial.png) |
| `/manufacturer` | seller | min-size-violation | warn | font-size 10px below the 11pt caption floor on "Porto, Portugal" | [view](../../docs/audit/screenshots/manufacturer/seller/00-initial.png) |
| `/manufacturer` | seller | min-size-violation | warn | font-size 10px below the 11pt caption floor on "Los Angeles, USA" | [view](../../docs/audit/screenshots/manufacturer/seller/00-initial.png) |
| `/manufacturer` | seller | min-size-violation | warn | font-size 10px below the 11pt caption floor on "Ho Chi Minh City, Vietnam" | [view](../../docs/audit/screenshots/manufacturer/seller/00-initial.png) |
| `/manufacturer` | seller | min-size-violation | warn | font-size 10px below the 11pt caption floor on "Tiruppur, India" | [view](../../docs/audit/screenshots/manufacturer/seller/00-initial.png) |
| `/manufacturer` | seller | min-size-violation | warn | font-size 10px below the 11pt caption floor on "2" | [view](../../docs/audit/screenshots/manufacturer/seller/00-initial.png) |
| `/manufacturer` | seller | min-size-violation | warn | font-size 10px below the 11pt caption floor on "1" | [view](../../docs/audit/screenshots/manufacturer/seller/00-initial.png) |
| `/manufacturer` | seller | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Request for Quotation" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/manufacturer/seller/00-initial.png) |
| `/manufacturer` | seller | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Broadcast one request to up to 10 manufacturers" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/manufacturer/seller/00-initial.png) |
| `/manufacturer` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer/seller/00-initial.png) |
| `/manufacturer` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer/seller/00-initial.png) |
| `/manufacturer` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer/seller/00-initial.png) |
| `/manufacturer` | seller | hit-target-too-small | warn | 40x16px control "See all" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer/seller/00-initial.png) |
| `/manufacturer` | seller | hit-target-too-small | warn | 40x16px control "See all" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer/seller/00-initial.png) |
| `/manufacturer` | buyer | clipped-text | warn | Text clipped (111px into 108px): "Porto Knit Collective" | [view](../../docs/audit/screenshots/manufacturer/buyer/00-initial.png) |
| `/manufacturer` | buyer | clipped-text | warn | Text clipped (123px into 108px): "Ho Chi Minh City, Vietnam" | [view](../../docs/audit/screenshots/manufacturer/buyer/00-initial.png) |
| `/manufacturer` | buyer | clipped-text | warn | Text clipped (295px into 245px): "Panels are cut — sending sewing line photos tomorrow." | [view](../../docs/audit/screenshots/manufacturer/buyer/00-initial.png) |
| `/manufacturer` | buyer | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "Porto, Portugal" | [view](../../docs/audit/screenshots/manufacturer/buyer/00-initial.png) |
| `/manufacturer` | buyer | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "Los Angeles, USA" | [view](../../docs/audit/screenshots/manufacturer/buyer/00-initial.png) |
| `/manufacturer` | buyer | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "Ho Chi Minh City, Vietnam" | [view](../../docs/audit/screenshots/manufacturer/buyer/00-initial.png) |
| `/manufacturer` | buyer | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "Tiruppur, India" | [view](../../docs/audit/screenshots/manufacturer/buyer/00-initial.png) |
| `/manufacturer` | buyer | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "2" | [view](../../docs/audit/screenshots/manufacturer/buyer/00-initial.png) |
| `/manufacturer` | buyer | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "1" | [view](../../docs/audit/screenshots/manufacturer/buyer/00-initial.png) |
| `/manufacturer` | buyer | min-size-violation | warn | font-size 10px below the 11pt caption floor on "Porto, Portugal" | [view](../../docs/audit/screenshots/manufacturer/buyer/00-initial.png) |
| `/manufacturer` | buyer | min-size-violation | warn | font-size 10px below the 11pt caption floor on "Los Angeles, USA" | [view](../../docs/audit/screenshots/manufacturer/buyer/00-initial.png) |
| `/manufacturer` | buyer | min-size-violation | warn | font-size 10px below the 11pt caption floor on "Ho Chi Minh City, Vietnam" | [view](../../docs/audit/screenshots/manufacturer/buyer/00-initial.png) |
| `/manufacturer` | buyer | min-size-violation | warn | font-size 10px below the 11pt caption floor on "Tiruppur, India" | [view](../../docs/audit/screenshots/manufacturer/buyer/00-initial.png) |
| `/manufacturer` | buyer | min-size-violation | warn | font-size 10px below the 11pt caption floor on "2" | [view](../../docs/audit/screenshots/manufacturer/buyer/00-initial.png) |
| `/manufacturer` | buyer | min-size-violation | warn | font-size 10px below the 11pt caption floor on "1" | [view](../../docs/audit/screenshots/manufacturer/buyer/00-initial.png) |
| `/manufacturer` | buyer | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Request for Quotation" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/manufacturer/buyer/00-initial.png) |
| `/manufacturer` | buyer | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Broadcast one request to up to 10 manufacturers" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/manufacturer/buyer/00-initial.png) |
| `/manufacturer` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer/buyer/00-initial.png) |
| `/manufacturer` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer/buyer/00-initial.png) |
| `/manufacturer` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer/buyer/00-initial.png) |
| `/manufacturer` | buyer | hit-target-too-small | warn | 40x16px control "See all" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer/buyer/00-initial.png) |
| `/manufacturer` | buyer | hit-target-too-small | warn | 40x16px control "See all" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer/buyer/00-initial.png) |

### Checkout / orders (85)

| Route | Role | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|
| `/(buyer)/cart` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/orders` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-orders/seller/00-initial.png) |
| `/buyer-checkout` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-checkout/seller/00-initial.png) |
| `/buyer-checkout` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-checkout/buyer/00-initial.png) |
| `/buyer-order-detail` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-order-detail/seller/00-initial.png) |
| `/buyer-order-detail` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-order-detail/buyer/00-initial.png) |
| `/checkout` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/checkout/seller/00-initial.png) |
| `/customer-orders` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/customer-orders/seller/00-initial.png) |
| `/customer-orders` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/customer-orders/buyer/00-initial.png) |
| `/fulfill-order` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/fulfill-order/seller/00-initial.png) |
| `/fulfill-order` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/fulfill-order/buyer/00-initial.png) |
| `/order-detail` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/order-detail/seller/00-initial.png) |
| `/order-detail` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/order-detail/buyer/00-initial.png) |
| `/orders` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/orders/seller/00-initial.png) |
| `/(buyer)/cart` | seller | overlapping-text | warn | "$165.00" overlaps "Checkout" | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | color-rule-violation | warn | Non-monochrome, non-allowed color rgb(255, 213, 128) on "Only 3 left" | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | font-family | warn | Non-Inter font-family "-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif" on "·" | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | font-family | warn | Non-Inter font-family "-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif" on "·" | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | hit-target-too-small | warn | 32x16px control "Edit" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | hit-target-too-small | warn | 217x30px control "M" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | hit-target-too-small | warn | 32x32px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | hit-target-too-small | warn | 32x32px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | hit-target-too-small | warn | 217x30px control "L" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | hit-target-too-small | warn | 32x32px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | hit-target-too-small | warn | 32x32px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | buyer | overlapping-text | warn | "$165.00" overlaps "Checkout" | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | color-rule-violation | warn | Non-monochrome, non-allowed color rgb(255, 213, 128) on "Only 3 left" | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | font-family | warn | Non-Inter font-family "-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif" on "·" | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | font-family | warn | Non-Inter font-family "-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif" on "·" | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | hit-target-too-small | warn | 32x16px control "Edit" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | hit-target-too-small | warn | 217x30px control "M" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | hit-target-too-small | warn | 32x32px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | hit-target-too-small | warn | 32x32px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | hit-target-too-small | warn | 217x30px control "L" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | hit-target-too-small | warn | 32x32px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | hit-target-too-small | warn | 32x32px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/orders` | seller | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "My Orders" | [view](../../docs/audit/screenshots/-buyer-orders/seller/00-initial.png) |
| `/(buyer)/orders` | seller | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Discover Products" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/-buyer-orders/seller/00-initial.png) |
| `/(buyer)/orders` | buyer | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "My Orders" | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Discover Products" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/buyer-checkout` | seller | font-family | warn | Non-Inter font-family "-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Roboto, system-ui, sans-serif" on "Express checkout" | [view](../../docs/audit/screenshots/buyer-checkout/seller/00-initial.png) |
| `/buyer-checkout` | seller | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Express checkout" | [view](../../docs/audit/screenshots/buyer-checkout/seller/00-initial.png) |
| `/buyer-checkout` | seller | hit-target-too-small | warn | 98x15px control "Terms of Service" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/buyer-checkout/seller/00-initial.png) |
| `/buyer-checkout` | seller | hit-target-too-small | warn | 81x15px control "Privacy Policy" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/buyer-checkout/seller/00-initial.png) |
| `/buyer-checkout` | buyer | font-family | warn | Non-Inter font-family "-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Roboto, system-ui, sans-serif" on "Express checkout" | [view](../../docs/audit/screenshots/buyer-checkout/buyer/00-initial.png) |
| `/buyer-checkout` | buyer | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Express checkout" | [view](../../docs/audit/screenshots/buyer-checkout/buyer/00-initial.png) |
| `/buyer-checkout` | buyer | hit-target-too-small | warn | 98x15px control "Terms of Service" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/buyer-checkout/buyer/00-initial.png) |
| `/buyer-checkout` | buyer | hit-target-too-small | warn | 81x15px control "Privacy Policy" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/buyer-checkout/buyer/00-initial.png) |
| `/buyer-order-detail` | seller | hit-target-too-small | warn | 36x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/buyer-order-detail/seller/00-initial.png) |
| `/buyer-order-detail` | buyer | hit-target-too-small | warn | 36x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/buyer-order-detail/buyer/00-initial.png) |
| `/customer-orders` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Couldn't load this customer. Check your connection and try again." | [view](../../docs/audit/screenshots/customer-orders/seller/00-initial.png) |
| `/customer-orders` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/customer-orders/seller/00-initial.png) |
| `/customer-orders` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Couldn't load this customer. Check your connection and try again." | [view](../../docs/audit/screenshots/customer-orders/buyer/00-initial.png) |
| `/customer-orders` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/customer-orders/buyer/00-initial.png) |
| `/fulfill-order` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/fulfill-order/seller/00-initial.png) |
| `/fulfill-order` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/fulfill-order/buyer/00-initial.png) |
| `/order-detail` | seller | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Go Back" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/order-detail/seller/00-initial.png) |
| `/order-detail` | buyer | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Go Back" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/order-detail/buyer/00-initial.png) |
| `/orders` | seller | color-rule-violation | warn | Non-monochrome, non-allowed color rgb(255, 213, 128) on "NEW" | [view](../../docs/audit/screenshots/orders/seller/00-initial.png) |
| `/orders` | seller | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Orders" | [view](../../docs/audit/screenshots/orders/seller/00-initial.png) |
| `/orders` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Accept" | [view](../../docs/audit/screenshots/orders/seller/00-initial.png) |
| `/orders` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Accept" | [view](../../docs/audit/screenshots/orders/seller/00-initial.png) |
| `/orders` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Ready" | [view](../../docs/audit/screenshots/orders/seller/00-initial.png) |
| `/orders` | seller | hit-target-too-small | warn | 87x24px control "Orders" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/orders/seller/00-initial.png) |
| `/orders` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/orders/seller/00-initial.png) |
| `/orders` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/orders/seller/00-initial.png) |
| `/orders` | seller | hit-target-too-small | warn | 121x36px control "Accept" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/orders/seller/00-initial.png) |
| `/orders` | seller | hit-target-too-small | warn | 121x36px control "Accept" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/orders/seller/00-initial.png) |
| `/orders` | seller | hit-target-too-small | warn | 115x36px control "Ready" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/orders/seller/00-initial.png) |
| `/orders` | seller | hit-target-too-small | warn | 103x36px control "Ship" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/orders/seller/00-initial.png) |
| `/orders` | buyer | color-rule-violation | warn | Non-monochrome, non-allowed color rgb(255, 213, 128) on "NEW" | [view](../../docs/audit/screenshots/orders/buyer/00-initial.png) |
| `/orders` | buyer | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Orders" | [view](../../docs/audit/screenshots/orders/buyer/00-initial.png) |
| `/orders` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Accept" | [view](../../docs/audit/screenshots/orders/buyer/00-initial.png) |
| `/orders` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Accept" | [view](../../docs/audit/screenshots/orders/buyer/00-initial.png) |
| `/orders` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Ready" | [view](../../docs/audit/screenshots/orders/buyer/00-initial.png) |
| `/orders` | buyer | hit-target-too-small | warn | 87x24px control "Orders" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/orders/buyer/00-initial.png) |
| `/orders` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/orders/buyer/00-initial.png) |
| `/orders` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/orders/buyer/00-initial.png) |
| `/orders` | buyer | hit-target-too-small | warn | 121x36px control "Accept" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/orders/buyer/00-initial.png) |
| `/orders` | buyer | hit-target-too-small | warn | 121x36px control "Accept" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/orders/buyer/00-initial.png) |
| `/orders` | buyer | hit-target-too-small | warn | 115x36px control "Ready" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/orders/buyer/00-initial.png) |
| `/orders` | buyer | hit-target-too-small | warn | 103x36px control "Ship" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/orders/buyer/00-initial.png) |

### Live (52)

| Route | Role | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|
| `/buyer-live` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-live/seller/00-initial.png) |
| `/live` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/live/seller/00-initial.png) |
| `/live` | seller | console-error | hard | Failed to load because no supported source was found. | [view](../../docs/audit/screenshots/live/seller/00-initial.png) |
| `/live` | buyer | console-error | hard | Failed to load because no supported source was found. | [view](../../docs/audit/screenshots/live/buyer/00-initial.png) |
| `/live` | seller | type-scale-drift | warn | font-size 8.5px not on declared FS scale (nearest 11) on "LIVE" | [view](../../docs/audit/screenshots/live/seller/00-initial.png) |
| `/live` | seller | type-scale-drift | warn | font-size 9px not on declared FS scale (nearest 11) on "MW" | [view](../../docs/audit/screenshots/live/seller/00-initial.png) |
| `/live` | seller | type-scale-drift | warn | font-size 9px not on declared FS scale (nearest 11) on "AI" | [view](../../docs/audit/screenshots/live/seller/00-initial.png) |
| `/live` | seller | type-scale-drift | warn | font-size 9px not on declared FS scale (nearest 11) on "OD" | [view](../../docs/audit/screenshots/live/seller/00-initial.png) |
| `/live` | seller | type-scale-drift | warn | font-size 9px not on declared FS scale (nearest 11) on "3" | [view](../../docs/audit/screenshots/live/seller/00-initial.png) |
| `/live` | seller | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "NOW SELLING · 6 LEFT" | [view](../../docs/audit/screenshots/live/seller/00-initial.png) |
| `/live` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Sculpted Wool Coat" | [view](../../docs/audit/screenshots/live/seller/00-initial.png) |
| `/live` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "$480.00" | [view](../../docs/audit/screenshots/live/seller/00-initial.png) |
| `/live` | seller | min-size-violation | warn | font-size 8.5px below the 11pt caption floor on "LIVE" | [view](../../docs/audit/screenshots/live/seller/00-initial.png) |
| `/live` | seller | min-size-violation | warn | font-size 9px below the 11pt caption floor on "MW" | [view](../../docs/audit/screenshots/live/seller/00-initial.png) |
| `/live` | seller | min-size-violation | warn | font-size 9px below the 11pt caption floor on "AI" | [view](../../docs/audit/screenshots/live/seller/00-initial.png) |
| `/live` | seller | min-size-violation | warn | font-size 9px below the 11pt caption floor on "OD" | [view](../../docs/audit/screenshots/live/seller/00-initial.png) |
| `/live` | seller | min-size-violation | warn | font-size 9px below the 11pt caption floor on "3" | [view](../../docs/audit/screenshots/live/seller/00-initial.png) |
| `/live` | seller | min-size-violation | warn | font-size 10px below the 11pt caption floor on "NOW SELLING · 6 LEFT" | [view](../../docs/audit/screenshots/live/seller/00-initial.png) |
| `/live` | seller | contrast-violation | warn | contrast 3.55:1 (need 4.5:1) for "LIVE" — rgb(255, 255, 255) on rgb(255, 59, 48) | [view](../../docs/audit/screenshots/live/seller/00-initial.png) |
| `/live` | seller | hit-target-too-small | warn | 136x32px control "ANAtelier NoireLIVE2.4K" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/live/seller/00-initial.png) |
| `/live` | seller | hit-target-too-small | warn | 34x28px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/live/seller/00-initial.png) |
| `/live` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/live/seller/00-initial.png) |
| `/live` | seller | hit-target-too-small | warn | 44x40px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/live/seller/00-initial.png) |
| `/live` | seller | hit-target-too-small | warn | 44x40px control "3" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/live/seller/00-initial.png) |
| `/live` | seller | hit-target-too-small | warn | 44x40px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/live/seller/00-initial.png) |
| `/live` | seller | hit-target-too-small | warn | 57x32px control "Buy" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/live/seller/00-initial.png) |
| `/live` | seller | hit-target-too-small | warn | 36x36px control "button" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/live/seller/00-initial.png) |
| `/live` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/live/seller/00-initial.png) |
| `/live` | buyer | type-scale-drift | warn | font-size 8.5px not on declared FS scale (nearest 11) on "LIVE" | [view](../../docs/audit/screenshots/live/buyer/00-initial.png) |
| `/live` | buyer | type-scale-drift | warn | font-size 9px not on declared FS scale (nearest 11) on "MW" | [view](../../docs/audit/screenshots/live/buyer/00-initial.png) |
| `/live` | buyer | type-scale-drift | warn | font-size 9px not on declared FS scale (nearest 11) on "AI" | [view](../../docs/audit/screenshots/live/buyer/00-initial.png) |
| `/live` | buyer | type-scale-drift | warn | font-size 9px not on declared FS scale (nearest 11) on "OD" | [view](../../docs/audit/screenshots/live/buyer/00-initial.png) |
| `/live` | buyer | type-scale-drift | warn | font-size 9px not on declared FS scale (nearest 11) on "3" | [view](../../docs/audit/screenshots/live/buyer/00-initial.png) |
| `/live` | buyer | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "NOW SELLING · 6 LEFT" | [view](../../docs/audit/screenshots/live/buyer/00-initial.png) |
| `/live` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Sculpted Wool Coat" | [view](../../docs/audit/screenshots/live/buyer/00-initial.png) |
| `/live` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "$480.00" | [view](../../docs/audit/screenshots/live/buyer/00-initial.png) |
| `/live` | buyer | min-size-violation | warn | font-size 8.5px below the 11pt caption floor on "LIVE" | [view](../../docs/audit/screenshots/live/buyer/00-initial.png) |
| `/live` | buyer | min-size-violation | warn | font-size 9px below the 11pt caption floor on "MW" | [view](../../docs/audit/screenshots/live/buyer/00-initial.png) |
| `/live` | buyer | min-size-violation | warn | font-size 9px below the 11pt caption floor on "AI" | [view](../../docs/audit/screenshots/live/buyer/00-initial.png) |
| `/live` | buyer | min-size-violation | warn | font-size 9px below the 11pt caption floor on "OD" | [view](../../docs/audit/screenshots/live/buyer/00-initial.png) |
| `/live` | buyer | min-size-violation | warn | font-size 9px below the 11pt caption floor on "3" | [view](../../docs/audit/screenshots/live/buyer/00-initial.png) |
| `/live` | buyer | min-size-violation | warn | font-size 10px below the 11pt caption floor on "NOW SELLING · 6 LEFT" | [view](../../docs/audit/screenshots/live/buyer/00-initial.png) |
| `/live` | buyer | contrast-violation | warn | contrast 3.55:1 (need 4.5:1) for "LIVE" — rgb(255, 255, 255) on rgb(255, 59, 48) | [view](../../docs/audit/screenshots/live/buyer/00-initial.png) |
| `/live` | buyer | hit-target-too-small | warn | 136x32px control "ANAtelier NoireLIVE2.4K" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/live/buyer/00-initial.png) |
| `/live` | buyer | hit-target-too-small | warn | 34x28px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/live/buyer/00-initial.png) |
| `/live` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/live/buyer/00-initial.png) |
| `/live` | buyer | hit-target-too-small | warn | 44x40px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/live/buyer/00-initial.png) |
| `/live` | buyer | hit-target-too-small | warn | 44x40px control "3" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/live/buyer/00-initial.png) |
| `/live` | buyer | hit-target-too-small | warn | 44x40px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/live/buyer/00-initial.png) |
| `/live` | buyer | hit-target-too-small | warn | 57x32px control "Buy" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/live/buyer/00-initial.png) |
| `/live` | buyer | hit-target-too-small | warn | 36x36px control "button" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/live/buyer/00-initial.png) |
| `/live` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/live/buyer/00-initial.png) |

### Messaging (51)

| Route | Role | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|
| `/(buyer)/inbox` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/ai-mockup-chat` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/ai-mockup-chat/seller/00-initial.png) |
| `/ai-photography-chat` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/ai-photography-chat/seller/00-initial.png) |
| `/community-chat` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/community-chat/seller/00-initial.png) |
| `/manufacturer-messages` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/manufacturer-messages/seller/00-initial.png) |
| `/manufacturer-messages` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/manufacturer-messages/buyer/00-initial.png) |
| `/(buyer)/inbox` | seller | clipped-text | warn | Text clipped (128px into 64px): "Your thoughts go here..." | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | clipped-text | warn | Text clipped (400px into 260px): "Any chance the Ember hoodie ships before Friday? · #NS-1048" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | clipped-text | warn | Text clipped (325px into 253px): "How does the Field Shell fit? I’m usually a medium." | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | clipped-text | warn | Text clipped (273px into 257px): "Can I swap the hoodie to Bone? · #NS-1045" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | overlapping-text | warn | "Read" overlaps "Any chance the Ember hoodie ships before Friday? · #NS-1048" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | overlapping-text | warn | "Pin" overlaps "Any chance the Ember hoodie ships before Friday? · #NS-1048" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | overlapping-text | warn | "Mute" overlaps "Any chance the Ember hoodie ships before Friday? · #NS-1048" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | overlapping-text | warn | "Delete" overlaps "Any chance the Ember hoodie ships before Friday? · #NS-1048" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | overlapping-text | warn | "Read" overlaps "How does the Field Shell fit? I’m usually a medium." | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | overlapping-text | warn | "Pin" overlaps "How does the Field Shell fit? I’m usually a medium." | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | overlapping-text | warn | "Mute" overlaps "How does the Field Shell fit? I’m usually a medium." | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | overlapping-text | warn | "Delete" overlaps "How does the Field Shell fit? I’m usually a medium." | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | overlapping-text | warn | "Read" overlaps "Got it, thanks for the tracking!" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | overlapping-text | warn | "Pin" overlaps "Got it, thanks for the tracking!" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | overlapping-text | warn | "Mute" overlaps "Got it, thanks for the tracking!" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | overlapping-text | warn | "Delete" overlaps "Got it, thanks for the tracking!" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | overlapping-text | warn | "Read" overlaps "Can I swap the hoodie to Bone? · #NS-1045" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | overlapping-text | warn | "Pin" overlaps "Can I swap the hoodie to Bone? · #NS-1045" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | overlapping-text | warn | "Mute" overlaps "Can I swap the hoodie to Bone? · #NS-1045" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | overlapping-text | warn | "Delete" overlaps "Can I swap the hoodie to Bone? · #NS-1045" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | overlapping-text | warn | "Read" overlaps "Will the cargo come back in rust?" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | overlapping-text | warn | "Pin" overlaps "Will the cargo come back in rust?" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | overlapping-text | warn | "Mute" overlaps "Will the cargo come back in rust?" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | overlapping-text | warn | "Delete" overlaps "Will the cargo come back in rust?" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Messages" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | hit-target-too-small | warn | 36x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | buyer | clipped-text | warn | Text clipped (128px into 64px): "Your thoughts go here..." | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Messages" | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Send a message" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | hit-target-too-small | warn | 36x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/ai-mockup-chat` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Describe the garment, your brand and the design — I'll turn it into a photo-real mockup." | [view](../../docs/audit/screenshots/ai-mockup-chat/seller/00-initial.png) |
| `/ai-mockup-chat` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Describe the garment, your brand and the design — I'll turn it into a photo-real mockup." | [view](../../docs/audit/screenshots/ai-mockup-chat/buyer/00-initial.png) |
| `/ai-photography-chat` | seller | clipped-text | warn | Text clipped (251px into 246px): "AI Product Photography" | [view](../../docs/audit/screenshots/ai-photography-chat/seller/00-initial.png) |
| `/ai-photography-chat` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Add photos of your piece, plus any reference shots, and tell me the vibe. I'll shoot it in studio." | [view](../../docs/audit/screenshots/ai-photography-chat/seller/00-initial.png) |
| `/ai-photography-chat` | buyer | clipped-text | warn | Text clipped (251px into 246px): "AI Product Photography" | [view](../../docs/audit/screenshots/ai-photography-chat/buyer/00-initial.png) |
| `/ai-photography-chat` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Add photos of your piece, plus any reference shots, and tell me the vibe. I'll shoot it in studio." | [view](../../docs/audit/screenshots/ai-photography-chat/buyer/00-initial.png) |
| `/community-chat` | seller | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Back to dashboard" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/community-chat/seller/00-initial.png) |
| `/community-chat` | buyer | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Back to dashboard" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/community-chat/buyer/00-initial.png) |
| `/manufacturer-messages` | seller | hit-target-too-small | warn | 36x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer-messages/seller/00-initial.png) |
| `/manufacturer-messages` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer-messages/seller/00-initial.png) |
| `/manufacturer-messages` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer-messages/seller/00-initial.png) |
| `/manufacturer-messages` | buyer | hit-target-too-small | warn | 36x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer-messages/buyer/00-initial.png) |
| `/manufacturer-messages` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer-messages/buyer/00-initial.png) |
| `/manufacturer-messages` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/manufacturer-messages/buyer/00-initial.png) |

### Products (38)

| Route | Role | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|
| `/add-product` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/add-product/seller/00-initial.png) |
| `/buyer-product-detail` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/buyer-product-detail/seller/00-initial.png) |
| `/product-bundle-edit` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/product-bundle-edit/seller/00-initial.png) |
| `/product-bundles` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/product-bundles/seller/00-initial.png) |
| `/product-bundles` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/product-bundles/buyer/00-initial.png) |
| `/product-detail` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/product-detail/seller/00-initial.png) |
| `/product-editor` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/product-editor/seller/00-initial.png) |
| `/product-import` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/product-import/seller/00-initial.png) |
| `/product-reviews` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/product-reviews/seller/00-initial.png) |
| `/product-size-chart` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/product-size-chart/seller/00-initial.png) |
| `/product-size-chart` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/product-size-chart/buyer/00-initial.png) |
| `/product-store` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/product-store/seller/00-initial.png) |
| `/production-detail` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/production-detail/seller/00-initial.png) |
| `/production-detail` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/production-detail/buyer/00-initial.png) |
| `/add-product` | seller | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Next" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/add-product/seller/00-initial.png) |
| `/add-product` | buyer | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Next" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/add-product/buyer/00-initial.png) |
| `/product-bundle-edit` | seller | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Create Bundle" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/product-bundle-edit/seller/00-initial.png) |
| `/product-bundle-edit` | seller | hit-target-too-small | warn | 36x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/product-bundle-edit/seller/00-initial.png) |
| `/product-bundle-edit` | buyer | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Create Bundle" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/product-bundle-edit/buyer/00-initial.png) |
| `/product-bundle-edit` | buyer | hit-target-too-small | warn | 36x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/product-bundle-edit/buyer/00-initial.png) |
| `/product-bundles` | seller | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Create first bundle" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/product-bundles/seller/00-initial.png) |
| `/product-bundles` | seller | hit-target-too-small | warn | 36x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/product-bundles/seller/00-initial.png) |
| `/product-bundles` | buyer | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Create first bundle" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/product-bundles/buyer/00-initial.png) |
| `/product-bundles` | buyer | hit-target-too-small | warn | 36x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/product-bundles/buyer/00-initial.png) |
| `/product-detail` | seller | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Try again" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/product-detail/seller/00-initial.png) |
| `/product-detail` | buyer | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Try again" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/product-detail/buyer/00-initial.png) |
| `/product-editor` | seller | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Next" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/product-editor/seller/00-initial.png) |
| `/product-editor` | buyer | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Next" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/product-editor/buyer/00-initial.png) |
| `/product-import` | seller | color-rule-violation | warn | Non-monochrome, non-allowed color rgb(16, 185, 129) on "Supported" | [view](../../docs/audit/screenshots/product-import/seller/00-initial.png) |
| `/product-import` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/product-import/seller/00-initial.png) |
| `/product-import` | buyer | color-rule-violation | warn | Non-monochrome, non-allowed color rgb(16, 185, 129) on "Supported" | [view](../../docs/audit/screenshots/product-import/buyer/00-initial.png) |
| `/product-import` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/product-import/buyer/00-initial.png) |
| `/product-size-chart` | seller | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Save Size Chart" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/product-size-chart/seller/00-initial.png) |
| `/product-size-chart` | seller | hit-target-too-small | warn | 36x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/product-size-chart/seller/00-initial.png) |
| `/product-size-chart` | buyer | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Save Size Chart" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/product-size-chart/buyer/00-initial.png) |
| `/product-size-chart` | buyer | hit-target-too-small | warn | 36x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/product-size-chart/buyer/00-initial.png) |
| `/production-detail` | seller | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/production-detail/seller/00-initial.png) |
| `/production-detail` | buyer | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/production-detail/buyer/00-initial.png) |

### AI / Studio tools (25)

| Route | Role | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|
| `/ai-assistant` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/ai-assistant/seller/00-initial.png) |
| `/ai-brain` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/ai-brain/seller/00-initial.png) |
| `/ai-brand-memory` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/ai-brand-memory/seller/00-initial.png) |
| `/ai-studio` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/ai-studio/seller/00-initial.png) |
| `/ai-studio` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/ai-studio/buyer/00-initial.png) |
| `/design-ai-photoshoot` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/design-ai-photoshoot/seller/00-initial.png) |
| `/design-ai-photoshoot` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/design-ai-photoshoot/buyer/00-initial.png) |
| `/ai-assistant` | seller | hit-target-too-small | warn | 40x40px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/ai-assistant/seller/00-initial.png) |
| `/ai-assistant` | buyer | hit-target-too-small | warn | 40x40px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/ai-assistant/buyer/00-initial.png) |
| `/ai-brain` | seller | hit-target-too-small | warn | 40x40px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/ai-brain/seller/00-initial.png) |
| `/ai-brain` | buyer | hit-target-too-small | warn | 40x40px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/ai-brain/buyer/00-initial.png) |
| `/ai-studio` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "AI Clothing Mockups" | [view](../../docs/audit/screenshots/ai-studio/seller/00-initial.png) |
| `/ai-studio` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "AI Product Photography" | [view](../../docs/audit/screenshots/ai-studio/seller/00-initial.png) |
| `/ai-studio` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Background Removal" | [view](../../docs/audit/screenshots/ai-studio/seller/00-initial.png) |
| `/ai-studio` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Lifestyle Images" | [view](../../docs/audit/screenshots/ai-studio/seller/00-initial.png) |
| `/ai-studio` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Tech Pack Generator" | [view](../../docs/audit/screenshots/ai-studio/seller/00-initial.png) |
| `/ai-studio` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "AI Clothing Mockups" | [view](../../docs/audit/screenshots/ai-studio/buyer/00-initial.png) |
| `/ai-studio` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "AI Product Photography" | [view](../../docs/audit/screenshots/ai-studio/buyer/00-initial.png) |
| `/ai-studio` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Background Removal" | [view](../../docs/audit/screenshots/ai-studio/buyer/00-initial.png) |
| `/ai-studio` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Lifestyle Images" | [view](../../docs/audit/screenshots/ai-studio/buyer/00-initial.png) |
| `/ai-studio` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Tech Pack Generator" | [view](../../docs/audit/screenshots/ai-studio/buyer/00-initial.png) |
| `/design-ai-photoshoot` | seller | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Next" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/design-ai-photoshoot/seller/00-initial.png) |
| `/design-ai-photoshoot` | seller | hit-target-too-small | warn | 36x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/design-ai-photoshoot/seller/00-initial.png) |
| `/design-ai-photoshoot` | buyer | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Next" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/design-ai-photoshoot/buyer/00-initial.png) |
| `/design-ai-photoshoot` | buyer | hit-target-too-small | warn | 36x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/design-ai-photoshoot/buyer/00-initial.png) |
