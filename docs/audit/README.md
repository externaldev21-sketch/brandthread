# Half-done audit

`artifacts/mobile/scripts/audit/half-done-audit.mjs` is a Playwright-based
audit that loads every route under `artifacts/mobile/app` in both
`?bt_preview=seller` and `?bt_preview=buyer` modes at 393×852, taps every
visible control one level deep, and flags the kinds of "half-assed" issues
Dev found in the seller dashboard chart (repeated labels, dead taps,
placeholder copy, low-contrast text, undersized hit targets, off-palette
colors, non-Inter fonts, off-scale type sizes...) across the whole app.

It reuses the same demo web build + fake Clerk/API harness as
`scripts/store-screenshots/` — no real backend or network egress involved.

## Data-state dimension: fresh vs. `&demo=1`

Every route/role is audited under two data states:

- **fresh** (default, no query param) — a brand-new/empty account. Most of
  the app's preview data sources (`lib/previewInbox.ts`, `previewOrders.ts`,
  `previewSellerProducts.ts`, `previewActivity.ts`, `previewNotes.ts`,
  `previewStories.ts`, `previewThreadCash.ts`, `previewSellerChartData.ts`,
  …) render empty/zero-state by default under this state.
- **demo** (`&demo=1`) — the app's own populated-preview-dataset opt-in,
  gated by `isPreviewDemoMode()` in `artifacts/mobile/lib/devPreview.ts`.
  This switches the same preview data sources over to their seeded,
  populated fixtures (sample orders, messages, followers, chart history,
  etc). This was already implemented app-side (not something this audit
  added) — the audit script just learned to toggle it.

Pass `--data-states fresh,demo` to audit both (this is what
`audit:half-done:full` does); the flag defaults to `fresh` only, to keep the
historical single-state behavior for a quick local `--only` iteration.
Findings and the report's route/area/owner breakdowns are all tagged with
which data state they were found under.

## Running it locally

```
pnpm --filter mobile run audit:half-done
# or, iterating on one route without rebuilding each time:
pnpm --filter mobile run audit:half-done -- --skip-build --only buyer-checkout --data-states fresh,demo
```

Useful flags: `--only <substring,...>` (matches route path or file),
`--limit N`, `--roles seller,buyer`, `--data-states fresh,demo` (see above;
default `fresh`), `--time-budget-ms N` (global wall-clock cap — the script
writes whatever it collected so far when the budget is hit, so a full run
can be safely interrupted), `--per-route-budget-ms N`, `--max-taps N`
(controls taps per route/role/data-state before moving on), `--ci` (exit 1
on new hard-tier findings — see below), `--shard-out <path.json>` (dump raw
combo results to a file instead of writing the top-level report/baseline —
used by the full shard runner below, not needed for ad hoc local runs).

## Running the full 274-route × 2-role × 2-data-state audit

A genuinely full run (~1,000+ combinations, each with up to `--max-taps`
real taps) is too much for one bounded Playwright process, so
`run-full-audit.mjs` splits the route list into fixed-size shards, runs each
shard as its own bounded `half-done-audit.mjs --shard-out ...` child
process, and re-merges every shard's raw results into the final
`half-done-findings.json` / `half-done-audit-report.md` / baseline after
*each* shard — not only at the end — committing (and pushing) as it goes:

```
pnpm --filter mobile run audit:half-done:full
# tune it:
pnpm --filter mobile run audit:half-done:full -- --chunk-size 15 --per-shard-budget-ms 1500000
# resume a run that stopped partway (skips shards whose .audit-shards/shard-NNN.json already exists):
pnpm --filter mobile run audit:half-done:full -- --resume
# local dry run, no git:
pnpm --filter mobile run audit:half-done:full -- --no-commit --no-push
```

Raw per-shard results live in `.audit-shards/shard-NNN.json` at the repo
root (committed, so a run can be resumed across sessions/container
restarts with `--resume` without redoing already-audited shards) and are
combined by `merge-shard-results.mjs`, which can also be invoked directly
against an arbitrary set of shard files:

```
node scripts/audit/merge-shard-results.mjs .audit-shards/*.json
```

**Re-running on every merge to `dev` / every few hours**: point a scheduled
job (or a follow-up session) at `pnpm --filter mobile run audit:half-done:full
-- --resume` if you want to pick up an interrupted run, or without
`--resume` for a completely fresh pass (delete `.audit-shards/` first if you
don't want the old shard files lying around). Either way it's the one
command that (re)builds, shards, audits, merges, and updates the baseline —
no manual multi-step process needed.

Output:
- `docs/audit/half-done-findings.json` — structured findings, this run
- `docs/audit/half-done-audit-report.md` — human-readable report, with a
  scoreboard broken down by area/owner (see below) as well as the original
  per-category and per-area (Seller dashboard, Buyer discover, Messaging,
  Live, Checkout, …) breakdowns
- `artifacts/mobile/docs/audit/screenshots/<route-slug>/<role>/*.png` — one
  screenshot per route/role/data-state, plus one per dead-control finding

## Area/owner mapping (the scoreboard)

`route-ownership.json` (+ its `route-ownership.mjs` loader, which exposes
`ownerForRoute(routePath)`) maps every route to one of the app's 9
owner areas for tonight's whole-app audit:

- **buyer** — the buyer-facing browse/discover/checkout/DM/wallet
  experience: the `(buyer)` route group, `buyer-*` routes not claimed by a
  more specific area below, `checkout`/`cart`/`thread-checkout`,
  `thread-cash`/`thread-explainer`, `drops/`, `c/` (collections).
- **supply** — manufacturer/supply-chain/B2B: `manufacturer*`,
  `invite-manufacturer`, `freelancer-*`, `rfq-*`, `quote-*`,
  `request-sample`/`sample-detail`, `production-detail`.
- **store+account** — store builder/settings and generic account/security
  settings that aren't seller-commerce-specific: `store-*` (builder, theme,
  domain, SEO, publish, …), `account-type*`, `settings`/`security`/`privacy`
  /`billing`/`subscription`/`plans`, sign-in/onboarding/setup, `team*`,
  `roles`/`users`, `help`/`terms`, and the generic app-shell routes
  (`splash`, root `index`).
- **seller commerce** — products/inventory/orders/payouts:
  `add-product`/`product-*`, `(tabs)/products`, `(tabs)/orders`/`orders`
  /`order-detail`, `customer-*`, `fulfill-*`, `shipping*`, `discounts`,
  `payouts`/`payments`/`finance`/`taxes-duties`, `dispute-detail`
  /`refund-detail`/`return-detail` (the seller-side admin screens — the
  buyer-initiated `buyer-refund-request`/`buyer-return-request` stay under
  **buyer**).
- **growth** — dashboard/analytics/marketing/growth tooling: `(tabs)`
  (seller dashboard root) and `(tabs)/analytics`/`(tabs)/marketing`, every
  `analytics-*` route, `meta-ads-*`, `automation`, `boost`, `integrations/*`,
  `post-analytics`, `admin-reports`, `loyalty`, and the seller-side AI
  assistant routes (`ai-assistant`, `ai-brain`, `ai-brand-memory`,
  `ai-settings`). **Note**: the seller dashboard revenue chart itself (on
  `(tabs)` root) is separately being rebuilt by this same session per the
  "known exception" below — its findings are still counted under growth in
  this scoreboard like any other route, just not something a follow-up PR
  should pick up.
- **live** — `live`/`live-feed`, `seller-live`/`seller-go-live`,
  `buyer-live`, `call-screen`.
- **profiles+social** — profile pages (`edit-profile`, `seller-profile`,
  `buyer-other-profile`, `u/[username]`), the social graph
  (`following`/`buyer-friends`/`connections`), messaging/DMs
  (`seller-inbox`/`seller-conversation`, `conversation-*`,
  `community-chat`), posts/stories (`create-post`, `buyer-post-*`,
  `buyer-story-*`), and the notification/activity/moderation surface
  (`activity-*`, `buyer-notifications`, `buyer-blocked`/`buyer-muted`
  /`buyer-restricted`/`buyer-report`).
- **design** — the design studio: `design`/`design-*` (canvas, mockup,
  garment, campaign, templates, …), the creative AI tools (`ai-studio`,
  `ai-mockup-chat`, `ai-photography-chat`, `bg-removal`, `camera-capture`,
  `tech-pack-generator`, `lifestyle-images`, `mobile-app-builder`), and
  `app-icon`/`app-theme`.
- **headers/tab bar/crawl** — this is deliberately **cross-cutting**, not a
  route set: every route has a header/tab-bar/safe-area surface to sweep, so
  this area's real scope isn't well captured by "routes owned" the way the
  other 8 areas are. The mapping gives it exactly one dedicated route
  (`navigation-isolation-probe`, the nav-shell test harness route) so the
  scoreboard has a row for it, but its actual audit signal is better read
  off header/notch/hit-target-adjacent findings (contrast, hit-target-size,
  clipped-text near the top/bottom safe areas) scattered across *every*
  other area's rows, not a dedicated bucket. Documented here so nobody reads
  "headers: 1 route" as "this area is basically done."

The heuristic: match the most specific substring/prefix first (dynamic
routes and route groups included, e.g. `/(tabs)/analytics` before the
generic `/(tabs)` fallback, `/buyer-refund-request` before the generic
`/buyer` fallback), fall through a chain of ~140 ordered rules, and default
anything unmatched to **store+account** (the generic-app-shell catch-all) —
in practice every one of the 266 discovered routes matches a specific rule
before reaching that fallback; `unassigned (needs a route-ownership.json
rule)` in a report means a genuinely new route was added and needs a rule.
A handful of judgment calls worth flagging explicitly: seller/buyer DM
inboxes went to **profiles+social** rather than **seller commerce** /
**buyer** (messaging felt more "social surface" than "commerce logic");
manufacturer messaging stayed under **supply** rather than
**profiles+social** (it's B2B supply-chain communication, not the social
graph); and `tech-pack-generator` / `bg-removal` / `camera-capture` went to
**design** rather than **supply** even though they're used in the
manufacturing flow, because they're creative/AI tooling, the same category
as the rest of the design studio.

## Two-tier policy (why not "fail on any finding")

The app has ~275 routes and this is the *first* full pass — a naive "fail CI
on any finding" would fail every future PR until all of that pre-existing
debt is fixed, which isn't how any of the ~40 prior PRs tonight have worked
and isn't achievable in one PR. Two tiers, chosen over a full-baseline
ratchet for *all* categories because the categories genuinely differ in how
safe they are to gate hard immediately:

- **Hard tier** (blocks CI on any *new* instance): console errors, dead
  controls, placeholder/stub copy, broken images, repeated/garbage labels,
  visible preview/demo wording (see below), and error-boundary fallback
  screens. These are unambiguous bugs — no legitimate design reason for any
  of them — and a `docs/audit/half-done-baseline.json`
  ratchet is used just for this tier: `--ci` fails only on a hard finding
  that isn't already in the baseline. Existing hard findings are tracked (see
  the report) but don't block; *new* ones do.
- **Warn tier** (reported, never blocks): color-rule, font-family,
  type-scale, min-size, contrast, hit-target, clipped/overlapping text, and
  button-system-consistency findings. These are pervasive (hundreds of
  instances across 275 routes) and genuinely require per-screen design
  fixes — gating on them today would block every PR indefinitely. The CI job
  prints the warn-tier count and uploads the full report/screenshots as a
  build artifact so it stays visible without blocking merges.

This is the more honest split of the two options considered (full ratchet
on everything vs. hard/warn split): a full-baseline ratchet on the
color/contrast/type-scale categories would let those regress silently one
pixel at a time as long as each individual PR's *new* violations matched
count-for-count against something already in the baseline going stale, and
the baseline file itself would need constant, error-prone hand-maintenance
across 275 routes' worth of pre-existing drift. Splitting by category is
simpler to reason about and impossible to game: the categories that are
either right or wrong (a dead button either does something or it doesn't)
are gated immediately; the categories that are matters of degree across a
huge existing surface are tracked but not gated, until follow-up PRs bring
each area's baseline down and a future PR can promote it to hard-gated
per-area.

## Zero-tolerance CI gate + warn-tier ratchet (`audit:gate`)

The two-tier split above (hard blocks on *new* only, warn never blocks) was
the right call for the audit's first pass, but it's no longer the whole
story: Dev wants a real zero-tolerance gate on hard-tier findings now that
the app is being actively driven to a clean state, plus a warn-tier count
that can only ever go down. `artifacts/mobile/scripts/audit/audit-gate.mjs`
(`pnpm --filter mobile run audit:gate`) sits on top of `half-done-audit.mjs`
and adds both, without changing that script's own `--ci` flag (the
new-findings-only baseline gate described above is still there for anyone
who wants that specific check):

1. Runs the audit (any flags after `--` — `--only`, `--roles`, `--limit`,
   `--skip-build`, `--time-budget-ms`, etc. — pass straight through to
   `half-done-audit.mjs`; see that script's own header for the full list).
2. **Hard tier is zero-tolerance**: fails if this run has *any* hard-tier
   finding, full stop — `half-done-baseline.json`'s new-vs-existing
   exemption is not consulted. "Already broken before this PR" is no longer
   an acceptable reason for a hard-tier issue to ship.
3. **Warn tier is a strict ratchet**: fails if this run's warn-tier count is
   `>=` the count recorded in `docs/audit/warn-baseline.json`. Equal counts
   fail *on purpose* — a PR that touches audited surface must show a real
   improvement, not just hold steady while adding debt elsewhere that nets
   out even.

CI scope: a full run takes on the order of hours locally, and the existing
`half-done-audit` CI job (`docs/ci/ci-cd.yml.disabled`) already budgets 60
minutes for exactly one full run. Rather than doubling that cost with a
second full pass, the CI job now calls `audit:gate` directly with no extra
flags (replacing the old `audit:half-done -- --ci` step) — still exactly one
full run per PR, its results now judged by the zero-tolerance/ratchet rules
above instead of the baseline-exemption rule. For fast local iteration on
one area, pass `--only`/`--limit`/`--skip-build` through (e.g.
`pnpm --filter mobile run audit:gate -- --only buyer-checkout
--skip-build`) to check hard-tier zero-tolerance quickly — just note a
narrowly-scoped run's warn count is not a meaningful number to compare
against a baseline recorded from a full run, so treat a scoped run's warn
gate result as informational only, not as a reason to skip a full run before
merging a warn-affecting change.

### Updating the warn-tier baseline

After a PR genuinely reduces the warn-tier count (fixes contrast/type-scale/
hit-target/etc. issues rather than just avoiding new ones), record the new,
lower count as the baseline:

```
pnpm --filter mobile run audit:gate:update-baseline
```

This runs a full audit and, only if hard-tier findings are 0 and the new
warn count is strictly lower than what's currently recorded, overwrites
`docs/audit/warn-baseline.json` with the new count and a timestamp. It
refuses to write (exits 1) if either condition isn't met — in particular, it
will never let the baseline move up. Do not run this as a side effect of a
PR that doesn't itself improve warn-tier findings; wiring the mechanism up
is not the same as using it opportunistically to paper over an unrelated
regression.

`docs/audit/warn-baseline.json`'s current count was seeded from the
`half-done-findings.json` full run already committed alongside it (see that
file's `summary` for the exact run it reflects) — it is a real, current
number, not a placeholder.

## Refreshing the baseline

After a follow-up PR fixes hard-tier findings in an area, regenerate the
baseline so CI doesn't keep silently permitting issues that are actually
fixed (a stale baseline that's too permissive is worse than no baseline):

```
pnpm --filter mobile run audit:half-done   # full run, writes half-done-findings.json
node -e "
  const fs = require('fs');
  const d = JSON.parse(fs.readFileSync('docs/audit/half-done-findings.json'));
  const hardKeys = d.findings.filter(f => f.tier === 'hard').map(f => {
    return f.type + '::' + f.route + '::' + f.role + '::' + (f.control || f.text || f.detail || '').slice(0, 80);
  });
  fs.writeFileSync('docs/audit/half-done-baseline.json', JSON.stringify({ hardKeys }, null, 2));
"
```

(`findingKey()` in the audit script is the source of truth for the key
format — keep this in sync with it.)

## Preview/demo wording (hard tier)

Dev's explicit rule: **no visible preview/demo label anywhere, ever** — a
fresh (empty) real install must read exactly like this text, no matter which
screen. `PREVIEW_DEMO_WORDING_RE` in the script flags any rendered text
containing "preview", "demo", "mock", "placeholder data", "test mode", or the
"read-only preview" / "until you reload" / "not load live" phrasings that
were found live (Payouts, Products, Discounts — see the "Purge preview
wording" PRs). It's hard-tier so this class of thing can't quietly reappear.

Deliberately excluded from the bare-word match, as a judgement call rather
than a blanket ban: bare "sample" (this app has a real, permanent
manufacturing "request a sample" / "AI logo sample" feature — unrelated to
demo data) and bare "read-only" (a real, permanent team-role permission
label — unrelated to preview mode). A screen that genuinely has a legitimate,
permanent "Preview" feature (e.g. previewing a drop or a storefront theme
before it's live, which real sellers use in production) will still show up
as a hard finding the first time this check runs — add it to the baseline
after confirming by eye that it's a real feature label and not a preview/demo
mode tell, the same way any other hard-tier finding is baselined.

## Known exception: the seller dashboard revenue chart

The chart on `/(tabs)` (seller dashboard root) — the one with repeated
"Sep Sep Sep…" axis labels that prompted this whole audit — is already being
rebuilt in a separate session (`019SGXKf`). Findings from that specific chart
are listed in the report for completeness but a follow-up agent should NOT
pick them up; check with that session first.

## Known limitations

- **Param synthesis**: dynamic routes (`[productId]`, `[username]`, …) and
  required query params are filled from a fixed dictionary of seeded preview
  IDs (see `PARAM_VALUES` in the script) sourced from
  `scripts/store-screenshots/demo-data.mjs`. A route whose required param
  isn't in that dictionary gets a generic fallback (`sample-1` — was
  `preview-1` until the full fresh+demo re-run below, which found it
  leaking into visible profile name/handle/initials text on a handful of
  routes and tripping the `preview-demo-wording` hard-tier check as a false
  positive; renamed to something that can't match that pattern) and may
  show as "unreachable" — check the report's Unreachable table before
  assuming a route is broken. Some `PARAM_VALUES` entries *do* legitimately
  contain "preview" (`preview-conversation-01`, `preview-order-01`) — those
  are real seed-fixture IDs the app itself defines
  (`lib/previewInboxData.ts`, `lib/previewOrders.ts`), not synthesis
  artifacts, and were deliberately left alone.
- **Two systemic patterns worth knowing about before triaging the full-run
  report** (docs/audit/half-done-audit-report.md), found while producing it:
  - **`console-error` (hard tier) is ~76% one repeated message**: "Failed to
    load resource: the server responded with a status of 404 (Not Found)"
    accounts for 750 of the run's 787 console-error findings, spread across
    nearly every route/role/data-state combo. Headless Chromium's
    `console.error` text for a failed resource load doesn't include the
    URL, so this audit can't yet tell you *which* resource 404s — but the
    near-universal spread strongly suggests one shared missing asset (a
    favicon, a manifest, an analytics/font request, …) hit on every page
    load, not 750 independent per-route bugs. Worth a quick manual check
    (open any route's web build in a real browser with devtools Network
    open) before an owning session budgets time as if this were hundreds of
    separate issues — it's most likely one fix that clears ~76% of the
    hard-tier count app-wide. This audit script doesn't attempt that
    diagnosis itself (finding the specific 404'ing URL needs Playwright's
    `page.on('requestfailed')`/`response` events wired in, not just
    `console` message text) — a good next improvement for whoever picks
    this up.
  - **Every one of the 266 routes shows at least one hard-tier finding** in
    the full run (every area's "zero-finding routes" column reads 0). The
    console-error pattern above is most of why. Don't read "0 zero-finding
    routes" as "every route is equally broken" — check the per-area detail
    tables for what's actually driving each area's count.
- **Empty-data / fresh-install check — resolved**: earlier revisions of this
  doc said the preview data layer had no "render this route with zero seeded
  items" switch and that this audit didn't attempt one. That's no longer
  true: `isPreviewDemoMode()` (`lib/devPreview.ts`) already gates the
  populated-vs-empty split across every preview data source
  (`previewInbox.ts`, `previewOrders.ts`, `previewSellerProducts.ts`,
  `previewActivity.ts`, `previewNotes.ts`, `previewStories.ts`,
  `previewThreadCash.ts`, `previewSellerChartData.ts`, …) via the `&demo=1`
  query param, and the audit script now toggles it (`--data-states
  fresh,demo`) — see "Data-state dimension" above. A screen that only breaks
  on zero orders/zero products/zero messages is caught by the `fresh` pass
  the same way a screen that only breaks once populated is caught by the
  `demo` pass.
- **Overlapping/clipped text** and **button-system-consistency** are
  heuristics, not a real layout engine: overlap is bounding-box intersection
  on on-screen elements only (off-screen/scrolled elements are excluded, but
  legitimately stacked decorative layers, e.g. a gradient overlay behind
  text, can still false-positive); button clustering groups elements by a
  simple solid-fill/outline heuristic and flags height/radius outliers from
  the cluster's mode — it will miss a consistently-wrong button variant that
  never appears next to a correct one, and can misclassify one-off custom
  controls as "buttons."
- **Color-rule tolerance**: monochrome detection allows an 11-point
  RGB-channel spread to match the app's own deliberately cool-toned grey
  scale (`lib/theme.ts` `TEXT_SECONDARY`/`TEXT_TERTIARY` etc. are not literal
  `r===g===b`); a color that's off-palette but happens to fall within that
  spread of grey would be missed. The three allowed accents (LIVE-red,
  end-call red, Thread Cash green) are matched by hue within 18°, not exact
  hex, to tolerate anti-aliasing/opacity blends.
- **Contrast** walks up the DOM for the nearest opaque background; a
  gradient or image background reads as the app's black `BG` fallback, which
  may over- or under-count contrast for text on photo/gradient surfaces.
- **Hit-target size** measures the rendered clickable element's box; RN Web's
  `hitSlop` isn't reliably reflected in computed DOM styles, so a control
  under 44×44px with real `hitSlop` compensation may show as a false
  positive — worth a manual spot-check before "fixing" a hit-target finding
  by resizing the visual element.
- **This is a first pass, not exhaustive coverage.** A full run (274 routes
  × 2 roles, tapping every control) takes on the order of hours; the initial
  report committed with this PR may be a time-budgeted partial run (see
  `interrupted`/`routesAudited` vs. `routesDiscovered` in the report header)
  — re-run locally or let the next scheduled CI run fill in the rest.
