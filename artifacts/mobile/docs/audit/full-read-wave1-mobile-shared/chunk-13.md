# Chunk 13
## Files read
| file | lines read (= file length) | defects found | defects fixed |
|---|---|---|---|
| artifacts/mobile/lib/a11yHidden.ts | 21 | 0 | 0 |
| artifacts/mobile/lib/accessGate.ts | 15 | 0 | 0 |
| artifacts/mobile/lib/accountSecurityErrors.test.ts | 77 | 0 | 0 |
| artifacts/mobile/lib/accountSecurityErrors.ts | 113 | 0 | 0 |
| artifacts/mobile/lib/accountService.ts | 120 | 0 | 0 |
| artifacts/mobile/lib/accountSettings.ts | 92 | 1 | 1 |
| artifacts/mobile/lib/accountStatus.ts | 46 | 0 | 0 |
| artifacts/mobile/lib/accountStorage.ts | 97 | 0 | 0 |
| artifacts/mobile/lib/accountSwitcherHelpers.ts | 48 | 0 | 0 |
| artifacts/mobile/lib/accountTypeSwitch.test.ts | 58 | 0 | 0 |
| artifacts/mobile/lib/accountTypeSwitch.ts | 95 | 0 | 0 |
| artifacts/mobile/lib/accountWall.test.ts | 58 | 0 | 0 |
| artifacts/mobile/lib/actionSheet.ts | 118 | 0 | 0 |
| artifacts/mobile/lib/activity.test.ts | 858 | 0 | 0 |
| artifacts/mobile/lib/activity.ts | 1108 | 3 (duplicate case labels, see judgment calls) | 0 |
| artifacts/mobile/lib/activityRestockTypes.test.ts | 24 | 0 | 0 |
| artifacts/mobile/lib/activityTrending.test.ts | 64 | 0 | 0 |
| artifacts/mobile/lib/activityTrending.ts | 75 | 0 | 0 |
| artifacts/mobile/lib/adCampaignFormState.ts | 47 | 0 | 0 |
| artifacts/mobile/lib/adDestination.test.ts | 23 | 0 | 0 |
| artifacts/mobile/lib/adDestination.ts | 24 | 0 | 0 |
| artifacts/mobile/lib/addressFormat.ts | 33 | 0 | 0 |
| artifacts/mobile/lib/addressRegions.ts | 32 | 0 | 0 |
| artifacts/mobile/lib/adjustmentsCatalog.ts | 144 | 0 | 0 |
| artifacts/mobile/lib/adjustmentsModel.ts | 351 | 3 (comments) | 3 |
| artifacts/mobile/lib/affiliateRef.ts | 43 | 0 | 0 |
| artifacts/mobile/lib/affiliateTypes.ts | 100 | 0 | 0 |
| artifacts/mobile/lib/ageGate.test.ts | 66 | 0 | 0 |
| artifacts/mobile/lib/ageGate.ts | 126 | 1 | 1 |
| artifacts/mobile/lib/agentChat.ts | 111 | 0 | 0 |
| artifacts/mobile/lib/agoraAvailability.ts | 22 | 0 | 0 |
| artifacts/mobile/lib/aiConsent.test.ts | 57 | 0 | 0 |
| artifacts/mobile/lib/aiConsent.ts | 107 | 0 | 0 |
| artifacts/mobile/lib/aiCredits.test.ts | 81 | 0 | 0 |
| artifacts/mobile/lib/aiCredits.ts | 106 | 0 | 0 |
| artifacts/mobile/lib/aiCreditsError.ts | 71 | 1 | 1 |
| artifacts/mobile/lib/aiHelperHandoff.test.ts | 32 | 0 | 0 |
| artifacts/mobile/lib/aiHelperHandoff.ts | 23 | 0 | 0 |
| artifacts/mobile/lib/aiMarkdownLite.ts | 95 | 0 | 0 |
| artifacts/mobile/lib/aiStudioCanvas.ts | 39 | 0 | 0 |
| artifacts/mobile/lib/aiToolErrors.test.ts | 20 | 0 | 0 |
| artifacts/mobile/lib/aiToolErrors.ts | 20 | 0 | 0 |
| artifacts/mobile/lib/aiToolMedia.ts | 97 | 0 | 0 |
| artifacts/mobile/lib/airPrint.test.ts | 81 | 0 | 0 |
| artifacts/mobile/lib/airPrint.ts | 74 | 0 | 0 |
| artifacts/mobile/lib/alphabetIndex.test.ts | 44 | 0 | 0 |
| artifacts/mobile/lib/alphabetIndex.ts | 49 | 0 | 0 |
| artifacts/mobile/lib/analyticsMetricTiles.ts | 19 | 0 | 0 |
| artifacts/mobile/lib/analyticsSummary.test.ts | 30 | 0 | 0 |
| artifacts/mobile/lib/analyticsSummary.ts | 40 | 0 | 0 |
| artifacts/mobile/lib/animationUtils.ts | 137 | 1 | 1 |
| artifacts/mobile/lib/api-auto-retry.test.ts | 66 | 0 | 0 |
| artifacts/mobile/lib/api-install-id.test.ts | 40 | 0 | 0 |
| artifacts/mobile/lib/api-store-context.test.ts | 105 | 0 | 0 |

(Line counts are the original file lengths as listed in chunk13.txt; every line was read. All 18 pre-existing test files in the chunk passed before any change.)

## Fixes
- `artifacts/mobile/lib/accountSettings.ts:32,51-66,79-81` — a stale response could overwrite newer data. If a GET /api/me/settings was in flight and a PATCH then finished, the older GET resolved afterwards and wrote its pre-PATCH settings over the PATCH result in the 60s memo. Every screen that read settings within the next minute then showed the old value (for example, a private-account toggle that had just been saved showed as off). → Added a per-account write generation. A PATCH bumps it and drops the in-flight GET; a GET that sees the generation change no longer writes the memo and returns the newer memo value. Test: `artifacts/mobile/lib/accountSettings.audit.test.ts` (failed before: yes, first case; the second case is a regression guard).
- `artifacts/mobile/lib/ageGate.ts:101-129` (`useAgeStatus`) — the status was not reset on an account switch or sign-out. The status was plain state, set once from the first account. When `userId` changed or the user signed out while the screen stayed mounted, the previous account's 'restricted' (13-17) status stayed on screen. On payouts and go-live the next adult account was blocked until its own /auth/me came back, or for good if that call failed. When signed out it also stayed 'restricted', although the doc comment says signed-out reads as 'ok'. → The loaded status is now tagged with the userId it belongs to. The returned status is 'ok' when signed out, the tagged status when it matches the current user, and otherwise the per-user cache or 'ok'. Test: `artifacts/mobile/lib/ageGate.audit.test.tsx` (failed before: yes).
- `artifacts/mobile/lib/aiCreditsError.ts:13,54-56` — `surfaceAiCreditsError` showed the 429 user_daily_cap and 503 global_daily_cap alerts with `Alert.alert`. That call is a silent no-op on react-native-web (see lib/actionSheet.ts), so on web a person who hit the AI cap got no explanation. → It now uses `showAlert` from `./actionSheet`, which calls `Alert.alert` on native and the WebAlertHost on web. The import is static: a lazy `require` did not reach the same module instance under vitest. Test: `artifacts/mobile/lib/aiCreditsError.audit.test.ts` (failed before: yes).
- `artifacts/mobile/lib/animationUtils.ts:85-91` (`snapToDevicePixel`) — the documented contract is "off-web this returns `value` unchanged". The code only checked `typeof window`, but React Native defines `global.window = global` (node_modules/react-native/Libraries/Core/setUpGlobals.js). On native, dpr fell back to 1 and every value was rounded to a whole dp. → It now returns the value unchanged when `Platform.OS !== 'web'`. Test: `artifacts/mobile/lib/animationUtils.audit.test.ts` (failed before: yes; with window stubbed to dpr 2 on ios, 15.3 came back as 15.5). There are currently no callers.
- `artifacts/mobile/lib/adjustmentsModel.ts:11-14` — comment fix (no test). The header said curves are "applied as an SVG feComponentTransfer tableValues approximation in the compositor". In fact the compositor uses a gain/bias feColorMatrix (lib/layerRenderer.ts `curvesToColorMatrixValues`), and the same file says react-native-svg does not implement feComponentTransfer. `curveToTableValues` only drives the preview bars in app/design-canvas.tsx.
- `artifacts/mobile/lib/adjustmentsModel.ts:100-104` — comment fix (no test). The doc block was titled `curvesAdjustmentToSvgFilter` (no such function) and described a filter-string builder plus a compositor opacity fallback. It sits on `gammaApproxOpacity`, which the app never calls (only tests/adjustments-tool.test.ts uses it). It is rewritten to describe what the function actually does.
- `artifacts/mobile/lib/adjustmentsModel.ts:~140` — comment fix (no test). `HISTOGRAM_UNAVAILABLE` was described as "All channels are null arrays", but it is plain `null`.

## Judgment calls — not changed
- `artifacts/mobile/lib/activity.ts:550,559` — `activityIcon` has `case 'live_started'` twice: 'radio' wins and 'video' can never be reached (Vite warns about it). Which icon is meant is a design choice, so I left it.
- `artifacts/mobile/lib/activity.ts:708-710,781-782` — `activityHref` has `case 'dispute'` twice. The first returns `null` when there is no id. The second, which can never be reached, would fall back to the existing `/disputes` list (app/disputes.tsx exists). Switching to the fallback would change navigation, so I left it. If the fallback is intended, delete the first clause.
- `artifacts/mobile/lib/activity.ts:745-747,751-753` — `case 'live_cohost'` appears twice with identical bodies. It is harmless dead code; I left it because the brief requires a failing test for every change and removing it cannot be tested.
- `artifacts/mobile/lib/accountService.ts:11-15` — the deactivation, deletion and export keys are device-wide, not account-scoped. Today only `getDeactivationStatus`/`reactivate` (app/(buyer)/_layout.tsx) and `clearAccountLifecycleState` (delete-account) use them, and nothing writes the deactivation flag any more, so nothing visibly breaks. Left alone.
- `artifacts/mobile/lib/analyticsSummary.ts:37` — `visits.toLocaleString()` uses the device locale while `formatCents` uses its own format. That may be deliberate localisation, so I left it.

## Cross-chunk defects (not fixed)
- None found. crosschunk.md has no entries for files in this chunk.

## Test files touched / created
- Created `artifacts/mobile/lib/accountSettings.audit.test.ts`
- Created `artifacts/mobile/lib/ageGate.audit.test.tsx`
- Created `artifacts/mobile/lib/aiCreditsError.audit.test.ts`
- Created `artifacts/mobile/lib/animationUtils.audit.test.ts`
- Verified passing afterwards: all 18 chunk test files, plus tests/account-settings-sync.test.ts, tests/adjustments-tool.test.ts, services/aiService.test.ts and the lib tests that import lib/api.ts. The only failure was lib/sellerPaymentStatusCache.test.ts "does not cache failed requests" (5s timeout), which is on the baseline failing list and is not in this chunk.
- A scoped tsc grep over the 5 changed source files showed no errors.
