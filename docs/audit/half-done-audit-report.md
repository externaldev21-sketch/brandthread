# Half-done audit report

Generated 2026-09-30T08:44:04.332Z (partial run — time budget hit).

- Route files discovered: 268
- Route × role combinations audited: 50
- Unreachable: 0
- Total findings: 493 (hard: 0, warn: 493)

## Scoreboard by area/owner

Each owning session's row — see `route-ownership.mjs`/`route-ownership.json` for the mapping rules and `docs/audit/README.md` for the heuristic writeup. Counts are per unique route (not per route×role×data-state combo): a route counts once toward "zero-finding routes" only if it produced no hard AND no warn finding under any role/state it was audited in, and once toward "routes still failing" if it has any hard-tier finding or was unreachable under any role/state.

| Area/owner | Hard | Warn | Routes | Zero-finding routes | Routes still failing |
|---|---|---|---|---|---|
| profiles+social (session 01MjTkyh) | 0 | 275 | 6 | 0 | 0 |
| buyer (session 01AaWLh1) | 0 | 218 | 6 | 0 | 0 |
| growth (session 019SGXKf) | 0 | 0 | 1 | 1 | 0 |

## Notes on this run

This is a time-budgeted pass, not full coverage — see `routesAudited` vs `routesDiscovered` above. One caveat found while producing it:

- **Group-root layouts under the "wrong" role are expected unreachable, not bugs**: `/(tabs)` is the seller tab root and `/(buyer)` is the buyer tab root — a `/(tabs)` load under `?bt_preview=buyer` (or vice versa) correctly renders nothing, the same way a signed-in buyer account would never land on the seller shell. Do not treat those specific role/route pairings in the Unreachable table below as findings.

An earlier version of this script flagged the *matching*-role case (e.g. `/(tabs)` under `seller`) as unreachable too, flakily — the fast client-side `history.pushState`/`popstate` navigation used between routes was occasionally still mid-render when the reachability check ran. The script now retries once with a real full-page reload before giving up, which fixed that: unreachable dropped from 72% of routes in the initial sample to a small handful in a full run. A route/role pair that still shows unreachable below reflects a real full-navigation blank body — either a genuine redirect-only route with no rendered content, or worth a closer look.

## Known, being rebuilt separately

The seller dashboard revenue chart (repeated axis labels, misaligned curve, no value on tap) is already being rebuilt in a separate session (019SGXKf). Findings from `/(tabs)` (seller dashboard root) related to that specific chart are listed below for completeness but should NOT be picked up by a follow-up fix PR — check with that session before touching it.

## Findings by type

| Type | Tier | Count |
|---|---|---|
| hit-target-too-small | warn | 349 |
| type-scale-drift | warn | 95 |
| clipped-text | warn | 18 |
| min-size-violation | warn | 18 |
| overlapping-text | warn | 12 |
| contrast-violation | warn | 1 |

## Unreachable routes

None.

## Findings by area (audit-script grouping, not the owner scoreboard above)

### Other (177)

| Route | Role | Data state | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|---|
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
| `/(buyer)/following` | seller | fresh | contrast-violation | warn | contrast 1.40:1 (need 4.5:1) for "Live now" — rgb(255, 255, 255) on rgba(127, 240, 176, 0.8) | [view](../../docs/audit/screenshots/-buyer-following/seller/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | clipped-text | warn | Text clipped (71px into 62px): "$220.00 +1" | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Northline Studio" | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Drop 04 is live. Ember season, cut heavy and made to last." | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "3" | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | min-size-violation | warn | font-size 10px below the 11pt caption floor on "3" | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | hit-target-too-small | warn | 38x38px control "NO" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | hit-target-too-small | warn | 14x14px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | hit-target-too-small | warn | 38x44px control "18.4K" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | hit-target-too-small | warn | 38x44px control "612" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | hit-target-too-small | warn | 38x44px control "1,290" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | hit-target-too-small | warn | 78x32px control "ShopField Shell Jacket — Rust$220.00 +1" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | hit-target-too-small | warn | 293x36px control "Northline Studio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | hit-target-too-small | warn | 215x24px control "Original Sound · northlinestudio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | fresh | hit-target-too-small | warn | 24x36px control "3" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | clipped-text | warn | Text clipped (71px into 62px): "$220.00 +1" | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Northline Studio" | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Drop 04 is live. Ember season, cut heavy and made to last." | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "3" | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | min-size-violation | warn | font-size 10px below the 11pt caption floor on "3" | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | hit-target-too-small | warn | 38x38px control "NO" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | hit-target-too-small | warn | 14x14px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | hit-target-too-small | warn | 38x44px control "18.4K" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | hit-target-too-small | warn | 38x44px control "612" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | hit-target-too-small | warn | 38x44px control "1,290" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | hit-target-too-small | warn | 78x32px control "ShopField Shell Jacket — Rust$220.00 +1" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | hit-target-too-small | warn | 293x36px control "Northline Studio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | hit-target-too-small | warn | 215x24px control "Original Sound · northlinestudio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/following` | buyer | demo | hit-target-too-small | warn | 24x36px control "3" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-following/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | fresh | clipped-text | warn | Text clipped (71px into 62px): "$220.00 +1" | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | fresh | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Northline Studio" | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Drop 04 is live. Ember season, cut heavy and made to last." | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | fresh | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "3" | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | fresh | min-size-violation | warn | font-size 10px below the 11pt caption floor on "3" | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | fresh | hit-target-too-small | warn | 38x38px control "NO" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | fresh | hit-target-too-small | warn | 14x14px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | fresh | hit-target-too-small | warn | 38x44px control "18.4K" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | fresh | hit-target-too-small | warn | 38x44px control "612" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | fresh | hit-target-too-small | warn | 38x44px control "1,290" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | fresh | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | fresh | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | fresh | hit-target-too-small | warn | 78x32px control "ShopField Shell Jacket — Rust$220.00 +1" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | fresh | hit-target-too-small | warn | 293x36px control "Northline Studio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | fresh | hit-target-too-small | warn | 215x24px control "Original Sound · northlinestudio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | fresh | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | fresh | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | fresh | hit-target-too-small | warn | 24x36px control "3" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | clipped-text | warn | Text clipped (71px into 62px): "$220.00 +1" | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Northline Studio" | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Drop 04 is live. Ember season, cut heavy and made to last." | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "3" | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | min-size-violation | warn | font-size 10px below the 11pt caption floor on "3" | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | hit-target-too-small | warn | 38x38px control "NO" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | hit-target-too-small | warn | 14x14px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | hit-target-too-small | warn | 38x44px control "18.4K" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | hit-target-too-small | warn | 38x44px control "612" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | hit-target-too-small | warn | 38x44px control "1,290" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | hit-target-too-small | warn | 78x32px control "ShopField Shell Jacket — Rust$220.00 +1" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | hit-target-too-small | warn | 293x36px control "Northline Studio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | hit-target-too-small | warn | 215x24px control "Original Sound · northlinestudio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)/friends` | buyer | demo | hit-target-too-small | warn | 24x36px control "3" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-friends/buyer/00-initial.png) |
| `/(buyer)` | buyer | fresh | clipped-text | warn | Text clipped (71px into 62px): "$220.00 +1" | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | fresh | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Northline Studio" | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Drop 04 is live. Ember season, cut heavy and made to last." | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | fresh | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "3" | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | fresh | min-size-violation | warn | font-size 10px below the 11pt caption floor on "3" | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | fresh | hit-target-too-small | warn | 38x38px control "NO" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | fresh | hit-target-too-small | warn | 14x14px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | fresh | hit-target-too-small | warn | 38x44px control "18.4K" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
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
| `/(buyer)` | buyer | fresh | hit-target-too-small | warn | 24x36px control "3" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | demo | clipped-text | warn | Text clipped (71px into 62px): "$220.00 +1" | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | demo | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Northline Studio" | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Drop 04 is live. Ember season, cut heavy and made to last." | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | demo | hit-target-too-small | warn | 38x38px control "NO" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | demo | hit-target-too-small | warn | 14x14px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
| `/(buyer)` | buyer | demo | hit-target-too-small | warn | 38x44px control "18.4K" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |
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
| `/(buyer)` | buyer | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-/buyer/00-initial.png) |

### Buyer discover / feed (100)

| Route | Role | Data state | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|---|
| `/(buyer)/discover-feed` | buyer | demo | clipped-text | warn | Text clipped (71px into 62px): "$220.00 +1" | [view](../../docs/audit/screenshots/-buyer-discover-feed/buyer/00-initial.png) |
| `/(buyer)/discover-feed` | buyer | demo | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Northline Studio" | [view](../../docs/audit/screenshots/-buyer-discover-feed/buyer/00-initial.png) |
| `/(buyer)/discover-feed` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Drop 04 is live. Ember season, cut heavy and made to last." | [view](../../docs/audit/screenshots/-buyer-discover-feed/buyer/00-initial.png) |
| `/(buyer)/discover-feed` | buyer | demo | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "3" | [view](../../docs/audit/screenshots/-buyer-discover-feed/buyer/00-initial.png) |
| `/(buyer)/discover-feed` | buyer | demo | min-size-violation | warn | font-size 10px below the 11pt caption floor on "3" | [view](../../docs/audit/screenshots/-buyer-discover-feed/buyer/00-initial.png) |
| `/(buyer)/discover-feed` | buyer | demo | hit-target-too-small | warn | 38x38px control "NO" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover-feed/buyer/00-initial.png) |
| `/(buyer)/discover-feed` | buyer | demo | hit-target-too-small | warn | 14x14px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover-feed/buyer/00-initial.png) |
| `/(buyer)/discover-feed` | buyer | demo | hit-target-too-small | warn | 38x44px control "18.4K" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover-feed/buyer/00-initial.png) |
| `/(buyer)/discover-feed` | buyer | demo | hit-target-too-small | warn | 38x44px control "612" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover-feed/buyer/00-initial.png) |
| `/(buyer)/discover-feed` | buyer | demo | hit-target-too-small | warn | 38x44px control "1,290" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover-feed/buyer/00-initial.png) |
| `/(buyer)/discover-feed` | buyer | demo | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover-feed/buyer/00-initial.png) |
| `/(buyer)/discover-feed` | buyer | demo | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover-feed/buyer/00-initial.png) |
| `/(buyer)/discover-feed` | buyer | demo | hit-target-too-small | warn | 78x32px control "ShopField Shell Jacket — Rust$220.00 +1" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover-feed/buyer/00-initial.png) |
| `/(buyer)/discover-feed` | buyer | demo | hit-target-too-small | warn | 293x36px control "Northline Studio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover-feed/buyer/00-initial.png) |
| `/(buyer)/discover-feed` | buyer | demo | hit-target-too-small | warn | 215x24px control "Original Sound · northlinestudio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover-feed/buyer/00-initial.png) |
| `/(buyer)/discover-feed` | buyer | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover-feed/buyer/00-initial.png) |
| `/(buyer)/discover-feed` | buyer | demo | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover-feed/buyer/00-initial.png) |
| `/(buyer)/discover-feed` | buyer | demo | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover-feed/buyer/00-initial.png) |
| `/(buyer)/discover-feed` | buyer | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover-feed/buyer/00-initial.png) |
| `/(buyer)/discover-feed` | buyer | demo | hit-target-too-small | warn | 24x36px control "3" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover-feed/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | fresh | hit-target-too-small | warn | 213x36px control "Search" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | fresh | hit-target-too-small | warn | 82x34px control "For You" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | fresh | hit-target-too-small | warn | 56x34px control "Fits" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | fresh | hit-target-too-small | warn | 78x34px control "Brands" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | fresh | hit-target-too-small | warn | 77x34px control "People" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | fresh | hit-target-too-small | warn | 71x34px control "Drops" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | clipped-text | warn | Text clipped (71px into 62px): "$220.00 +1" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Northline Studio" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Drop 04 is live. Ember season, cut heavy and made to last." | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "3" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | min-size-violation | warn | font-size 10px below the 11pt caption floor on "3" | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | hit-target-too-small | warn | 38x38px control "NO" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | hit-target-too-small | warn | 14x14px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | hit-target-too-small | warn | 38x44px control "18.4K" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | hit-target-too-small | warn | 38x44px control "612" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | hit-target-too-small | warn | 38x44px control "1,290" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | hit-target-too-small | warn | 78x32px control "ShopField Shell Jacket — Rust$220.00 +1" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | hit-target-too-small | warn | 293x36px control "Northline Studio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | hit-target-too-small | warn | 215x24px control "Original Sound · northlinestudio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/discover` | buyer | demo | hit-target-too-small | warn | 24x36px control "3" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-discover/buyer/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "High Demand" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "High Demand" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "3" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | min-size-violation | warn | font-size 10px below the 11pt caption floor on "3" | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | seller | demo | hit-target-too-small | warn | 24x36px control "3" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/seller/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | clipped-text | warn | Text clipped (71px into 62px): "$220.00 +1" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Northline Studio" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Drop 04 is live. Ember season, cut heavy and made to last." | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "3" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | min-size-violation | warn | font-size 10px below the 11pt caption floor on "3" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | hit-target-too-small | warn | 38x38px control "NO" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | hit-target-too-small | warn | 14x14px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | hit-target-too-small | warn | 38x44px control "18.4K" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | hit-target-too-small | warn | 38x44px control "612" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | hit-target-too-small | warn | 38x44px control "1,290" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | hit-target-too-small | warn | 78x32px control "ShopField Shell Jacket — Rust$220.00 +1" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | hit-target-too-small | warn | 293x36px control "Northline Studio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | hit-target-too-small | warn | 215x24px control "Original Sound · northlinestudio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | fresh | hit-target-too-small | warn | 24x36px control "3" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | clipped-text | warn | Text clipped (71px into 62px): "$220.00 +1" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Northline Studio" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Drop 04 is live. Ember season, cut heavy and made to last." | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "3" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | min-size-violation | warn | font-size 10px below the 11pt caption floor on "3" | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | hit-target-too-small | warn | 38x38px control "NO" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | hit-target-too-small | warn | 14x14px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | hit-target-too-small | warn | 38x44px control "18.4K" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | hit-target-too-small | warn | 38x44px control "612" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | hit-target-too-small | warn | 38x44px control "1,290" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | hit-target-too-small | warn | 78x32px control "ShopField Shell Jacket — Rust$220.00 +1" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | hit-target-too-small | warn | 293x36px control "Northline Studio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | hit-target-too-small | warn | 215x24px control "Original Sound · northlinestudio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |
| `/(buyer)/feed` | buyer | demo | hit-target-too-small | warn | 24x36px control "3" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-feed/buyer/00-initial.png) |

### Profile / settings (96)

| Route | Role | Data state | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|---|
| `/(buyer)/edit-profile` | seller | demo | type-scale-drift | warn | font-size 20px not on declared FS scale (nearest 19) on "Edit profile" | [view](../../docs/audit/screenshots/-buyer-edit-profile/seller/00-initial.png) |
| `/(buyer)/edit-profile` | seller | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Change profile photo or video" | [view](../../docs/audit/screenshots/-buyer-edit-profile/seller/00-initial.png) |
| `/(buyer)/edit-profile` | seller | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Add profile video" | [view](../../docs/audit/screenshots/-buyer-edit-profile/seller/00-initial.png) |
| `/(buyer)/edit-profile` | seller | demo | hit-target-too-small | warn | 116x17px control "Add profile video" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/seller/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | fresh | clipped-text | warn | Text clipped (71px into 62px): "$220.00 +1" | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | fresh | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Northline Studio" | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Drop 04 is live. Ember season, cut heavy and made to last." | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | fresh | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "3" | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | fresh | min-size-violation | warn | font-size 10px below the 11pt caption floor on "3" | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | fresh | hit-target-too-small | warn | 38x38px control "NO" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | fresh | hit-target-too-small | warn | 14x14px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | fresh | hit-target-too-small | warn | 38x44px control "18.4K" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | fresh | hit-target-too-small | warn | 38x44px control "612" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | fresh | hit-target-too-small | warn | 38x44px control "1,290" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | fresh | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | fresh | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | fresh | hit-target-too-small | warn | 78x32px control "ShopField Shell Jacket — Rust$220.00 +1" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | fresh | hit-target-too-small | warn | 293x36px control "Northline Studio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | fresh | hit-target-too-small | warn | 215x24px control "Original Sound · northlinestudio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | fresh | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | fresh | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | fresh | hit-target-too-small | warn | 24x36px control "3" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | demo | clipped-text | warn | Text clipped (71px into 62px): "$220.00 +1" | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | demo | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Northline Studio" | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Drop 04 is live. Ember season, cut heavy and made to last." | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | demo | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "3" | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | demo | min-size-violation | warn | font-size 10px below the 11pt caption floor on "3" | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | demo | hit-target-too-small | warn | 38x38px control "NO" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | demo | hit-target-too-small | warn | 14x14px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | demo | hit-target-too-small | warn | 38x44px control "18.4K" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | demo | hit-target-too-small | warn | 38x44px control "612" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | demo | hit-target-too-small | warn | 38x44px control "1,290" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | demo | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | demo | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | demo | hit-target-too-small | warn | 78x32px control "ShopField Shell Jacket — Rust$220.00 +1" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | demo | hit-target-too-small | warn | 293x36px control "Northline Studio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | demo | hit-target-too-small | warn | 215x24px control "Original Sound · northlinestudio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | demo | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | demo | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
| `/(buyer)/edit-profile` | buyer | demo | hit-target-too-small | warn | 24x36px control "3" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-edit-profile/buyer/00-initial.png) |
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
| `/(buyer)/profile` | buyer | fresh | hit-target-too-small | warn | 60x38px control "0Followers" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | fresh | hit-target-too-small | warn | 59x38px control "0Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
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
| `/(buyer)/profile` | buyer | demo | hit-target-too-small | warn | 60x38px control "0Followers" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | demo | hit-target-too-small | warn | 59x38px control "0Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | demo | hit-target-too-small | warn | 157x36px control "Edit profile" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | demo | hit-target-too-small | warn | 157x36px control "Share profile" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |
| `/(buyer)/profile` | buyer | demo | hit-target-too-small | warn | 36x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-profile/buyer/00-initial.png) |

### Checkout / orders (80)

| Route | Role | Data state | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|---|
| `/(buyer)/cart` | buyer | fresh | clipped-text | warn | Text clipped (71px into 62px): "$220.00 +1" | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Northline Studio" | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Drop 04 is live. Ember season, cut heavy and made to last." | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "3" | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | min-size-violation | warn | font-size 10px below the 11pt caption floor on "3" | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | hit-target-too-small | warn | 38x38px control "NO" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | hit-target-too-small | warn | 14x14px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | hit-target-too-small | warn | 38x44px control "18.4K" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | hit-target-too-small | warn | 38x44px control "612" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | hit-target-too-small | warn | 38x44px control "1,290" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | hit-target-too-small | warn | 78x32px control "ShopField Shell Jacket — Rust$220.00 +1" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | hit-target-too-small | warn | 293x36px control "Northline Studio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | hit-target-too-small | warn | 215x24px control "Original Sound · northlinestudio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | fresh | hit-target-too-small | warn | 24x36px control "3" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | clipped-text | warn | Text clipped (71px into 62px): "$220.00 +1" | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Northline Studio" | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Drop 04 is live. Ember season, cut heavy and made to last." | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "3" | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | min-size-violation | warn | font-size 10px below the 11pt caption floor on "3" | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | hit-target-too-small | warn | 38x38px control "NO" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | hit-target-too-small | warn | 14x14px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | hit-target-too-small | warn | 38x44px control "18.4K" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | hit-target-too-small | warn | 38x44px control "612" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | hit-target-too-small | warn | 38x44px control "1,290" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | hit-target-too-small | warn | 78x32px control "ShopField Shell Jacket — Rust$220.00 +1" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | hit-target-too-small | warn | 293x36px control "Northline Studio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | hit-target-too-small | warn | 215x24px control "Original Sound · northlinestudio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/cart` | buyer | demo | hit-target-too-small | warn | 24x36px control "3" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-cart/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | fresh | clipped-text | warn | Text clipped (71px into 62px): "$220.00 +1" | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | fresh | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Northline Studio" | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Drop 04 is live. Ember season, cut heavy and made to last." | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | fresh | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "3" | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | fresh | min-size-violation | warn | font-size 10px below the 11pt caption floor on "3" | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | fresh | hit-target-too-small | warn | 38x38px control "NO" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | fresh | hit-target-too-small | warn | 14x14px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | fresh | hit-target-too-small | warn | 38x44px control "18.4K" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | fresh | hit-target-too-small | warn | 38x44px control "612" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | fresh | hit-target-too-small | warn | 38x44px control "1,290" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | fresh | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | fresh | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | fresh | hit-target-too-small | warn | 78x32px control "ShopField Shell Jacket — Rust$220.00 +1" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | fresh | hit-target-too-small | warn | 293x36px control "Northline Studio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | fresh | hit-target-too-small | warn | 215x24px control "Original Sound · northlinestudio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | fresh | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | fresh | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | fresh | hit-target-too-small | warn | 24x36px control "3" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | demo | clipped-text | warn | Text clipped (71px into 62px): "$220.00 +1" | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | demo | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Northline Studio" | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Drop 04 is live. Ember season, cut heavy and made to last." | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | demo | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "3" | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | demo | min-size-violation | warn | font-size 10px below the 11pt caption floor on "3" | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | demo | hit-target-too-small | warn | 38x38px control "NO" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | demo | hit-target-too-small | warn | 14x14px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | demo | hit-target-too-small | warn | 38x44px control "18.4K" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | demo | hit-target-too-small | warn | 38x44px control "612" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | demo | hit-target-too-small | warn | 38x44px control "1,290" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | demo | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | demo | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | demo | hit-target-too-small | warn | 78x32px control "ShopField Shell Jacket — Rust$220.00 +1" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | demo | hit-target-too-small | warn | 293x36px control "Northline Studio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | demo | hit-target-too-small | warn | 215x24px control "Original Sound · northlinestudio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | demo | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | demo | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |
| `/(buyer)/orders` | buyer | demo | hit-target-too-small | warn | 24x36px control "3" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-orders/buyer/00-initial.png) |

### Messaging (40)

| Route | Role | Data state | Type | Tier | Detail | Screenshot |
|---|---|---|---|---|---|---|
| `/(buyer)/inbox` | buyer | fresh | clipped-text | warn | Text clipped (71px into 62px): "$220.00 +1" | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | fresh | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Northline Studio" | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | fresh | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Drop 04 is live. Ember season, cut heavy and made to last." | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | fresh | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "3" | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | fresh | min-size-violation | warn | font-size 10px below the 11pt caption floor on "3" | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | fresh | hit-target-too-small | warn | 38x38px control "NO" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | fresh | hit-target-too-small | warn | 14x14px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | fresh | hit-target-too-small | warn | 38x44px control "18.4K" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | fresh | hit-target-too-small | warn | 38x44px control "612" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | fresh | hit-target-too-small | warn | 38x44px control "1,290" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | fresh | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | fresh | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | fresh | hit-target-too-small | warn | 78x32px control "ShopField Shell Jacket — Rust$220.00 +1" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | fresh | hit-target-too-small | warn | 293x36px control "Northline Studio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | fresh | hit-target-too-small | warn | 215x24px control "Original Sound · northlinestudio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | fresh | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | fresh | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | fresh | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | fresh | hit-target-too-small | warn | 24x36px control "3" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | demo | clipped-text | warn | Text clipped (71px into 62px): "$220.00 +1" | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | demo | type-scale-drift | warn | font-size 16px not on declared FS scale (nearest 15) on "Northline Studio" | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | demo | type-scale-drift | warn | font-size 14px not on declared FS scale (nearest 13) on "Drop 04 is live. Ember season, cut heavy and made to last." | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | demo | type-scale-drift | warn | font-size 10px not on declared FS scale (nearest 11) on "3" | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | demo | min-size-violation | warn | font-size 10px below the 11pt caption floor on "3" | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | demo | hit-target-too-small | warn | 38x38px control "NO" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | demo | hit-target-too-small | warn | 14x14px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | demo | hit-target-too-small | warn | 38x44px control "18.4K" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | demo | hit-target-too-small | warn | 38x44px control "612" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | demo | hit-target-too-small | warn | 38x44px control "1,290" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | demo | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | demo | hit-target-too-small | warn | 38x29px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | demo | hit-target-too-small | warn | 78x32px control "ShopField Shell Jacket — Rust$220.00 +1" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | demo | hit-target-too-small | warn | 293x36px control "Northline Studio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | demo | hit-target-too-small | warn | 215x24px control "Original Sound · northlinestudio" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | demo | hit-target-too-small | warn | 92x18px control "Following" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | demo | hit-target-too-small | warn | 84x18px control "Threads" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | demo | hit-target-too-small | warn | 24x36px control "" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
| `/(buyer)/inbox` | buyer | demo | hit-target-too-small | warn | 24x36px control "3" under 44x44 (hitSlop not verifiable from DOM) | [view](../../docs/audit/screenshots/-buyer-inbox/buyer/00-initial.png) |
