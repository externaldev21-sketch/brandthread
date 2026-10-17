# Navigation performance

## Native evidence versus browser diagnostics

An Expo web benchmark is **not** an iPhone/Hermes or App Store benchmark.
JavaScript frame gaps are not GPU/compositor dropped frames. A route/URL
commit followed by two animation frames is a navigation-settle proxy, not
proof of when the destination first became visible.

For native release measurements:

1. Use the existing managed Expo service in `--no-dev --minify` mode, or an
   internal release build. Do not start a duplicate Metro server.
2. Explicitly enable `EXPO_PUBLIC_PERF_MARKS=1` for that internal test build.
   Do not enable preview/auth bypasses to measure real signed-in accounts.
3. Inspect `globalThis.__btNavigationTrace` in the app's JS runtime. Confirm
   the reported engine is Hermes. Records are bounded and contain route
   patterns, not account IDs or query parameters.
4. Pair those records with a physical-device recording/profiler to establish
   visible paint, UI-thread frame delivery and keyboard/focus behavior.
5. Measure fresh, warm-cache and populated-account cases separately.

Development Expo Go has extra compilation, validation and debugging overhead.
Do not present its timings as release performance, or infer a native speedup
from a browser result.

## Repeatable web comparison

`scripts/navigation-perf-harness.mjs` accepts `--dir`, `--out`, `--runs`,
`--cpu`, and an optional comma-separated `--only` screen-name filter.
Run it from the workspace root against a completed minified Expo web export.
Use the same browser/device profile, CPU factor and sample count on both
versions. It uses actual touches for tabs and router dispatch for secondary
screens; those are labeled separately.

The standard scenario set covers nine buyer/seller tabs and twenty common
secondary destinations at 390×844. This is not an analytics-derived usage
ranking or an exhaustive audit of every app route. The fresh preview does not
represent a populated signed-in seller account.

Keep benchmark exports, raw logs and reports in ignored workspace storage.
Any export built with the development navigation-isolation preview flag is
local test material only: **never publish that export**.

### Avoid invalid comparisons

- Do not run typechecks, bundle exports, screenshots or another benchmark
  concurrently with timing samples.
- Dismiss back to an existing navigation root; replacing pushed pages with
  new tab groups can accumulate duplicate retained navigators.
- Checkpoint each scenario. Reject timeouts instead of treating them as zero.
- Report regressions as well as improvements, and disclose the sample count.
- Expected request cancellation when closing a test context is separate from
  an application page error.

## Retention and speculative work

Native-stack/screens coordinates native freezing with transitions. Web scenes
only suspend trees already hidden by their navigator, after blur cleanup.
Do not freeze visible-but-covered tab DOM using Suspense: hiding/revealing all
host nodes triggers a large React Native Web layout-measurement burst on resume.
A tab whose parent opens a transparent modal must remain visible underneath.

Speculative route warming loads code only, after the first paint in idle
slots. It must not mount screens, trigger permissions, mark conversations read
or initiate mutations. Existing account-scoped data prefetch owns data warming.

## Hard release targets

The owner-approved limits are touch-down visual feedback ≤16 ms, cached full
layout <100 ms, fresh full layout (real data or correctly sized skeleton) <300 ms,
no navigation JS stall >50 ms, and zero dropped compositor frames during measured
60 Hz / 120 Hz gesture runs. Test ProMotion separately at 120 Hz; a 60 Hz test
cannot certify 120 Hz. Use the worst observation, not an average that hides stalls.

`lib/navigation/performanceBudgets.ts` enforces strict layout thresholds and
rejects missing, invalid, dev-mode, non-Hermes and browser evidence for native
acceptance. Unknown is not a pass. These limits are not proof that they are met.

Generate the per-tab/per-screen acceptance matrix from the workspace root:

```
node artifacts/mobile/scripts/performance-budget-report.mjs \
  --web-report .local/performance/after-verified.json \
  --out .local/performance/native-targets.csv
```

Without physical native production measurements the command intentionally
exits 1 and labels every native target UNVERIFIED. To include device measurements,
pass `--native-evidence <file.json>` containing `observations[]`; each observation
has `role`, `route` and the `BudgetEvidence` fields. Input/route-commit rAF
traces must not be supplied as visible-feedback/full-layout/compositor evidence.
Record tested device, OS, build revision, refresh rate, account/data scenario and
gesture procedure alongside the raw device evidence. The sample schema is:

```
{
  "observations": [{
    "role": "buyer", "route": "/(buyer)",
    "production": true, "platform": "ios", "engine": "Hermes",
    "feedbackMs": [], "cachedLayoutMs": [], "freshLayoutMs": [],
    "navigationJsStallMs": [],
    "nativeFrames": { "refreshRateHz": 120, "presented": 0, "dropped": 0 }
  }]
}
```

Empty sample arrays or zero observed compositor frames fail the gate. Measure
fresh and cached scenarios separately. Timestamp feedback with device/compositor
evidence, not the time JS received an onPress callback. Root-container layout or
URL changes alone do not establish that the final-sized content is on screen.

Hermes is already Expo's native engine and React Compiler is already enabled in
the app config. Production Babel strips debug console calls on iOS, Android and
web while retaining warning/error diagnostics; development logs are unaffected.
The iOS ProMotion plist opt-in affects the next native build, not an existing
Expo Go binary, and does not by itself guarantee 120 fps.
