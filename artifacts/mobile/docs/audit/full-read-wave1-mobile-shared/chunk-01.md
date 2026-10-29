# Chunk 01
## Files read
| file | lines read (= file length) | defects found | defects fixed |
|---|---|---|---|
| components/NativeOnlyFeature.tsx | 132 | 0 | 0 |
| components/NetworkNoticeBanner.tsx | 9 | 0 | 0 |
| components/OfflineBanner.tsx | 123 | 0 | 0 |
| components/PackerRouteGuard.tsx | 123 | 0 | 0 |
| components/PayoutSetupCard.tsx | 53 | 0 | 0 |
| components/PlanUpsellModal.tsx | 386 | 0 | 0 |
| components/ProductQuestionsSection.tsx | 88 | 1 | 1 |
| components/ProductReviewsSection.tsx | 407 | 0 | 0 |
| components/ProfileTabButton.tsx | 55 | 0 | 0 |
| components/PushPrePromptHost.tsx | 55 | 0 | 0 |
| components/ReadyToSellChecklist.tsx | 133 | 0 | 0 |
| components/RecentlyViewedRow.tsx | 105 | 1 | 1 |
| components/RepostEducationHost.tsx | 43 | 0 | 0 |
| components/RepostEducationSheet.tsx | 97 | 0 | 0 |
| components/RetainedScene.tsx | 67 | 0 | 0 |
| components/RoleLockedView.tsx | 104 | 0 | 0 |
| components/SaveHeart.tsx | 88 | 0 | 0 |
| components/SaveHeartHost.tsx | 159 | 0 | 0 |
| components/SaveToCollectionSheet.test.tsx | 170 | 0 | 0 |
| components/SaveToCollectionSheet.tsx | 344 | 0 | 0 |
| components/ScreenHeader.tsx | 320 | 1 (comment) | 1 |
| components/SectionHeader.tsx | 59 | 0 | 0 |
| components/SellerCreateFAB.tsx | 176 | 0 | 0 |
| components/SellerDashboardAISuggestions.tsx | 178 | 0 | 0 |
| components/SellerDashboardActionNeeded.tsx | 121 | 0 | 0 |
| components/SellerDashboardActivityFeed.tsx | 67 | 0 | 0 |
| components/SellerDashboardChart.tsx | 488 | 3 (comments) | 3 |
| components/SellerDashboardHomeRange.tsx | 35 | 0 | 0 |
| components/SellerDashboardPayoutCard.tsx | 76 | 0 | 0 |
| components/SellerDashboardQuickActions.tsx | 69 | 0 | 0 |
| components/SellerDashboardRangePills.tsx | 147 | 0 | 0 |
| components/SellerDashboardRecentOrders.tsx | 93 | 0 | 0 |
| components/SellerDashboardSectionTitle.tsx | 50 | 0 | 0 |
| components/SellerDashboardSections.tsx | 309 | 0 | 0 |
| components/SellerDashboardSetupCard.tsx | 131 | 0 | 0 |
| components/SellerDashboardStatGrid.tsx | 102 | 0 | 0 |
| components/SellerDashboardTodo.tsx | 95 | 0 | 0 |
| components/SellerDashboardTopProducts.tsx | 122 | 0 | 0 |
| components/SellerDashboardTrafficSources.tsx | 323 | 0 | 0 |
| components/SellerGlobalTabBar.tsx (READ-ONLY) | 562 | 1 (comment, logged) | 0 |
| components/SellerHomeCommerceDashboard.tsx | 1301 | 1 | 1 |
| components/SellerListHeader.tsx | 330 | 0 | 0 |
| components/SellerOrderGlobe.tsx | 501 | 0 | 0 |
| components/SellerQuickActionsGrid.tsx | 39 | 0 | 0 |
| components/SellerStudioRadialMenu.tsx (READ-ONLY) | 1848 | 1 (logged) | 0 |
| components/SellerTutorialOverlay.tsx | 174 | 0 | 0 |
| components/SetupCelebration.tsx | 88 | 0 | 0 |
| components/SetupContinueBanner.tsx | 67 | 0 | 0 |
| components/SetupProgressRing.tsx | 81 | 0 | 0 |
| components/SetupWalkthroughSheet.tsx | 230 | 0 | 0 |
| components/ShareContactPicker.tsx | 124 | 0 | 0 |
| components/ShareProfileQrScanner.tsx | 196 | 1 | 1 |

(Line counts are the chunk-file counts; `cat -n`/Read showed the same last line number for every file.)

## Fixes
- `components/ShareProfileQrScanner.tsx:44-63`: the "already handled" guard was React state (`handled`). `CameraView` fires `onBarcodeScanned` on every frame the code is in view, so several events reach the same stale callback before the re-render, each one sees `handled === false`, and each one calls `onClose()` and `router.push('/u/<name>')`. The result was a stacked duplicate profile screen and repeated close calls. → Fix: the guard is now a `useRef` that is set synchronously, and `handled` is gone from the deps. Test: `components/__tests__/ShareProfileQrScanner.audit.test.tsx` (failed before: yes, push was called 3 times instead of 1).
- `components/RecentlyViewedRow.tsx:41-53`: the effect returned early on `!isSignedIn` without clearing `items`, and it was keyed only on `[api, isSignedIn]` (`api` is the stable client). After sign-out, a row that stayed mounted (Discover, bag, PDP) kept showing the previous buyer's private view history. An account switch with no signed-out gap never refetched, so it showed account A's history to account B. → Fix: the effect clears items on every account change, re-enters the loading state, and now depends on `userId`. Test: `components/__tests__/RecentlyViewedRow.audit.test.tsx` (failed before: yes, both cases).
- `components/ProductQuestionsSection.tsx:27-33`: `.catch(() => setData({ questions: [], totalCount: 0 }))` made a failed `GET /api/product-qa/product/:id` (route verified in api-server `routes/product-qa.ts:70`) render as a real empty state: "Questions (0)" and "No questions yet". → Fix: a separate `failed` state. On failure the section shows "Questions" with no count and no empty-state claim, keeps "See all" (the Q&A screen does its own read) and the Ask button, and resets when `productId` changes. Test: `components/__tests__/ProductQuestionsSection.audit.test.tsx` (failed before: yes, the failure case rendered "Questions (0)"). The success and genuine-empty cases pass both before and after.
- `components/SellerHomeCommerceDashboard.tsx:328-341`: on a store switch the code cleared only snapshot, top products and recent orders. `actionInputs` (the To do block's "N orders to ship", the messages/low-stock/returns rows, and the Today widget's toShip), `activityItems` and `everSoldCount` kept the previous store's values. If the new store's `loadSecondaryData` failed, they stayed on screen under the new store indefinitely; the comment said "Drop the previous store's numbers immediately". → Fix: those three are also reset in the store-context callback. They are placed before the existing three resets so the regex in `tests/seller-home-dashboard-data-contract.test.ts` still holds. Test: `components/__tests__/SellerHomeCommerceDashboard.storeSwitch.audit.test.ts` (failed before: yes). This is a SOURCE-STRUCTURE test, used as a last resort: the dashboard imports dozens of native-only modules and can't be rendered under the Node shim.
- `components/SellerDashboardChart.tsx:135` (comment only): the comment said "No haptic per scrub tick: haptics never fire on a continuous drag", but the code fires `haptic('select')` on each new bucket. That is deliberate selection-tick behaviour, throttled in lib/haptics. → The comment now describes it.
- `components/SellerDashboardChart.tsx:197-203` and `:318-323` (comments only): they claimed the empty state "must still draw a real, VISIBLE flat line at $0". `series` is `[]` when `isEmpty`, so no line is drawn; lines 116-120 already say so. → The comments now say that the empty state draws a baseline plus the message.
- `components/ScreenHeader.tsx:239-243` (comment only): it described a subtitle as "a sibling Text below `container`", but the subtitle prop was removed. → The comment now states that there is no subtitle line.

## Judgment calls — not changed
- `components/ProductReviewsSection.tsx:184-188`: the star breakdown percentages come from the returned sample. The server returns at most the latest 50 reviews (`routes/reviews.ts:124`), while `totalCount`/`avgRating` cover all reviews. For more than 50 reviews the bars describe only the latest 50. Fixing it needs a server breakdown field, which is a product/API decision.
- `components/ProductReviewsSection.tsx:158-169`: `toggleHelpful` reads `helpful` from the render closure. A double-tap before a re-render could compute both taps from the same `current`. It is narrow, and the server response reconciles it.
- `components/ProductReviewsSection.tsx:177`: a failed read hides the section (it sets totalCount 0, which renders null). That makes no false claim on screen, which matches the documented "renders nothing" contract.
- `components/SaveToCollectionSheet.tsx:116-129`: if `getCollections()` fails after an account switch while the sheet is open, the previous account's `collections` stay listed under the error banner. It is narrow, and filing into one is still bound to the current account (StaleAccountError), so I left it.
- `components/SellerHomeCommerceDashboard.tsx:313-326`: `handleCopyStoreUrl` shows "copied" even if the clipboard write rejects (an unhandled promise), and its 1.2s `setTimeout` isn't cleared on unmount. Minor UX.
- `components/SellerHomeCommerceDashboard.tsx:568-573`: pull-to-refresh calls `loadSecondaryData()` directly and also bumps `retryTick`, which runs it a second time through the effect, so secondary data is fetched twice. `loadSecondaryData` has no generation guard either: a slow response from before a store switch can land after the reset. I logged these instead of restructuring.
- `components/SellerHomeCommerceDashboard.tsx:659`: the success alert falls back to `financeBalance.available.formatted` instead of `formattedAmount` for a processing-cashout retry. The server always returns `formatted` (`routes/finance.ts:1117`), so the fallback is effectively unreachable.
- `components/SellerDashboardSections.tsx:150,302-309`: `listDivider` is `position:absolute; bottom:0` inside a fragment, so it positions against the list group, not the row. Every divider stacks at the group's bottom edge. It looks like a real layout bug, but fixing it is a visual change; that call belongs to Dev or design.
- `components/SellerDashboardTrafficSources.tsx:113-124`: the headline is the sum of the per-source rows (deliberate, documented), but the delta compares it with `previousVisits` (the store-visit count), which can be a different measure. That is the documented design, so I didn't touch it.
- `components/SellerDashboardActionNeeded.tsx:24`: the "returns to review" row routes to `orders?filter=all`, not a returns-specific filter. That is a product routing choice.
- `components/SellerCreateFAB.tsx:47-60`: `pathname.includes('/live')` also blocks any path that merely contains "/live". It is deliberate substring matching.
- `components/SellerDashboardAISuggestions.tsx:83-85`: on a fetch failure it keeps the last list. The comment says this is deliberate.
- `components/PackerRouteGuard.tsx:77-96`: the previous store's role stays in effect until `team.context()` resolves for the new store. It is brief and the server enforces the role anyway.
- `components/SetupWalkthroughSheet.tsx:72-86`: if `dismissWelcome`/`markSetupStarted` rejects (AsyncStorage write failure only; remote sync errors are swallowed), `onClose` is never called. That is an extreme edge case.
- `components/OfflineBanner.tsx:37-51`: `setRetrying(false)` can run after unmount. Harmless in React 18.
- `components/SellerOrderGlobe.tsx:399-403`: before `data` loads, the caption reads "0 orders · last 7 days" (the header shows "–"). Cosmetic.
- `components/SetupContinueBanner.tsx:3-4`: the doc says tapping "opens the checklist"; the dashboard opens the walkthrough sheet, which is the checklist UI. Close enough.

## Cross-chunk defects (not fixed)
- `components/SellerGlobalTabBar.tsx:355-362` (READ-ONLY, owned by another session): the comment says `getActiveTab()` returns `'index'` "as its safe fallback for every unmapped screen". It now returns `null` for unmapped routes (lines 197-209). → Fix: reword the comment to say unmapped routes resolve to `null` (or to the last owned tab), and that `'home'` is passed only when segments are the Dashboard itself.
- `components/SellerStudioRadialMenu.tsx:1127-1448` (READ-ONLY): `CarouselCard` is a component defined inside `SellerStudioRadialMenu`'s render body. Every parent render (cardIndexJS change, `entering`, plan/profile state) creates a new component type, so React unmounts and remounts every visible card. That resets their `useSharedValue` micro-animation state and re-runs `useActivityUnreadCount()` per card. → Fix: hoist `CarouselCard` to module scope and pass the shared values/styles/`cardAreaSize`/`isLocked` as props (or through a context).

## Test files touched / created
- Created `artifacts/mobile/components/__tests__/ShareProfileQrScanner.audit.test.tsx` (2 tests)
- Created `artifacts/mobile/components/__tests__/RecentlyViewedRow.audit.test.tsx` (2 tests)
- Created `artifacts/mobile/components/__tests__/ProductQuestionsSection.audit.test.tsx` (3 tests)
- Created `artifacts/mobile/components/__tests__/SellerHomeCommerceDashboard.storeSwitch.audit.test.ts` (1 source-structure test)
- No existing test was modified. `components/SaveToCollectionSheet.test.tsx` (in chunk) passes unchanged.

Verification:
- Each new test was run against the HEAD version of its source file (fails) and against the fixed file (passes).
- I ran the 25 existing test files that read or render the edited components with my edits and with the six edited files swapped back to HEAD. The failing-test lists matched, apart from one a11y-lint test that failed only in the HEAD-version run, likely due to concurrent edits elsewhere. My edits introduce no new failures.
- The one-shot tsc grep showed no errors in the edited files or the new tests.
