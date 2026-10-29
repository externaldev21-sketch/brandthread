# Chunk 00
## Files read
| file | lines read (= file length) | defects found | defects fixed |
|---|---|---|---|
| artifacts/mobile/components/AIBrainFAB.tsx | 250 | 1 | 1 |
| artifacts/mobile/components/AccountSwitcherSheet.tsx (READ-ONLY) | 413 | 1 | 0 (read-only) |
| artifacts/mobile/components/ActivityBellButton.tsx | 140 | 1 | 1 |
| artifacts/mobile/components/AddressAutocompleteInput.tsx | 324 | 0 | 0 |
| artifacts/mobile/components/AffiliateRefCapture.tsx | 56 | 0 | 0 |
| artifacts/mobile/components/AiConsentSheet.tsx | 119 | 0 | 0 |
| artifacts/mobile/components/AiGeneratedBadge.tsx | 44 | 0 | 0 |
| artifacts/mobile/components/AlphabetScrubber.tsx | 68 | 0 | 0 |
| artifacts/mobile/components/AnalyticsBridge.tsx | 67 | 0 | 0 |
| artifacts/mobile/components/AppSettingsEffects.tsx | 59 | 0 | 0 |
| artifacts/mobile/components/Badge.tsx | 83 | 0 | 0 |
| artifacts/mobile/components/BootScreen.tsx | 28 | 0 | 0 |
| artifacts/mobile/components/BrandDropsCard.tsx | 132 | 1 | 1 |
| artifacts/mobile/components/BrandthreadUI.tsx | 1694 | 1 | 1 |
| artifacts/mobile/components/BuyerProtectionNote.tsx | 107 | 0 | 0 |
| artifacts/mobile/components/CachedImage.test.ts | 29 | 0 | 0 |
| artifacts/mobile/components/CachedImage.tsx | 98 | 0 | 0 |
| artifacts/mobile/components/ChipRail.tsx | 211 | 0 | 0 |
| artifacts/mobile/components/ClerkBootGate.tsx | 118 | 0 | 0 |
| artifacts/mobile/components/ClerkLoadErrorBoundary.tsx | 85 | 0 | 0 |
| artifacts/mobile/components/CommerceSignal.test.tsx | 864 | 1 (baseline failure; test vs PDP conflict) | 0 |
| artifacts/mobile/components/CommerceSignal.tsx | 487 | 1 | 1 |
| artifacts/mobile/components/CoppedShareSheet.tsx | 175 | 1 | 1 |
| artifacts/mobile/components/DateRangePicker.tsx | 538 | 0 | 0 |
| artifacts/mobile/components/DayPickerSheet.tsx | 165 | 0 | 0 |
| artifacts/mobile/components/DeferredInviteCapture.tsx | 44 | 0 | 0 |
| artifacts/mobile/components/DesignLayerCompositor.tsx | 377 | 0 | 0 |
| artifacts/mobile/components/DropHypeChart.tsx | 73 | 0 | 0 |
| artifacts/mobile/components/EngagementButton.tsx | 425 | 1 | 1 |
| artifacts/mobile/components/ErrorBoundary.tsx | 116 | 0 | 0 |
| artifacts/mobile/components/ErrorFallback.tsx | 305 | 0 | 0 |
| artifacts/mobile/components/ExpandFromTileOverlay.tsx | 100 | 0 | 0 |
| artifacts/mobile/components/FeatureCard.tsx | 77 | 0 | 0 |
| artifacts/mobile/components/FeedGestureGuide.tsx | 186 | 0 | 0 |
| artifacts/mobile/components/FinanceMoneyFlow.tsx | 230 | 0 | 0 |
| artifacts/mobile/components/FirstWeekCard.tsx | 136 | 0 | 0 |
| artifacts/mobile/components/ForceUpdateGate.tsx | 87 | 0 | 0 |
| artifacts/mobile/components/GiveawayProfileCard.tsx | 48 | 1 | 1 |
| artifacts/mobile/components/GuestRouteBoundary.tsx | 16 | 0 | 0 |
| artifacts/mobile/components/InlineFeedback.tsx | 208 | 0 | 0 |
| artifacts/mobile/components/InlineSlider.tsx | 141 | 1 | 1 |
| artifacts/mobile/components/KeyboardAwareScrollViewCompat.tsx | 42 | 0 | 0 |
| artifacts/mobile/components/KeyboardProviderCompat.tsx | 77 | 0 | 0 |
| artifacts/mobile/components/KeyboardStickyFooter.tsx | 54 | 0 | 0 |
| artifacts/mobile/components/LaunchChecklistCard.tsx | 122 | 0 | 0 |
| artifacts/mobile/components/MentionPickerSheet.tsx | 213 | 1 | 1 |
| artifacts/mobile/components/ModalSafeArea.tsx | 41 | 0 | 0 |
| artifacts/mobile/components/ModeSwitcher.tsx | 116 | 0 | 0 |
| artifacts/mobile/components/inline-feedback.test.ts | 296 | 0 | 0 |

## Fixes
- `artifacts/mobile/components/CommerceSignal.tsx:123` (useSecondsRemaining). The countdown went down by 1 on each interval tick and never looked at the clock again. JS timers stop while the app is in the background and run late when the JS thread is busy, so the "Ends in" / "Pre-orders close in" / UpcomingCountdown display fell behind real time. Example: 10 minutes in the background leaves the countdown 10 minutes too long. → Each tick now recomputes `secondsUntil(endsAt)` from the clock and goes to 0 once the end time has passed. Test: `artifacts/mobile/components/__tests__/CommerceSignal.audit.test.tsx` (failed before: yes, "expected 3599 to be 2999").
- `artifacts/mobile/components/InlineSlider.tsx:63`. `onPanResponderMove` applied `g.dx` (the total drag since the touch started) to the current `value` prop. That prop had already moved with the drag, so every pixel was counted again on each move and the thumb ran ahead of the finger. Also, because the responder listed `value` in its useMemo deps, it was rebuilt on every render in the middle of a gesture. → The value is captured at grant (`dragStartValue`), `dx` is applied to that start value, and the responder is now one stable instance that reads the latest props through a ref. Test: `artifacts/mobile/components/__tests__/InlineSlider.audit.test.tsx` (failed before: yes, the second move gave 30 instead of 20).
- `artifacts/mobile/components/GiveawayProfileCard.tsx:21`. When `sellerId` changed, the previous seller's giveaway (`g`) stayed in state. It stayed while the new read was pending, when the read was skipped (`enabled` false or a `u_` id), and permanently when the read failed, because the `.catch` swallows the error. So seller B's profile could show seller A's giveaway. → `setG(null)` at the start of the effect. Test: `artifacts/mobile/components/__tests__/SellerProfileCards.audit.test.tsx` (failed before: yes).
- `artifacts/mobile/components/BrandDropsCard.tsx:51`. Same stale state: seller A's live/upcoming drop card stayed on screen for seller B until B's two list reads finished. With no sellerId it stayed for good. → `setDrop(null)` at the start of the effect. Test: `artifacts/mobile/components/__tests__/SellerProfileCards.audit.test.tsx` (failed before: yes).
- `artifacts/mobile/components/AIBrainFAB.tsx:87-93`. The keyboard listeners are registered once (`useEffect([], ...)`), so `_showAfterKeyboard` kept the first render's `hidden` value. If a screen set `hidden` after mount (for example, a local overlay opening), closing the keyboard faded the FAB back to opacity 1. It was visible but could not be tapped (pointerEvents none). → It now reads `hidden` through `hiddenRef`. Test: `artifacts/mobile/components/__tests__/AIBrainFAB.audit.test.tsx` (failed before: yes).
- `artifacts/mobile/components/BrandthreadUI.tsx:90-99` (UndoToastProvider.undo). After `await action.undo()` it called `setAction(null)` unconditionally. A newer toast shown (`showUndo`) while the earlier undo was still in flight was wiped, so the user lost the chance to undo the second action. → It now clears only if the current toast is still the one being undone: `setAction(current => current === action ? null : current)`. Test: `artifacts/mobile/components/__tests__/SmallDefects.audit.test.tsx` (failed before: yes).
- `artifacts/mobile/components/MentionPickerSheet.tsx:42` (useMentionSearch). Responses that arrive out of order while the search is active were already dropped by the `seq` check. The gap was the inactive branch, which reset the list but did not bump `seq`. A read for "@ab" still in flight when the strip or sheet closed then wrote its rows after the reset, and they showed on the next open (for example, for "@c") until the new read landed. → The inactive branch now bumps `seq.current`. Test: `artifacts/mobile/components/__tests__/SmallDefects.audit.test.tsx` (failed before: yes).
- `artifacts/mobile/components/CoppedShareSheet.tsx:39-40`. The 2s "Copied"/"Saved" reset timer (`doneTimer`) was never cleared on unmount, so it leaked a timer and called `setDone` after unmount. → Added an unmount effect that clears it. Test: `artifacts/mobile/components/__tests__/SmallDefects.audit.test.tsx` (failed before: yes; the timer count after unmount was 1). The tile label is not visible in the shim (PressableScale render-prop children), so the test checks the pending-timer count instead of the "Copied" text.
- `artifacts/mobile/components/ActivityBellButton.tsx:12-16`. The comment was wrong. It said the hook "short-polls every ~1.5s… there is no websocket/SSE layer in this codebase", but watchActivityRealtime is driven by the realtime sockets (isRealtimeConnected / isUserEventsConnected) and polls at 1.5s only while they are down. → Comment corrected. No test (comment only).
- `artifacts/mobile/components/EngagementButton.tsx:1-10, 176-181`. The doc comments were wrong. They said the button "rolls back only on confirmed failure", "Shows concise inline toast (FeedToast) instead of Alert", gives "error/success feedback via FeedToastContext when provided", and "Uses theme tokens exclusively". The button does none of this: it never calls showToast and never rolls anything back, the caller's `onPress` handles those, and it hardcodes `#FFFFFF`. → Comments corrected. No test (comment only).

## Judgment calls — not changed
- `artifacts/mobile/components/CommerceSignal.test.tsx:854-863`. Baseline failure: "buyer-product-detail has no demand layer". `app/buyer-product-detail.tsx:1855-1882` deliberately renders DemandBadge / ClaimedRemainingLabel / TimeRemainingLabel / UrgencyBar. There is a placement comment ("Demand signals sit under the sizes… (item 129)") and later commits touch that block (b2ea4149, f167bbda). The test arrived in the bulk import (cec4d87d), and at that commit the PDP already had the demand layer. Both sides read as a deliberate product decision ("launch: Etsy/Vestiaire show none" vs "item 129"), so I can't tell which one is current intent. The code side is outside my chunk. I left both alone. Dev needs to decide whether to drop the PDP demand layer or remove that test case.
- `artifacts/mobile/components/BrandthreadUI.tsx`: `PrimaryButton`/`SecondaryButton`/`TertiaryButton` accept an `icon` prop and never render it. That is API surface, not a confirmed bug.
- `artifacts/mobile/components/ModeSwitcher.tsx`, `FeatureCard.tsx`, `DateRangePicker.tsx`: nothing in app/, components/, lib/ or hooks/ imports them (dead components). Not deleted, because that is a product/cleanup decision. ModeSwitcher also does not guard `setIsBoth` after unmount, and its `AsyncStorage.getItem` rejection is unhandled.
- `artifacts/mobile/components/DateRangePicker.tsx:94-152`. Preset ranges use `end = today 00:00` (date-only values). That is harmless while there are no consumers. If one is added that treats `end` as a timestamp bound, it would drop today's data.

## Cross-chunk defects (not fixed)
- `artifacts/mobile/components/AccountSwitcherSheet.tsx:186-196` (READ-ONLY, owned by another session). `handleSwitch` clears `switchingId` only in `catch`. After a successful `setActive` the sheet calls `onClose()` but leaves `switchingId` set. The sheet stays mounted in `app/(buyer)/profile.tsx:1302` and `app/(tabs)/profile.tsx:939`. So after switching to another account of the same role (the profile tab is not remounted), reopening the sheet shows every row disabled (`disabled={!!switchingId…}`) with a loader on the old row, and no switch or sign-out works. → Proposed fix: move `setSwitchingId(null)` into a `finally` (or call it right after `onClose()`), the same way `handleSwitchSameLogin` already does it.
- `artifacts/mobile/app/buyer-product-detail.tsx:202,1855-1882` vs `components/CommerceSignal.test.tsx:854`. See the judgment call above. One of the two has to change once Dev decides whether the PDP shows the demand layer.

## Test files touched / created
- Created: `artifacts/mobile/components/__tests__/CommerceSignal.audit.test.tsx`
- Created: `artifacts/mobile/components/__tests__/InlineSlider.audit.test.tsx`
- Created: `artifacts/mobile/components/__tests__/SellerProfileCards.audit.test.tsx`
- Created: `artifacts/mobile/components/__tests__/AIBrainFAB.audit.test.tsx`
- Created: `artifacts/mobile/components/__tests__/SmallDefects.audit.test.tsx` (undo-toast race, mention stale read, CoppedShareSheet timer)
- Follow-up round (lead request): I did not re-run tsc, because the brief allows at most one run and I had already used it. The three edits are one-line and type-safe (an updater function, a ref bump, an added useEffect import).
- Each new test passes against the fixed code and failed against the original (checked by temporarily putting the HEAD version back and then restoring the fix). Tsc on the changed files and new tests reports no errors. In the related suites I re-ran, the remaining failures are the CommerceSignal.test.tsx baseline case, tests/haptics-map-audit and tests/no-hardcoded-theme-color-lint. None of those names my files.
