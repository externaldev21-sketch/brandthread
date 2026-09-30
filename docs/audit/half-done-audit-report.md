# Half-done audit report

Generated 2026-09-30T03:15:00.263Z.

- Route files discovered: 266
- Route × role combinations audited: 80
- Unreachable: 67
- Total findings: 157 (hard: 13, warn: 144)

## Scoreboard by area/owner

Each owning session's row — see `route-ownership.mjs`/`route-ownership.json` for the mapping rules and `docs/audit/README.md` for the heuristic writeup. Counts are per unique route (not per route×role×data-state combo): a route counts once toward "zero-finding routes" only if it produced no hard AND no warn finding under any role/state it was audited in, and once toward "routes still failing" if it has any hard-tier finding or was unreachable under any role/state.

| Area/owner | Hard | Warn | Routes | Zero-finding routes | Routes still failing |
|---|---|---|---|---|---|
| buyer (session 01AaWLh1) | 9 | 76 | 6 | 0 | 6 |
| profiles+social (session 01MjTkyh) | 4 | 68 | 8 | 0 | 8 |
| growth (session 019SGXKf) | 0 | 0 | 3 | 0 | 3 |
| store+account (session 01Cdzzzi) | 0 | 0 | 1 | 0 | 1 |
| seller commerce (session 011WGHYC) | 0 | 0 | 2 | 0 | 2 |

## Notes on this run

This is a time-budgeted pass, not full coverage — see `routesAudited` vs `routesDiscovered` above. One caveat found while producing it:

- **Group-root layouts under the "wrong" role are expected unreachable, not bugs**: `/(tabs)` is the seller tab root and `/(buyer)` is the buyer tab root — a `/(tabs)` load under `?bt_preview=buyer` (or vice versa) correctly renders nothing, the same way a signed-in buyer account would never land on the seller shell. Do not treat those specific role/route pairings in the Unreachable table below as findings.

An earlier version of this script flagged the *matching*-role case (e.g. `/(tabs)` under `seller`) as unreachable too, flakily — the fast client-side `history.pushState`/`popstate` navigation used between routes was occasionally still mid-render when the reachability check ran. The script now retries once with a real full-page reload before giving up, which fixed that: unreachable dropped from 72% of routes in the initial sample to a small handful in a full run. A route/role pair that still shows unreachable below reflects a real full-navigation blank body — either a genuine redirect-only route with no rendered content, or worth a closer look.

## Known, being rebuilt separately

The seller dashboard revenue chart (repeated axis labels, misaligned curve, no value on tap) is already being rebuilt in a separate session (019SGXKf). Findings from `/(tabs)` (seller dashboard root) related to that specific chart are listed below for completeness but should NOT be picked up by a follow-up fix PR — check with that session before touching it.

## Findings by type

| Type | Tier | Count |
|---|---|---|
| hit-target-too-small | warn | 78 |
| overlapping-text | warn | 28 |
| type-scale-drift | warn | 22 |
| console-error | hard | 13 |
| font-family | warn | 8 |
| color-rule-violation | warn | 4 |
| contrast-violation | warn | 4 |

## Unreachable routes

| Route | Role | Data state | Reason |
|---|---|---|---|
| `/(buyer)/discover` | seller | demo | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/discover` | buyer | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/discover` | buyer | demo | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/edit-profile` | seller | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/edit-profile` | seller | demo | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/edit-profile` | buyer | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/edit-profile` | buyer | demo | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/feed` | seller | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/feed` | seller | demo | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/feed` | buyer | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/feed` | buyer | demo | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/following` | seller | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/following` | seller | demo | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/following` | buyer | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/following` | buyer | demo | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/friends` | seller | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/friends` | seller | demo | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/friends` | buyer | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/friends` | buyer | demo | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/inbox` | seller | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/inbox` | seller | demo | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/inbox` | buyer | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/inbox` | buyer | demo | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)` | seller | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)` | seller | demo | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)` | buyer | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)` | buyer | demo | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/orders` | seller | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/orders` | seller | demo | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/orders` | buyer | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/orders` | buyer | demo | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/profile` | seller | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/profile` | seller | demo | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/profile` | buyer | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(buyer)/profile` | buyer | demo | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)/analytics` | seller | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)/analytics` | seller | demo | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)/analytics` | buyer | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)/analytics` | buyer | demo | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)/feed` | seller | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)/feed` | seller | demo | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)/feed` | buyer | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)/feed` | buyer | demo | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)/following` | seller | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)/following` | seller | demo | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)/following` | buyer | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)/following` | buyer | demo | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)` | seller | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)` | seller | demo | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)` | buyer | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)` | buyer | demo | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)/marketing` | seller | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)/marketing` | seller | demo | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)/marketing` | buyer | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)/marketing` | buyer | demo | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)/more` | seller | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)/more` | seller | demo | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)/more` | buyer | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)/more` | buyer | demo | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)/orders` | seller | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)/orders` | seller | demo | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)/orders` | buyer | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)/orders` | buyer | demo | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)/products` | seller | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)/products` | seller | demo | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)/products` | buyer | fresh | browser.newContext: Target page, context or browser has been closed |
| `/(tabs)/products` | buyer | demo | browser.newContext: Target page, context or browser has been closed |

## Findings by area (audit-script grouping, not the owner scoreboard above)

### Other (72)

| Route | Role | Data state | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|---|
| `/(buyer)/activity` | seller | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | buyer | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | seller | fresh | overlapping-text | warn | "Priya Shah" overlaps "started following you" | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | fresh | overlapping-text | warn | "started following you" overlaps "6h" | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | fresh | overlapping-text | warn | "Marcus Webb" overlaps "started following you" | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | fresh | overlapping-text | warn | "started following you" overlaps "1d" | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | fresh | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Activity" | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Follow back" | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Follow back" | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | fresh | hit-target-too-small | warn | 41x34px control "All" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | fresh | hit-target-too-small | warn | 74x34px control "Follows" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | fresh | hit-target-too-small | warn | 58x34px control "Likes" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | fresh | hit-target-too-small | warn | 95x34px control "Comments" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | fresh | hit-target-too-small | warn | 69x34px control "Orders" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | fresh | hit-target-too-small | warn | 234x40px control "PSPriya Shah started following you  6h" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | fresh | hit-target-too-small | warn | 115x32px control "Follow back" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | fresh | hit-target-too-small | warn | 234x40px control "MWMarcus Webb started following you  1d" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | fresh | hit-target-too-small | warn | 115x32px control "Follow back" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | fresh | hit-target-too-small | warn | 305x40px control "JLJordan Lee liked your post  3d" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | demo | overlapping-text | warn | "Priya Shah" overlaps "started following you" | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | demo | overlapping-text | warn | "started following you" overlaps "6h" | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | demo | overlapping-text | warn | "Marcus Webb" overlaps "started following you" | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | demo | overlapping-text | warn | "started following you" overlaps "1d" | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | demo | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Activity" | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Follow back" | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Follow back" | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | demo | hit-target-too-small | warn | 41x34px control "All" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | demo | hit-target-too-small | warn | 74x34px control "Follows" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | demo | hit-target-too-small | warn | 58x34px control "Likes" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | demo | hit-target-too-small | warn | 95x34px control "Comments" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | demo | hit-target-too-small | warn | 69x34px control "Orders" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | demo | hit-target-too-small | warn | 234x40px control "PSPriya Shah started following you  6h" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | demo | hit-target-too-small | warn | 115x32px control "Follow back" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | demo | hit-target-too-small | warn | 234x40px control "MWMarcus Webb started following you  1d" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | demo | hit-target-too-small | warn | 115x32px control "Follow back" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | demo | hit-target-too-small | warn | 305x40px control "JLJordan Lee liked your post  3d" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | buyer | fresh | overlapping-text | warn | "Priya Shah" overlaps "started following you" | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | fresh | overlapping-text | warn | "started following you" overlaps "6h" | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | fresh | overlapping-text | warn | "Marcus Webb" overlaps "started following you" | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | fresh | overlapping-text | warn | "started following you" overlaps "1d" | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | fresh | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Activity" | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Follow back" | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Follow back" | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | fresh | hit-target-too-small | warn | 41x34px control "All" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | fresh | hit-target-too-small | warn | 74x34px control "Follows" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | fresh | hit-target-too-small | warn | 58x34px control "Likes" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | fresh | hit-target-too-small | warn | 95x34px control "Comments" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | fresh | hit-target-too-small | warn | 69x34px control "Orders" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | fresh | hit-target-too-small | warn | 234x40px control "PSPriya Shah started following you  6h" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | fresh | hit-target-too-small | warn | 115x32px control "Follow back" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | fresh | hit-target-too-small | warn | 234x40px control "MWMarcus Webb started following you  1d" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | fresh | hit-target-too-small | warn | 115x32px control "Follow back" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | fresh | hit-target-too-small | warn | 305x40px control "JLJordan Lee liked your post  3d" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | demo | overlapping-text | warn | "Priya Shah" overlaps "started following you" | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | demo | overlapping-text | warn | "started following you" overlaps "6h" | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | demo | overlapping-text | warn | "Marcus Webb" overlaps "started following you" | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | demo | overlapping-text | warn | "started following you" overlaps "1d" | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | demo | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Activity" | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Follow back" | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Follow back" | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | demo | hit-target-too-small | warn | 41x34px control "All" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | demo | hit-target-too-small | warn | 74x34px control "Follows" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | demo | hit-target-too-small | warn | 58x34px control "Likes" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | demo | hit-target-too-small | warn | 95x34px control "Comments" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | demo | hit-target-too-small | warn | 69x34px control "Orders" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | demo | hit-target-too-small | warn | 234x40px control "PSPriya Shah started following you  6h" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | demo | hit-target-too-small | warn | 115x32px control "Follow back" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | demo | hit-target-too-small | warn | 234x40px control "MWMarcus Webb started following you  1d" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | demo | hit-target-too-small | warn | 115x32px control "Follow back" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | demo | hit-target-too-small | warn | 305x40px control "JLJordan Lee liked your post  3d" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |

### Checkout / orders (60)

| Route | Role | Data state | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|---|
| `/(buyer)/cart` | seller | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | seller | fresh | overlapping-text | warn | "F" overlaps "$483.00" | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | fresh | overlapping-text | warn | "Field Office" overlaps "Checkout" | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | fresh | overlapping-text | warn | "@fieldoffice" overlaps "Checkout" | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | fresh | color-rule-violation | warn | Non-monochrome, non-allowed color rgb(255, 213, 128) on "Only 3 left" | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | fresh | font-family | warn | Non-Inter font-family "-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif" on "·" | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | fresh | font-family | warn | Non-Inter font-family "-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif" on "·" | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | fresh | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | fresh | hit-target-too-small | warn | 32x16px control "Edit" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | fresh | hit-target-too-small | warn | 217x30px control "M" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | fresh | hit-target-too-small | warn | 32x32px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | fresh | hit-target-too-small | warn | 32x32px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | fresh | hit-target-too-small | warn | 217x30px control "L" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | fresh | hit-target-too-small | warn | 32x32px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | fresh | hit-target-too-small | warn | 32x32px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | demo | overlapping-text | warn | "F" overlaps "$483.00" | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | demo | overlapping-text | warn | "Field Office" overlaps "Checkout" | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | demo | overlapping-text | warn | "@fieldoffice" overlaps "Checkout" | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | demo | color-rule-violation | warn | Non-monochrome, non-allowed color rgb(255, 213, 128) on "Only 3 left" | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | demo | font-family | warn | Non-Inter font-family "-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif" on "·" | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | demo | font-family | warn | Non-Inter font-family "-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif" on "·" | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | demo | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | demo | hit-target-too-small | warn | 32x16px control "Edit" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | demo | hit-target-too-small | warn | 217x30px control "M" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | demo | hit-target-too-small | warn | 32x32px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | demo | hit-target-too-small | warn | 32x32px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | demo | hit-target-too-small | warn | 217x30px control "L" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | demo | hit-target-too-small | warn | 32x32px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | demo | hit-target-too-small | warn | 32x32px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | overlapping-text | warn | "F" overlaps "$483.00" | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | overlapping-text | warn | "Field Office" overlaps "Checkout" | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | overlapping-text | warn | "@fieldoffice" overlaps "Checkout" | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | color-rule-violation | warn | Non-monochrome, non-allowed color rgb(255, 213, 128) on "Only 3 left" | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | font-family | warn | Non-Inter font-family "-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif" on "·" | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | font-family | warn | Non-Inter font-family "-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif" on "·" | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | hit-target-too-small | warn | 32x16px control "Edit" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | hit-target-too-small | warn | 217x30px control "M" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | hit-target-too-small | warn | 32x32px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | hit-target-too-small | warn | 32x32px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | hit-target-too-small | warn | 217x30px control "L" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | hit-target-too-small | warn | 32x32px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | hit-target-too-small | warn | 32x32px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | overlapping-text | warn | "F" overlaps "$483.00" | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | overlapping-text | warn | "Field Office" overlaps "Checkout" | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | overlapping-text | warn | "@fieldoffice" overlaps "Checkout" | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | color-rule-violation | warn | Non-monochrome, non-allowed color rgb(255, 213, 128) on "Only 3 left" | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | font-family | warn | Non-Inter font-family "-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif" on "·" | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | font-family | warn | Non-Inter font-family "-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif" on "·" | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | hit-target-too-small | warn | 32x16px control "Edit" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | hit-target-too-small | warn | 217x30px control "M" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | hit-target-too-small | warn | 32x32px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | hit-target-too-small | warn | 32x32px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | hit-target-too-small | warn | 217x30px control "L" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | hit-target-too-small | warn | 32x32px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | hit-target-too-small | warn | 32x32px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |

### Buyer discover / feed (25)

| Route | Role | Data state | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|---|
| `/(buyer)/discover-feed` | seller | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-discover-feed/seller/00-initial.png) |
| `/(buyer)/discover-feed` | seller | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-discover-feed/seller/00-initial.png) |
| `/(buyer)/discover-feed` | buyer | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-discover-feed/buyer/00-initial.png) |
| `/(buyer)/discover-feed` | buyer | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-discover-feed/buyer/00-initial.png) |
| `/(buyer)/discover` | seller | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover-feed` | seller | fresh | contrast-violation | warn | contrast 1.06:1 (need 4.5:1) for "Retry" — rgb(0, 0, 0) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/-buyer-discover-feed/seller/00-initial.png) |
| `/(buyer)/discover-feed` | seller | demo | contrast-violation | warn | contrast 1.06:1 (need 4.5:1) for "Retry" — rgb(0, 0, 0) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/-buyer-discover-feed/seller/00-initial.png) |
| `/(buyer)/discover-feed` | buyer | fresh | contrast-violation | warn | contrast 1.06:1 (need 4.5:1) for "Retry" — rgb(0, 0, 0) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/-buyer-discover-feed/buyer/00-initial.png) |
| `/(buyer)/discover-feed` | buyer | demo | contrast-violation | warn | contrast 1.06:1 (need 4.5:1) for "Retry" — rgb(0, 0, 0) on rgb(10, 10, 11) | [view](../../docs/audit/screenshots/-buyer-discover-feed/buyer/00-initial.png) |
| `/(buyer)/discover` | seller | fresh | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Discover" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | fresh | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "N" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | fresh | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "F" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | fresh | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "Q" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | fresh | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "E" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | fresh | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "N" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | fresh | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "F" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Heavyweight Hoodie — Ember" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Field Shell Jacket — Rust" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Boxy Fleece Hoodie — Graphite" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | fresh | hit-target-too-small | warn | 210x36px control "Search" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | fresh | hit-target-too-small | warn | 82x34px control "For You" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | fresh | hit-target-too-small | warn | 56x34px control "Fits" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | fresh | hit-target-too-small | warn | 78x34px control "Brands" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | fresh | hit-target-too-small | warn | 77x34px control "People" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | fresh | hit-target-too-small | warn | 71x34px control "Drops" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
