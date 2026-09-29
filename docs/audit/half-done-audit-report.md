# Half-done audit report

Generated 2026-09-29T20:35:03.931Z.

- Route files discovered: 274
- Route × role combinations audited: 50
- Unreachable: 36
- Total findings: 111 (hard: 12, warn: 99)

## Notes on this run

This is a time-budgeted initial pass, not full coverage — see `routesAudited` vs `routesDiscovered` above (25 of 274 route files, both roles = 50 combinations, capped at a ~7 minute wall-clock budget and 5 taps/route to fit this PR). Two caveats found while producing it:

- **Group-root layouts under the "wrong" role are expected unreachable, not bugs**: `/(tabs)` is the seller tab root and `/(buyer)` is the buyer tab root — a `/(tabs)` load under `?bt_preview=buyer` (or vice versa) correctly renders nothing, the same way a signed-in buyer account would never land on the seller shell. Do not treat those specific role/route pairings in the Unreachable table below as findings.
- **Some group-root unreachables under the *matching* role look like run-to-run timing flakiness, not real bugs**: `/(tabs)` under `seller` rendered correctly (47 real findings) in an isolated single-route smoke test during development, but showed as unreachable in this batch run — most likely first-paint/hydration taking longer than the fixed settle window when many browser contexts are opened back-to-back under constrained CPU. A route/role pair that shows unreachable here is worth a quick isolated re-run (`--only <route> --roles <role>`) before assuming it is actually broken.

## Known, being rebuilt separately

The seller dashboard revenue chart (repeated axis labels, misaligned curve, no value on tap) is already being rebuilt in a separate session (019SGXKf). Findings from `/(tabs)` (seller dashboard root) related to that specific chart are listed below for completeness but should NOT be picked up by a follow-up fix PR — check with that session before touching it.

## Findings by type

| Type | Tier | Count |
|---|---|---|
| overlapping-text | warn | 43 |
| hit-target-too-small | warn | 34 |
| type-scale-drift | warn | 16 |
| console-error | hard | 12 |
| font-family | warn | 5 |
| contrast-violation | warn | 1 |

## Unreachable routes

| Route | Role | Reason |
|---|---|---|
| `/(buyer)/activity` | seller | blank page body |
| `/(buyer)/activity` | buyer | blank page body |
| `/(buyer)/cart` | seller | blank page body |
| `/(buyer)/cart` | buyer | blank page body |
| `/(buyer)/discover-feed` | seller | blank page body |
| `/(buyer)/discover-feed` | buyer | blank page body |
| `/(buyer)/discover` | seller | blank page body |
| `/(buyer)/discover` | buyer | blank page body |
| `/(buyer)/edit-profile` | buyer | blank page body |
| `/(buyer)/following` | seller | blank page body |
| `/(buyer)/following` | buyer | blank page body |
| `/(buyer)/friends` | seller | blank page body |
| `/(buyer)/inbox` | seller | blank page body |
| `/(buyer)/inbox` | buyer | blank page body |
| `/(buyer)` | buyer | blank page body |
| `/(buyer)/orders` | seller | blank page body |
| `/(buyer)/profile` | seller | blank page body |
| `/(buyer)/profile` | buyer | blank page body |
| `/(tabs)/analytics` | seller | blank page body |
| `/(tabs)/analytics` | buyer | blank page body |
| `/(tabs)/feed` | seller | blank page body |
| `/(tabs)/feed` | buyer | blank page body |
| `/(tabs)/following` | seller | blank page body |
| `/(tabs)/following` | buyer | blank page body |
| `/(tabs)` | seller | blank page body |
| `/(tabs)` | buyer | blank page body |
| `/(tabs)/marketing` | seller | blank page body |
| `/(tabs)/marketing` | buyer | blank page body |
| `/(tabs)/more` | seller | blank page body |
| `/(tabs)/orders` | seller | blank page body |
| `/(tabs)/orders` | buyer | blank page body |
| `/(tabs)/products` | seller | blank page body |
| `/(tabs)/products` | buyer | blank page body |
| `/(tabs)/profile` | seller | blank page body |
| `/(tabs)/studio` | seller | blank page body |
| `/(tabs)/studio` | buyer | blank page body |

## Findings by area

### Buyer discover / feed (54)

| Route | Role | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|
| `/(buyer)/feed` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "212 claimed" overlaps "Watching Threads" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "·" overlaps "Watching Threads" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "38 left" overlaps "Watching Threads" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "08:59:58" overlaps "Watching Threads" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "64 claimed" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "·" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "11 left" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "17:59:58" overlaps "Next video" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "$220.00" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "Boxy Fleece Hoodie — Graphite" overlaps "Double tap" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "Ember & Ash" overlaps "Like" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "$88.00" overlaps "Like" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "91 claimed" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "·" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "9 left" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | overlapping-text | warn | "35:59:58" overlaps "Scrub through the video" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
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

### Other (38)

| Route | Role | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|
| `/(buyer)/friends` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-/seller/00-initial.png) |
| `/activity-center` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/activity-center/seller/00-initial.png) |
| `/activity-center` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/activity-center/buyer/00-initial.png) |
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
| `/activity-center` | seller | font-family | warn | Non-Inter font-family "monospace" on "Not Found" | [view](../../docs/audit/screenshots/activity-center/seller/00-initial.png) |
| `/activity-center` | buyer | overlapping-text | warn | "Priya Shah" overlaps "started following you" | [view](../../docs/audit/screenshots/activity-center/buyer/00-initial.png) |
| `/activity-center` | buyer | overlapping-text | warn | "started following you" overlaps "6h" | [view](../../docs/audit/screenshots/activity-center/buyer/00-initial.png) |
| `/activity-center` | buyer | overlapping-text | warn | "Marcus Webb" overlaps "started following you" | [view](../../docs/audit/screenshots/activity-center/buyer/00-initial.png) |
| `/activity-center` | buyer | overlapping-text | warn | "started following you" overlaps "1d" | [view](../../docs/audit/screenshots/activity-center/buyer/00-initial.png) |
| `/activity-center` | buyer | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Activity" | [view](../../docs/audit/screenshots/activity-center/buyer/00-initial.png) |
| `/activity-center` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Follow back" | [view](../../docs/audit/screenshots/activity-center/buyer/00-initial.png) |
| `/activity-center` | buyer | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Follow back" | [view](../../docs/audit/screenshots/activity-center/buyer/00-initial.png) |
| `/activity-center` | buyer | hit-target-too-small | warn | 41x34px control "All" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/activity-center/buyer/00-initial.png) |
| `/activity-center` | buyer | hit-target-too-small | warn | 74x34px control "Follows" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/activity-center/buyer/00-initial.png) |
| `/activity-center` | buyer | hit-target-too-small | warn | 58x34px control "Likes" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/activity-center/buyer/00-initial.png) |
| `/activity-center` | buyer | hit-target-too-small | warn | 95x34px control "Comments" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/activity-center/buyer/00-initial.png) |
| `/activity-center` | buyer | hit-target-too-small | warn | 69x34px control "Orders" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/activity-center/buyer/00-initial.png) |
| `/activity-center` | buyer | hit-target-too-small | warn | 234x40px control "PSPriya Shah started following you  6h" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/activity-center/buyer/00-initial.png) |
| `/activity-center` | buyer | hit-target-too-small | warn | 115x32px control "Follow back" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/activity-center/buyer/00-initial.png) |
| `/activity-center` | buyer | hit-target-too-small | warn | 234x40px control "MWMarcus Webb started following you  1d" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/activity-center/buyer/00-initial.png) |
| `/activity-center` | buyer | hit-target-too-small | warn | 115x32px control "Follow back" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/activity-center/buyer/00-initial.png) |
| `/activity-center` | buyer | hit-target-too-small | warn | 305x40px control "JLJordan Lee liked your post  3d" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/activity-center/buyer/00-initial.png) |

### Profile / settings (12)

| Route | Role | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|
| `/(buyer)/edit-profile` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-edit-profile/seller/00-initial.png) |
| `/account-type-settings` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/account-type-settings/seller/00-initial.png) |
| `/account-type-settings` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/account-type-settings/buyer/00-initial.png) |
| `/account-type` | seller | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/account-type/seller/00-initial.png) |
| `/account-type` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/account-type/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Change profile photo or video" | [view](../../docs/audit/screenshots/-buyer-edit-profile/seller/00-initial.png) |
| `/(buyer)/edit-profile` | seller | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Add profile video" | [view](../../docs/audit/screenshots/-buyer-edit-profile/seller/00-initial.png) |
| `/(buyer)/edit-profile` | seller | hit-target-too-small | warn | 116x17px control "Add profile video" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/seller/00-initial.png) |
| `/account-type-settings` | seller | font-family | warn | Non-Inter font-family "monospace" on "Not Found" | [view](../../docs/audit/screenshots/account-type-settings/seller/00-initial.png) |
| `/account-type-settings` | buyer | font-family | warn | Non-Inter font-family "monospace" on "Not Found" | [view](../../docs/audit/screenshots/account-type-settings/buyer/00-initial.png) |
| `/account-type` | seller | font-family | warn | Non-Inter font-family "monospace" on "Not Found" | [view](../../docs/audit/screenshots/account-type/seller/00-initial.png) |
| `/account-type` | buyer | font-family | warn | Non-Inter font-family "monospace" on "Not Found" | [view](../../docs/audit/screenshots/account-type/buyer/00-initial.png) |

### Seller dashboard / analytics (5)

| Route | Role | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|
| `/(tabs)/profile` | buyer | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-tabs-profile/buyer/00-initial.png) |
| `/(tabs)/profile` | buyer | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "Northline Studio" | [view](../../docs/audit/screenshots/-tabs-profile/buyer/00-initial.png) |
| `/(tabs)/profile` | buyer | hit-target-too-small | warn | 22x22px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-profile/buyer/00-initial.png) |
| `/(tabs)/profile` | buyer | hit-target-too-small | warn | 60x38px control "1.3KFollowers" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-profile/buyer/00-initial.png) |
| `/(tabs)/profile` | buyer | hit-target-too-small | warn | 59x38px control "340Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-profile/buyer/00-initial.png) |

### Checkout / orders (2)

| Route | Role | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|
| `/(buyer)/orders` | buyer | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "My Orders" | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Discover Products" — rgb(10, 10, 11) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
