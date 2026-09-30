# Half-done audit report

Generated 2026-09-30T03:38:01.708Z (partial run — time budget hit).

- Route files discovered: 266
- Route × role combinations audited: 58
- Unreachable: 0
- Total findings: 691 (hard: 50, warn: 641)

## Scoreboard by area/owner

Each owning session's row — see `route-ownership.mjs`/`route-ownership.json` for the mapping rules and `docs/audit/README.md` for the heuristic writeup. Counts are per unique route (not per route×role×data-state combo): a route counts once toward "zero-finding routes" only if it produced no hard AND no warn finding under any role/state it was audited in, and once toward "routes still failing" if it has any hard-tier finding or was unreachable under any role/state.

| Area/owner | Hard | Warn | Routes | Zero-finding routes | Routes still failing |
|---|---|---|---|---|---|
| profiles+social (session 01MjTkyh) | 24 | 315 | 8 | 0 | 8 |
| buyer (session 01AaWLh1) | 22 | 290 | 6 | 0 | 6 |
| growth (session 019SGXKf) | 4 | 36 | 1 | 0 | 1 |

## Notes on this run

This is a time-budgeted pass, not full coverage — see `routesAudited` vs `routesDiscovered` above. One caveat found while producing it:

- **Group-root layouts under the "wrong" role are expected unreachable, not bugs**: `/(tabs)` is the seller tab root and `/(buyer)` is the buyer tab root — a `/(tabs)` load under `?bt_preview=buyer` (or vice versa) correctly renders nothing, the same way a signed-in buyer account would never land on the seller shell. Do not treat those specific role/route pairings in the Unreachable table below as findings.

An earlier version of this script flagged the *matching*-role case (e.g. `/(tabs)` under `seller`) as unreachable too, flakily — the fast client-side `history.pushState`/`popstate` navigation used between routes was occasionally still mid-render when the reachability check ran. The script now retries once with a real full-page reload before giving up, which fixed that: unreachable dropped from 72% of routes in the initial sample to a small handful in a full run. A route/role pair that still shows unreachable below reflects a real full-navigation blank body — either a genuine redirect-only route with no rendered content, or worth a closer look.

## Known, being rebuilt separately

The seller dashboard revenue chart (repeated axis labels, misaligned curve, no value on tap) is already being rebuilt in a separate session (019SGXKf). Findings from `/(tabs)` (seller dashboard root) related to that specific chart are listed below for completeness but should NOT be picked up by a follow-up fix PR — check with that session before touching it.

## Findings by type

| Type | Tier | Count |
|---|---|---|
| hit-target-too-small | warn | 238 |
| type-scale-drift | warn | 167 |
| overlapping-text | warn | 148 |
| contrast-violation | warn | 61 |
| console-error | hard | 50 |
| clipped-text | warn | 14 |
| font-family | warn | 8 |
| color-rule-violation | warn | 4 |
| min-size-violation | warn | 1 |

## Unreachable routes

None.

## Findings by area (audit-script grouping, not the owner scoreboard above)

### Other (191)

| Route | Role | Data state | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|---|
| `/(buyer)/activity` | seller | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | seller | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-activity/seller/00-initial.png) |
| `/(buyer)/activity` | buyer | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/activity` | buyer | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-activity/buyer/00-initial.png) |
| `/(buyer)/following` | seller | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/friends` | seller | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-friends/seller/00-initial.png) |
| `/(buyer)/friends` | seller | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-friends/seller/00-initial.png) |
| `/(buyer)/friends` | buyer | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)` | seller | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-/seller/00-initial.png) |
| `/(buyer)` | seller | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-/seller/00-initial.png) |
| `/(buyer)` | buyer | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
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
| `/(buyer)/following` | seller | fresh | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Following" | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Northline Studio" | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "0 orders placed so far." | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Shop drop" | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Field Office" | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "0 orders placed so far." | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "View drop" | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | fresh | contrast-violation | warn | contrast 1.67:1 (need 4.5:1) for "Live" — rgb(51, 51, 56) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | fresh | contrast-violation | warn | contrast 1.40:1 (need 4.5:1) for "Live now" — rgb(255, 255, 255) on rgba(127, 240, 176, 0.8) | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | fresh | contrast-violation | warn | contrast 1.94:1 (need 4.5:1) for "Upcoming" — rgb(61, 61, 66) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | demo | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Following" | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Northline Studio" | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "0 orders placed so far." | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Shop drop" | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Field Office" | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "0 orders placed so far." | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "View drop" | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | demo | contrast-violation | warn | contrast 1.67:1 (need 4.5:1) for "Live" — rgb(51, 51, 56) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | demo | contrast-violation | warn | contrast 1.40:1 (need 4.5:1) for "Live now" — rgb(255, 255, 255) on rgba(127, 240, 176, 0.8) | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | seller | demo | contrast-violation | warn | contrast 1.94:1 (need 4.5:1) for "Upcoming" — rgb(61, 61, 66) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Following" | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Northline Studio" | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "0 orders placed so far." | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Shop drop" | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Field Office" | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "0 orders placed so far." | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "View drop" | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | contrast-violation | warn | contrast 1.67:1 (need 4.5:1) for "Live" — rgb(51, 51, 56) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | contrast-violation | warn | contrast 1.40:1 (need 4.5:1) for "Live now" — rgb(255, 255, 255) on rgba(127, 240, 176, 0.8) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | contrast-violation | warn | contrast 1.94:1 (need 4.5:1) for "Upcoming" — rgb(61, 61, 66) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Following" | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Northline Studio" | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "0 orders placed so far." | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Shop drop" | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Field Office" | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "0 orders placed so far." | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "View drop" | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | contrast-violation | warn | contrast 1.67:1 (need 4.5:1) for "Live" — rgb(51, 51, 56) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | contrast-violation | warn | contrast 1.40:1 (need 4.5:1) for "Live now" — rgb(255, 255, 255) on rgba(127, 240, 176, 0.8) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | contrast-violation | warn | contrast 1.94:1 (need 4.5:1) for "Upcoming" — rgb(61, 61, 66) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/friends` | seller | fresh | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Friends" | [view](../../docs/audit/screenshots/-buyer-friends/seller/00-initial.png) |
| `/(buyer)/friends` | seller | demo | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Friends" | [view](../../docs/audit/screenshots/-buyer-friends/seller/00-initial.png) |
| `/(buyer)/friends` | buyer | fresh | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Friends" | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "See all" | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | fresh | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Find friends" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | fresh | hit-target-too-small | warn | 43x44px control "See all" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Friends" | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "See all" | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "See all" | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "MF" | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | hit-target-too-small | warn | 43x44px control "See all" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | hit-target-too-small | warn | 24x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | hit-target-too-small | warn | 24x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | hit-target-too-small | warn | 24x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | hit-target-too-small | warn | 43x44px control "See all" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)` | seller | fresh | overlapping-text | warn | "Check back soon for new drops" overlaps "Hold the right side" | [view](../../docs/audit/screenshots/-buyer-/seller/00-initial.png) |
| `/(buyer)` | seller | fresh | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "2x" | [view](../../docs/audit/screenshots/-buyer-/seller/00-initial.png) |
| `/(buyer)` | seller | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/seller/00-initial.png) |
| `/(buyer)` | seller | fresh | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/seller/00-initial.png) |
| `/(buyer)` | seller | fresh | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/seller/00-initial.png) |
| `/(buyer)` | seller | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/seller/00-initial.png) |
| `/(buyer)` | seller | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/seller/00-initial.png) |
| `/(buyer)` | seller | demo | overlapping-text | warn | "Check back soon for new drops" overlaps "Hold the right side" | [view](../../docs/audit/screenshots/-buyer-/seller/00-initial.png) |
| `/(buyer)` | seller | demo | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "2x" | [view](../../docs/audit/screenshots/-buyer-/seller/00-initial.png) |
| `/(buyer)` | seller | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/seller/00-initial.png) |
| `/(buyer)` | seller | demo | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/seller/00-initial.png) |
| `/(buyer)` | seller | demo | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/seller/00-initial.png) |
| `/(buyer)` | seller | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/seller/00-initial.png) |
| `/(buyer)` | seller | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/seller/00-initial.png) |
| `/(buyer)` | buyer | fresh | clipped-text | warn | Text clipped (71px into 62px): "$220.00 +1" | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | fresh | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Northline Studio" | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Drop 04 is live. Ember season, cut heavy and made to last." | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | fresh | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "2x" | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | fresh | hit-target-too-small | warn | 38x38px control "NO" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | fresh | hit-target-too-small | warn | 14x14px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | fresh | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | fresh | hit-target-too-small | warn | 38x44px control "612" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | fresh | hit-target-too-small | warn | 38x44px control "1,290" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | fresh | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | fresh | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | fresh | hit-target-too-small | warn | 78x32px control "ShopField Shell Jacket — Rust$220.00 +1" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | fresh | hit-target-too-small | warn | 293x36px control "Northline Studio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | fresh | hit-target-too-small | warn | 215x24px control "Original Sound · northlinestudio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | fresh | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | fresh | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | demo | clipped-text | warn | Text clipped (71px into 62px): "$220.00 +1" | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | demo | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Northline Studio" | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Drop 04 is live. Ember season, cut heavy and made to last." | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | demo | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "3" | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | demo | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "2x" | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | demo | min-size-violation | warn | font-size 10px below the 11pt caption floor on "3" | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | demo | hit-target-too-small | warn | 38x38px control "NO" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | demo | hit-target-too-small | warn | 14x14px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | demo | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | demo | hit-target-too-small | warn | 38x44px control "612" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | demo | hit-target-too-small | warn | 38x44px control "1,290" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | demo | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | demo | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | demo | hit-target-too-small | warn | 78x32px control "ShopField Shell Jacket — Rust$220.00 +1" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | demo | hit-target-too-small | warn | 293x36px control "Northline Studio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | demo | hit-target-too-small | warn | 215x24px control "Original Sound · northlinestudio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | demo | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | demo | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | demo | hit-target-too-small | warn | 24x36px control "3" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |

### Buyer discover / feed (184)

| Route | Role | Data state | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|---|
| `/(buyer)/discover-feed` | seller | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-discover-feed/seller/00-initial.png) |
| `/(buyer)/discover-feed` | seller | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-discover-feed/seller/00-initial.png) |
| `/(buyer)/discover-feed` | buyer | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-discover-feed/buyer/00-initial.png) |
| `/(buyer)/discover-feed` | buyer | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-discover-feed/buyer/00-initial.png) |
| `/(buyer)/discover` | seller | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | buyer | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
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
| `/(buyer)/discover` | seller | demo | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Discover" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | demo | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "N" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | demo | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "F" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | demo | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "Q" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | demo | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "E" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | demo | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "N" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | demo | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "F" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Heavyweight Hoodie — Ember" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Field Shell Jacket — Rust" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Boxy Fleece Hoodie — Graphite" | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | demo | hit-target-too-small | warn | 210x36px control "Search" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | demo | hit-target-too-small | warn | 82x34px control "For You" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | demo | hit-target-too-small | warn | 56x34px control "Fits" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | demo | hit-target-too-small | warn | 78x34px control "Brands" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | demo | hit-target-too-small | warn | 77x34px control "People" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | seller | demo | hit-target-too-small | warn | 71x34px control "Drops" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/seller/00-initial.png) |
| `/(buyer)/discover` | buyer | fresh | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Discover" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | fresh | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "N" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | fresh | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "F" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | fresh | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "Q" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | fresh | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "E" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | fresh | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "N" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | fresh | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "F" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Heavyweight Hoodie — Ember" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Field Shell Jacket — Rust" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Boxy Fleece Hoodie — Graphite" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | fresh | hit-target-too-small | warn | 210x36px control "Search" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | fresh | hit-target-too-small | warn | 82x34px control "For You" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | fresh | hit-target-too-small | warn | 56x34px control "Fits" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | fresh | hit-target-too-small | warn | 78x34px control "Brands" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | fresh | hit-target-too-small | warn | 77x34px control "People" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | fresh | hit-target-too-small | warn | 71x34px control "Drops" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Discover" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "N" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "F" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "Q" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "E" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "N" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "F" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Heavyweight Hoodie — Ember" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Field Shell Jacket — Rust" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Boxy Fleece Hoodie — Graphite" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | hit-target-too-small | warn | 210x36px control "Search" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | hit-target-too-small | warn | 82x34px control "For You" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | hit-target-too-small | warn | 56x34px control "Fits" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | hit-target-too-small | warn | 78x34px control "Brands" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | hit-target-too-small | warn | 77x34px control "People" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | hit-target-too-small | warn | 71x34px control "Drops" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | overlapping-text | warn | "212 claimed" overlaps "Watching Threads" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | overlapping-text | warn | "·" overlaps "Watching Threads" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | overlapping-text | warn | "38 left" overlaps "Watching Threads" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | overlapping-text | warn | "08:59:58" overlaps "Watching Threads" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | overlapping-text | warn | "Northline Studio" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | overlapping-text | warn | "64 claimed" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | overlapping-text | warn | "·" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | overlapping-text | warn | "11 left" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | overlapping-text | warn | "17:59:58" overlaps "Next video" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | overlapping-text | warn | "$220.00" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | overlapping-text | warn | "Boxy Fleece Hoodie — Graphite" overlaps "Double tap" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | overlapping-text | warn | "Ember & Ash" overlaps "Like" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | overlapping-text | warn | "Field Office" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | overlapping-text | warn | "91 claimed" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | overlapping-text | warn | "·" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | overlapping-text | warn | "9 left" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | overlapping-text | warn | "35:59:58" overlaps "Scrub through the video" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | overlapping-text | warn | "$165.00" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | overlapping-text | warn | "Garment-Dyed Hoodie — Moss" overlaps "Tap to keep watching" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "High Demand" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "2x" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | overlapping-text | warn | "212 claimed" overlaps "Watching Threads" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | overlapping-text | warn | "·" overlaps "Watching Threads" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | overlapping-text | warn | "38 left" overlaps "Watching Threads" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | overlapping-text | warn | "08:59:57" overlaps "Watching Threads" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | overlapping-text | warn | "Northline Studio" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | overlapping-text | warn | "64 claimed" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | overlapping-text | warn | "·" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | overlapping-text | warn | "11 left" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | overlapping-text | warn | "17:59:57" overlaps "Next video" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | overlapping-text | warn | "$220.00" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | overlapping-text | warn | "Boxy Fleece Hoodie — Graphite" overlaps "Double tap" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | overlapping-text | warn | "Ember & Ash" overlaps "Like" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | overlapping-text | warn | "Field Office" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | overlapping-text | warn | "91 claimed" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | overlapping-text | warn | "·" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | overlapping-text | warn | "9 left" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | overlapping-text | warn | "35:59:57" overlaps "Scrub through the video" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | overlapping-text | warn | "$165.00" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | overlapping-text | warn | "Garment-Dyed Hoodie — Moss" overlaps "Tap to keep watching" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "High Demand" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "2x" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | overlapping-text | warn | "212 claimed" overlaps "Watching Threads" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | overlapping-text | warn | "·" overlaps "Watching Threads" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | overlapping-text | warn | "38 left" overlaps "Watching Threads" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | overlapping-text | warn | "08:59:56" overlaps "Watching Threads" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | overlapping-text | warn | "Northline Studio" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | overlapping-text | warn | "64 claimed" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | overlapping-text | warn | "·" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | overlapping-text | warn | "11 left" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | overlapping-text | warn | "17:59:56" overlaps "Next video" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | overlapping-text | warn | "$220.00" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | overlapping-text | warn | "Boxy Fleece Hoodie — Graphite" overlaps "Double tap" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | overlapping-text | warn | "Ember & Ash" overlaps "Like" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | overlapping-text | warn | "Field Office" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | overlapping-text | warn | "91 claimed" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | overlapping-text | warn | "·" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | overlapping-text | warn | "9 left" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | overlapping-text | warn | "35:59:56" overlaps "Scrub through the video" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | overlapping-text | warn | "$165.00" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | overlapping-text | warn | "Garment-Dyed Hoodie — Moss" overlaps "Tap to keep watching" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "High Demand" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "2x" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | overlapping-text | warn | "212 claimed" overlaps "Watching Threads" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | overlapping-text | warn | "·" overlaps "Watching Threads" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | overlapping-text | warn | "38 left" overlaps "Watching Threads" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | overlapping-text | warn | "08:59:55" overlaps "Watching Threads" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | overlapping-text | warn | "Northline Studio" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | overlapping-text | warn | "64 claimed" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | overlapping-text | warn | "·" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | overlapping-text | warn | "11 left" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | overlapping-text | warn | "17:59:55" overlaps "Next video" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | overlapping-text | warn | "$220.00" overlaps "Swipe up" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | overlapping-text | warn | "Boxy Fleece Hoodie — Graphite" overlaps "Double tap" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | overlapping-text | warn | "Ember & Ash" overlaps "Like" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | overlapping-text | warn | "Field Office" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | overlapping-text | warn | "91 claimed" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | overlapping-text | warn | "·" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | overlapping-text | warn | "9 left" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | overlapping-text | warn | "35:59:55" overlaps "Scrub through the video" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | overlapping-text | warn | "$165.00" overlaps "Drag the bar" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | overlapping-text | warn | "Garment-Dyed Hoodie — Moss" overlaps "Tap to keep watching" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "High Demand" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "2x" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |

### Seller dashboard / analytics (108)

| Route | Role | Data state | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|---|
| `/(tabs)/analytics` | seller | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | seller | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | buyer | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/analytics` | buyer | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/feed` | seller | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-tabs-feed/seller/00-initial.png) |
| `/(tabs)/feed` | seller | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-tabs-feed/seller/00-initial.png) |
| `/(tabs)/following` | seller | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/analytics` | seller | fresh | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Analytics" | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | seller | fresh | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "$0" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | seller | fresh | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Sep 12" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | seller | fresh | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Sep 13" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | seller | fresh | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Sep 14" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | seller | fresh | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Sep 15" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | seller | fresh | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Sep 16" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | seller | fresh | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Sep 17" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | seller | fresh | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Sep 18" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | seller | demo | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Analytics" | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | seller | demo | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "$0" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | seller | demo | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Sep 12" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | seller | demo | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Sep 13" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | seller | demo | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Sep 14" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | seller | demo | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Sep 15" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | seller | demo | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Sep 16" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | seller | demo | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Sep 17" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | seller | demo | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Sep 18" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/seller/00-initial.png) |
| `/(tabs)/analytics` | buyer | fresh | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Analytics" | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/analytics` | buyer | fresh | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "$0" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/analytics` | buyer | fresh | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Sep 12" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/analytics` | buyer | fresh | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Sep 13" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/analytics` | buyer | fresh | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Sep 14" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/analytics` | buyer | fresh | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Sep 15" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/analytics` | buyer | fresh | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Sep 16" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/analytics` | buyer | fresh | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Sep 17" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/analytics` | buyer | fresh | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Sep 18" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/analytics` | buyer | demo | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Analytics" | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/analytics` | buyer | demo | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "$0" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/analytics` | buyer | demo | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Sep 12" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/analytics` | buyer | demo | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Sep 13" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/analytics` | buyer | demo | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Sep 14" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/analytics` | buyer | demo | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Sep 15" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/analytics` | buyer | demo | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Sep 16" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/analytics` | buyer | demo | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Sep 17" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/analytics` | buyer | demo | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Sep 18" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-analytics/buyer/00-initial.png) |
| `/(tabs)/feed` | seller | fresh | hit-target-too-small | warn | 34x34px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/seller/00-initial.png) |
| `/(tabs)/feed` | seller | fresh | hit-target-too-small | warn | 34x34px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/seller/00-initial.png) |
| `/(tabs)/feed` | seller | fresh | hit-target-too-small | warn | 60x25px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/seller/00-initial.png) |
| `/(tabs)/feed` | seller | fresh | hit-target-too-small | warn | 52x25px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/seller/00-initial.png) |
| `/(tabs)/feed` | seller | demo | hit-target-too-small | warn | 34x34px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/seller/00-initial.png) |
| `/(tabs)/feed` | seller | demo | hit-target-too-small | warn | 34x34px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/seller/00-initial.png) |
| `/(tabs)/feed` | seller | demo | hit-target-too-small | warn | 60x25px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/seller/00-initial.png) |
| `/(tabs)/feed` | seller | demo | hit-target-too-small | warn | 52x25px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/seller/00-initial.png) |
| `/(tabs)/feed` | buyer | fresh | clipped-text | warn | Text clipped (71px into 62px): "$220.00 +1" | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | fresh | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Northline Studio" | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Drop 04 is live. Ember season, cut heavy and made to last." | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | fresh | hit-target-too-small | warn | 38x38px control "NO" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | fresh | hit-target-too-small | warn | 14x14px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | fresh | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | fresh | hit-target-too-small | warn | 38x44px control "612" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | fresh | hit-target-too-small | warn | 38x44px control "1,290" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | fresh | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | fresh | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | fresh | hit-target-too-small | warn | 78x32px control "ShopField Shell Jacket — Rust$220.00 +1" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | fresh | hit-target-too-small | warn | 293x36px control "Northline Studio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | fresh | hit-target-too-small | warn | 215x24px control "Original Sound · northlinestudio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | fresh | hit-target-too-small | warn | 34x34px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | fresh | hit-target-too-small | warn | 34x34px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | fresh | hit-target-too-small | warn | 60x25px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | fresh | hit-target-too-small | warn | 52x25px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | demo | clipped-text | warn | Text clipped (71px into 62px): "$220.00 +1" | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | demo | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Northline Studio" | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Drop 04 is live. Ember season, cut heavy and made to last." | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | demo | hit-target-too-small | warn | 38x38px control "NO" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | demo | hit-target-too-small | warn | 14x14px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | demo | hit-target-too-small | warn | 38x44px control "18.4K" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | demo | hit-target-too-small | warn | 38x44px control "612" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | demo | hit-target-too-small | warn | 38x44px control "1,290" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | demo | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | demo | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | demo | hit-target-too-small | warn | 78x32px control "ShopField Shell Jacket — Rust$220.00 +1" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | demo | hit-target-too-small | warn | 293x36px control "Northline Studio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | demo | hit-target-too-small | warn | 215x24px control "Original Sound · northlinestudio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | demo | hit-target-too-small | warn | 34x34px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | demo | hit-target-too-small | warn | 34x34px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | demo | hit-target-too-small | warn | 60x25px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/feed` | buyer | demo | hit-target-too-small | warn | 52x25px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-tabs-feed/buyer/00-initial.png) |
| `/(tabs)/following` | seller | fresh | overlapping-text | warn | "0 orders placed so far." overlaps "2" | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | fresh | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Following" | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Northline Studio" | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "0 orders placed so far." | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Shop drop" | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Field Office" | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "0 orders placed so far." | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "View drop" | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | fresh | contrast-violation | warn | contrast 1.67:1 (need 4.5:1) for "Live" — rgb(51, 51, 56) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | fresh | contrast-violation | warn | contrast 1.40:1 (need 4.5:1) for "Live now" — rgb(255, 255, 255) on rgba(127, 240, 176, 0.8) | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | fresh | contrast-violation | warn | contrast 1.94:1 (need 4.5:1) for "Upcoming" — rgb(61, 61, 66) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | demo | overlapping-text | warn | "0 orders placed so far." overlaps "2" | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | demo | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Following" | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Northline Studio" | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "0 orders placed so far." | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Shop drop" | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Field Office" | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "0 orders placed so far." | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "View drop" | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | demo | contrast-violation | warn | contrast 1.67:1 (need 4.5:1) for "Live" — rgb(51, 51, 56) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | demo | contrast-violation | warn | contrast 1.40:1 (need 4.5:1) for "Live now" — rgb(255, 255, 255) on rgba(127, 240, 176, 0.8) | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |
| `/(tabs)/following` | seller | demo | contrast-violation | warn | contrast 1.94:1 (need 4.5:1) for "Upcoming" — rgb(61, 61, 66) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-tabs-following/seller/00-initial.png) |

### Profile / settings (74)

| Route | Role | Data state | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|---|
| `/(buyer)/edit-profile` | seller | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-edit-profile/seller/00-initial.png) |
| `/(buyer)/edit-profile` | seller | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-edit-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | buyer | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | seller | fresh | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Edit profile" | [view](../../docs/audit/screenshots/-buyer-edit-profile/seller/00-initial.png) |
| `/(buyer)/edit-profile` | seller | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Change profile photo or video" | [view](../../docs/audit/screenshots/-buyer-edit-profile/seller/00-initial.png) |
| `/(buyer)/edit-profile` | seller | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Add profile video" | [view](../../docs/audit/screenshots/-buyer-edit-profile/seller/00-initial.png) |
| `/(buyer)/edit-profile` | seller | fresh | hit-target-too-small | warn | 116x17px control "Add profile video" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/seller/00-initial.png) |
| `/(buyer)/edit-profile` | seller | demo | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Edit profile" | [view](../../docs/audit/screenshots/-buyer-edit-profile/seller/00-initial.png) |
| `/(buyer)/edit-profile` | seller | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Change profile photo or video" | [view](../../docs/audit/screenshots/-buyer-edit-profile/seller/00-initial.png) |
| `/(buyer)/edit-profile` | seller | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Add profile video" | [view](../../docs/audit/screenshots/-buyer-edit-profile/seller/00-initial.png) |
| `/(buyer)/edit-profile` | seller | demo | hit-target-too-small | warn | 116x17px control "Add profile video" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/seller/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | fresh | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Edit profile" | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Change profile photo or video" | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Add profile video" | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | fresh | hit-target-too-small | warn | 116x17px control "Add profile video" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | demo | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Edit profile" | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Change profile photo or video" | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Add profile video" | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | demo | hit-target-too-small | warn | 116x17px control "Add profile video" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | seller | fresh | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "@northlinestudio" | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | fresh | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "Maya Okafor" | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "@northlinestudio" | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Edit profile" | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Share profile" | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | fresh | hit-target-too-small | warn | 24x24px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | fresh | hit-target-too-small | warn | 24x24px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | fresh | hit-target-too-small | warn | 22x22px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | fresh | hit-target-too-small | warn | 60x38px control "1,280Followers" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | fresh | hit-target-too-small | warn | 59x38px control "340Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | fresh | hit-target-too-small | warn | 157x36px control "Edit profile" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | fresh | hit-target-too-small | warn | 157x36px control "Share profile" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | fresh | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | demo | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "@northlinestudio" | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | demo | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "Maya Okafor" | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "@northlinestudio" | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Edit profile" | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Share profile" | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | demo | hit-target-too-small | warn | 24x24px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | demo | hit-target-too-small | warn | 24x24px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | demo | hit-target-too-small | warn | 22x22px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | demo | hit-target-too-small | warn | 60x38px control "1,280Followers" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | demo | hit-target-too-small | warn | 59x38px control "340Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | demo | hit-target-too-small | warn | 157x36px control "Edit profile" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | demo | hit-target-too-small | warn | 157x36px control "Share profile" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | seller | demo | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/seller/00-initial.png) |
| `/(buyer)/profile` | buyer | fresh | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "@jordanreyes" | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | fresh | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "Jordan Reyes" | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "@jordanreyes" | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Edit profile" | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Share profile" | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | fresh | hit-target-too-small | warn | 24x24px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | fresh | hit-target-too-small | warn | 24x24px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | fresh | hit-target-too-small | warn | 22x22px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | fresh | hit-target-too-small | warn | 60x38px control "1,280Followers" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | fresh | hit-target-too-small | warn | 59x38px control "340Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | fresh | hit-target-too-small | warn | 157x36px control "Edit profile" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | fresh | hit-target-too-small | warn | 157x36px control "Share profile" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | fresh | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | demo | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "@jordanreyes" | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | demo | type-scale-drift | warn | font-size 18px not on declared FS scale (nearest 17) on "Jordan Reyes" | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "@jordanreyes" | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Edit profile" | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Share profile" | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | demo | hit-target-too-small | warn | 24x24px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | demo | hit-target-too-small | warn | 24x24px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | demo | hit-target-too-small | warn | 22x22px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | demo | hit-target-too-small | warn | 60x38px control "1,280Followers" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | demo | hit-target-too-small | warn | 59x38px control "340Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | demo | hit-target-too-small | warn | 157x36px control "Edit profile" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | demo | hit-target-too-small | warn | 157x36px control "Share profile" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | demo | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |

### Checkout / orders (70)

| Route | Role | Data state | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|---|
| `/(buyer)/cart` | seller | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | seller | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-cart/seller/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/orders` | seller | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-orders/seller/00-initial.png) |
| `/(buyer)/orders` | seller | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-orders/seller/00-initial.png) |
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
| `/(buyer)/orders` | seller | fresh | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "My Orders" | [view](../../docs/audit/screenshots/-buyer-orders/seller/00-initial.png) |
| `/(buyer)/orders` | seller | fresh | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Discover Products" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-buyer-orders/seller/00-initial.png) |
| `/(buyer)/orders` | seller | demo | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "My Orders" | [view](../../docs/audit/screenshots/-buyer-orders/seller/00-initial.png) |
| `/(buyer)/orders` | seller | demo | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Discover Products" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-buyer-orders/seller/00-initial.png) |
| `/(buyer)/orders` | buyer | fresh | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "My Orders" | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | fresh | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Discover Products" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | demo | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "My Orders" | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | demo | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Discover Products" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |

### Messaging (64)

| Route | Role | Data state | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|---|
| `/(buyer)/inbox` | seller | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | buyer | fresh | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | demo | console-error | hard | Failed to load resource: the server responded with a status of 404 (Not Found) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | seller | fresh | clipped-text | warn | Text clipped (128px into 64px): "Your thoughts go here..." | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | fresh | clipped-text | warn | Text clipped (400px into 260px): "Any chance the Ember hoodie ships before Friday? · #NS-1048" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | fresh | clipped-text | warn | Text clipped (325px into 253px): "How does the Field Shell fit? I’m usually a medium." | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | fresh | clipped-text | warn | Text clipped (273px into 257px): "Can I swap the hoodie to Bone? · #NS-1045" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | fresh | overlapping-text | warn | "Read" overlaps "Any chance the Ember hoodie ships before Friday? · #NS-1048" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | fresh | overlapping-text | warn | "Pin" overlaps "Any chance the Ember hoodie ships before Friday? · #NS-1048" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | fresh | overlapping-text | warn | "Mute" overlaps "Any chance the Ember hoodie ships before Friday? · #NS-1048" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | fresh | overlapping-text | warn | "Delete" overlaps "Any chance the Ember hoodie ships before Friday? · #NS-1048" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | fresh | overlapping-text | warn | "Read" overlaps "How does the Field Shell fit? I’m usually a medium." | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | fresh | overlapping-text | warn | "Pin" overlaps "How does the Field Shell fit? I’m usually a medium." | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | fresh | overlapping-text | warn | "Mute" overlaps "How does the Field Shell fit? I’m usually a medium." | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | fresh | overlapping-text | warn | "Delete" overlaps "How does the Field Shell fit? I’m usually a medium." | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | fresh | overlapping-text | warn | "Read" overlaps "Got it, thanks for the tracking!" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | fresh | overlapping-text | warn | "Pin" overlaps "Got it, thanks for the tracking!" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | fresh | overlapping-text | warn | "Mute" overlaps "Got it, thanks for the tracking!" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | fresh | overlapping-text | warn | "Delete" overlaps "Got it, thanks for the tracking!" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | fresh | overlapping-text | warn | "Read" overlaps "Can I swap the hoodie to Bone? · #NS-1045" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | fresh | overlapping-text | warn | "Pin" overlaps "Can I swap the hoodie to Bone? · #NS-1045" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | fresh | overlapping-text | warn | "Mute" overlaps "Can I swap the hoodie to Bone? · #NS-1045" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | fresh | overlapping-text | warn | "Delete" overlaps "Can I swap the hoodie to Bone? · #NS-1045" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | fresh | overlapping-text | warn | "Read" overlaps "Will the cargo come back in rust?" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | fresh | overlapping-text | warn | "Pin" overlaps "Will the cargo come back in rust?" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | fresh | overlapping-text | warn | "Mute" overlaps "Will the cargo come back in rust?" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | fresh | overlapping-text | warn | "Delete" overlaps "Will the cargo come back in rust?" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | fresh | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Messages" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | fresh | hit-target-too-small | warn | 36x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | demo | clipped-text | warn | Text clipped (128px into 64px): "Your thoughts go here..." | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | demo | clipped-text | warn | Text clipped (400px into 260px): "Any chance the Ember hoodie ships before Friday? · #NS-1048" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | demo | clipped-text | warn | Text clipped (325px into 253px): "How does the Field Shell fit? I’m usually a medium." | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | demo | clipped-text | warn | Text clipped (273px into 257px): "Can I swap the hoodie to Bone? · #NS-1045" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | demo | overlapping-text | warn | "Read" overlaps "Any chance the Ember hoodie ships before Friday? · #NS-1048" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | demo | overlapping-text | warn | "Pin" overlaps "Any chance the Ember hoodie ships before Friday? · #NS-1048" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | demo | overlapping-text | warn | "Mute" overlaps "Any chance the Ember hoodie ships before Friday? · #NS-1048" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | demo | overlapping-text | warn | "Delete" overlaps "Any chance the Ember hoodie ships before Friday? · #NS-1048" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | demo | overlapping-text | warn | "Read" overlaps "How does the Field Shell fit? I’m usually a medium." | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | demo | overlapping-text | warn | "Pin" overlaps "How does the Field Shell fit? I’m usually a medium." | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | demo | overlapping-text | warn | "Mute" overlaps "How does the Field Shell fit? I’m usually a medium." | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | demo | overlapping-text | warn | "Delete" overlaps "How does the Field Shell fit? I’m usually a medium." | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | demo | overlapping-text | warn | "Read" overlaps "Got it, thanks for the tracking!" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | demo | overlapping-text | warn | "Pin" overlaps "Got it, thanks for the tracking!" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | demo | overlapping-text | warn | "Mute" overlaps "Got it, thanks for the tracking!" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | demo | overlapping-text | warn | "Delete" overlaps "Got it, thanks for the tracking!" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | demo | overlapping-text | warn | "Read" overlaps "Can I swap the hoodie to Bone? · #NS-1045" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | demo | overlapping-text | warn | "Pin" overlaps "Can I swap the hoodie to Bone? · #NS-1045" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | demo | overlapping-text | warn | "Mute" overlaps "Can I swap the hoodie to Bone? · #NS-1045" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | demo | overlapping-text | warn | "Delete" overlaps "Can I swap the hoodie to Bone? · #NS-1045" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | demo | overlapping-text | warn | "Read" overlaps "Will the cargo come back in rust?" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | demo | overlapping-text | warn | "Pin" overlaps "Will the cargo come back in rust?" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | demo | overlapping-text | warn | "Mute" overlaps "Will the cargo come back in rust?" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | demo | overlapping-text | warn | "Delete" overlaps "Will the cargo come back in rust?" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | demo | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Messages" | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | seller | demo | hit-target-too-small | warn | 36x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/seller/00-initial.png) |
| `/(buyer)/inbox` | buyer | fresh | clipped-text | warn | Text clipped (128px into 64px): "Your thoughts go here..." | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | fresh | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Messages" | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | fresh | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Send a message" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | fresh | hit-target-too-small | warn | 36x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | demo | clipped-text | warn | Text clipped (128px into 64px): "Your thoughts go here..." | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | demo | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Messages" | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | demo | contrast-violation | warn | contrast 1.00:1 (need 4.5:1) for "Send a message" — rgb(0, 0, 0) on rgb(0, 0, 0) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | demo | hit-target-too-small | warn | 36x44px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
