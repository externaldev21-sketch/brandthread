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

## Running it locally

```
pnpm --filter mobile run audit:half-done
# or, iterating on one route without rebuilding each time:
pnpm --filter mobile run audit:half-done -- --skip-build --only buyer-checkout
```

Useful flags: `--only <substring,...>` (matches route path or file),
`--limit N`, `--roles seller,buyer`, `--time-budget-ms N` (global wall-clock
cap — the script writes whatever it collected so far when the budget is hit,
so a full run can be safely interrupted), `--per-route-budget-ms N`,
`--max-taps N` (controls tapped per route/role before moving on), `--ci`
(exit 1 on new hard-tier findings — see below).

Output:
- `docs/audit/half-done-findings.json` — structured findings, this run
- `docs/audit/half-done-audit-report.md` — human-readable report, grouped by
  area (Seller dashboard, Buyer discover, Messaging, Live, Checkout, …)
- `artifacts/mobile/docs/audit/screenshots/<route-slug>/<role>/*.png` — one
  screenshot per route/role, plus one per dead-control finding

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
  isn't in that dictionary gets a generic fallback and may show as
  "unreachable" — check the report's Unreachable table before assuming a
  route is broken.
- **Empty-data / fresh-install check**: the preview data layer
  (`lib/previewInbox.ts`, `lib/previewCatalog.ts`, `lib/previewDiscover.ts`,
  the `demo-data.mjs` fixtures) has no existing per-screen "render this route
  with zero seeded items" switch. This audit does NOT attempt to build one —
  that's a larger change (adding an empty-variant flag threaded through every
  preview data source) left for a follow-up PR. This is a real gap: a screen
  that only breaks on zero orders/zero products/zero messages will not be
  caught by this audit today.
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
