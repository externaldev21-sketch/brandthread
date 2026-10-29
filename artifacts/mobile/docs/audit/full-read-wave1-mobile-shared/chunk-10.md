# Chunk 10
## Files read
| file | lines read (= file length) | defects found | defects fixed |
|---|---|---|---|
| artifacts/mobile/components/social/CaptionText.tsx | 86 | 0 | 0 |
| artifacts/mobile/components/social/CaptionsOverlay.tsx | 43 | 0 | 0 |
| artifacts/mobile/components/social/CenteredToast.tsx | 15 | 0 | 0 |
| artifacts/mobile/components/social/CreateButton.tsx | 73 | 0 | 0 |
| artifacts/mobile/components/social/FollowButton.tsx | 183 | 0 | 0 |
| artifacts/mobile/components/social/LocationPicker.tsx | 246 | 1 | 1 |
| artifacts/mobile/components/social/LocationTag.tsx | 41 | 0 | 0 |
| artifacts/mobile/components/social/MentionText.tsx | 41 | 0 | 0 |
| artifacts/mobile/components/social/NoteComposerSheet.tsx | 343 | 0 | 0 |
| artifacts/mobile/components/social/PollCard.tsx | 119 | 0 | 0 |
| artifacts/mobile/components/social/PostCarousel.tsx | 107 | 0 | 0 |
| artifacts/mobile/components/social/PostFits.tsx | 150 | 0 | 0 |
| artifacts/mobile/components/social/PostGrid.tsx | 119 | 0 | 0 |
| artifacts/mobile/components/social/PostOwnerSheet.tsx | 62 | 0 | 0 |
| artifacts/mobile/components/social/QuotedPostCard.tsx | 105 | 1 | 1 |
| artifacts/mobile/components/social/RemoveFollowerSheet.tsx | 113 | 0 | 0 |
| artifacts/mobile/components/social/StoryGestureGuide.tsx | 174 | 0 | 0 |
| artifacts/mobile/components/social/StoryQuestionResponsesSheet.tsx | 74 | 0 | 0 |
| artifacts/mobile/components/social/StoryStickerComposer.tsx | 202 | 0 | 0 |
| artifacts/mobile/components/social/StoryStickers.tsx | 448 | 1 (cross-chunk root cause) | 0 |
| artifacts/mobile/components/splash/AppIntroSplash.tsx | 363 | 0 | 0 |
| artifacts/mobile/components/states/MissingItemState.tsx | 67 | 0 | 0 |
| artifacts/mobile/components/store-setup/StoreSetupField.tsx | 64 | 0 | 0 |
| artifacts/mobile/components/store-setup/StoreSetupScreen.tsx | 56 | 0 | 0 |
| artifacts/mobile/components/store/ShareStoreSheet.tsx | 274 | 0 | 0 |
| artifacts/mobile/components/store/ShareStoreSheetHost.tsx | 20 | 0 | 0 |
| artifacts/mobile/components/store/ShipDateSheet.tsx | 91 | 0 | 0 |
| artifacts/mobile/components/store/SortableList.tsx | 96 | 0 | 0 |
| artifacts/mobile/components/store/StoreSheet.tsx | 74 | 0 | 0 |
| artifacts/mobile/components/store/StoreSitePreview.tsx | 264 | 0 | 0 |
| artifacts/mobile/components/tab-bar/HoldRing.tsx | 92 | 0 | 0 |
| artifacts/mobile/components/tab-bar/TabBarParts.tsx | 800 | 0 | 0 |
| artifacts/mobile/components/tab-bar/pillGlide.ts | 55 | 0 | 0 |
| artifacts/mobile/components/tab-bar/useHoldToSwitch.ts | 95 | 0 | 0 |
| artifacts/mobile/components/thread-cash/CashOutSheet.tsx | 197 | 0 | 0 |
| artifacts/mobile/components/thread-cash/CelebrationHost.tsx | 172 | 2 | 2 |
| artifacts/mobile/components/thread-cash/ChatAttachThreadCash.tsx | 675 | 2 | 2 |
| artifacts/mobile/components/thread-cash/SellerThreadCashCard.tsx | 176 | 1 | 1 |
| artifacts/mobile/components/thread-cash/ThreadCashActiveTimeTracker.tsx | 182 | 1 | 1 |
| artifacts/mobile/components/thread-cash/ThreadCashBill.tsx | 127 | 0 | 0 |
| artifacts/mobile/components/thread-cash/ThreadCashStreakRow.tsx | 135 | 0 | 0 |
| artifacts/mobile/components/thread-cash/UseThreadCashCard.tsx | 156 | 0 | 0 |
| artifacts/mobile/components/thread-cash/WeeklyQuestsSection.tsx | 248 | 0 | 0 |
| artifacts/mobile/components/translation/CaptionTranslation.tsx | 122 | 1 | 1 |
| artifacts/mobile/components/translation/__tests__/CaptionTranslation.test.tsx | 73 | 0 | 0 |

## Fixes
- `components/translation/CaptionTranslation.tsx:50-66`: stale-response overwrite. `fetchTranslation` set `result` for whatever caption it was started for, even after `source`/`target` changed. CaptionBlock uses this hook in recycled feed rows (FlashList), so this could happen: the row starts auto-translating caption A, gets recycled to caption B, then A's translation arrives and B's row shows A's translated text. Fix: a `currentKey` ref (target + source). A response or error whose key is no longer current is dropped. Test: `components/translation/__tests__/CaptionTranslation.audit.test.tsx` (failed before: yes, showed "Hello friends (A)" under caption B). The existing CaptionTranslation.test.tsx still passes.
- `components/social/LocationPicker.tsx:79-87`: a cleared search showed stale results. The request sequence number only went up when a new non-empty query started. Example: type "Paris", the request goes out, clear the field, the response arrives. `id === seq.current` still held, so the Paris results came back under an empty search box. Fix: bump `seq` at the top of every effect run, including the empty-query and preview branches. Test: `components/social/__tests__/LocationPicker.audit.test.tsx` (failed before: yes, 2 result rows rendered after clearing).
- `components/thread-cash/CelebrationHost.tsx:147`: a second "Thread Cash received" toast was cut short or never seen. `<BurstToast>` had no key, so a second `celebrateThreadCash` while one toast was up reused the same instance. Its mount-only effect kept the first event's 1400ms timer, so the second payment's toast faded out with the first's timer (after 400ms if it arrived at 1000ms; at once if it arrived mid-fade). Fix: `key={toast.id}` gives each event a fresh mount and full hold. `onDone` now clears only its own event (`current?.id === toast.id`), so a late fade callback from an earlier toast can't hide a newer one. Test: `components/thread-cash/__tests__/CelebrationHost.audit.test.tsx` (failed before: yes, 0 toasts showing 500ms after the second payment).
- `components/thread-cash/CelebrationHost.tsx:10`: the header comment said the toast plays "with a success haptic", but the file plays no haptic. Fixed the comment (comment-only, no test).
- `components/thread-cash/ChatAttachThreadCash.tsx:390-392`: the comment said "the success haptic already fired the moment the transfer was confirmed (see handleSend above)", but handleSend fires no haptic. Fixed the comment to say what the code does (comment-only, no test). I did not add a haptic: removing it may have been deliberate (one-haptic-per-action cleanup).
- `components/thread-cash/SellerThreadCashCard.tsx:10-11`: the header said "Purely presentational", but the card makes its own GET /thread-cash/quote request. Fixed the comment (comment-only, no test).

- `components/thread-cash/ThreadCashActiveTimeTracker.tsx:66-165`: cross-account active-time leak (fixed at the lead's request; the failing-first test reproduces it). `dayStateRef` and `tickCountRef` carried over across `userId` changes. If the app returned to the foreground before account B's stored day loaded, ticks added to account A's state and persisted it under B's key: the test saw 20s written under B, with 10s of it A's. In-flight async ticks also never re-checked `active` after their awaits. Fix: reset `dayStateRef`/`tickCountRef` at effect start, `if (!active) return` after each await in the tick, and the initial load no longer overwrites a state a tick already loaded. Test: `components/thread-cash/__tests__/ThreadCashActiveTimeTracker.audit.test.tsx` (failed before: yes, "expected 20 to be <= 10").
- `components/thread-cash/ChatAttachThreadCash.tsx:167-180,294-306`: a completed transfer lost its chat bubble if the component unmounted during the 1.15s "sent" hold. The cleanup cleared the timer, so `onSent` never ran. The server only records `conversationId`; it does not post the message. Fix: a `pendingSent` ref is set when the hold starts. The timer flushes it once; an unmount flushes it through `onSentRef` instead of dropping it. Test: `components/thread-cash/__tests__/ChatAttachThreadCash.audit.test.tsx` (unmount mid-hold case failed before: yes, onSent called 0 times; the companion case checks exactly-once on the normal path).
- `components/social/QuotedPostCard.tsx:42`: `thumbFailed` stuck after one failed load. It was a boolean, so once any thumbnail failed, a later different `thumbnailUrl` on the same instance was never tried. Fix: remember the failed URL and compare it with the current one. Test: `components/social/__tests__/QuotedPostCard.audit.test.tsx` (failed before: yes).

## Judgment calls — not changed
- `components/thread-cash/CashOutSheet.tsx:85` and `SellerThreadCashCard.tsx:60`: when the quote request fails, the code falls back to a 1:1 quote with no fee ("You'll receive $X"). That matches the server today (`THREAD_CASH_CASH_OUT_RATE_BPS=10000`, `FEE_BPS=0`), so the UI is correct now. It would show the wrong amount if Dev turns on a fee, which contradicts the header's "never hardcoded" promise. Left as is because it shows correct data today.
- `components/social/PostFits.tsx:68,82`: "Remove product" and "Withdraw repost request" use `.catch(() => {})`. A failure gives no feedback, but the UI keeps showing the true state (product still tagged / request still pending), so nothing false is displayed. Adding an error sheet would be a UX change.
- `components/thread-cash/UseThreadCashCard.tsx:107`: the local balance subtracts `proposedCents` instead of `result.discountCents`. The two are equal today (wallet.ts returns `discountCents: amountCents`).
- `components/store/ShipDateSheet.tsx:24`: the calendar cursor is set once at mount and does not follow a later `value` change while the sheet stays mounted. This is UX, not wrong data.
- `components/tab-bar/TabBarParts.tsx:588`: the web `afterGlide` `setTimeout(navigate, wait)` is never cleared on unmount. It is at most 140ms and the tab bar effectively never unmounts.
- `components/social/StoryQuestionResponsesSheet.tsx:43`: rows are keyed by `a.userId`, which assumes one answer per user per question. I didn't verify this against the server.

## Cross-chunk defects (not fixed)
- `components/social/StoryStickers.tsx:210-212` (`useCountdown`): root cause is in the story data service, outside this chunk. The hook computes the clock offset as `serverNow - Date.now()` when the sticker mounts. `story.stickerState.serverNow` is a snapshot from when the stories were fetched, so a story opened N seconds after the fetch shows a countdown N seconds too long. Proposed fix: wherever `stickerState` is received (the story fetch in `services/` / the story viewer data hook), stamp `receivedAt = Date.now()` next to `serverNow`. Pass it through `ViewerStickerLayer` → `CountdownSticker` → `useCountdown`, and compute `offset = serverNow - receivedAt` (same pattern as `lib/live/liveAuction.ts` `auctionRemainingMs(a, receivedAtMs, nowMs)`).

## Test files touched / created
- created `artifacts/mobile/components/translation/__tests__/CaptionTranslation.audit.test.tsx`
- created `artifacts/mobile/components/social/__tests__/LocationPicker.audit.test.tsx`
- created `artifacts/mobile/components/thread-cash/__tests__/CelebrationHost.audit.test.tsx`
- created `artifacts/mobile/components/thread-cash/__tests__/ChatAttachThreadCash.audit.test.tsx`
- created `artifacts/mobile/components/thread-cash/__tests__/ThreadCashActiveTimeTracker.audit.test.tsx`
- created `artifacts/mobile/components/social/__tests__/QuotedPostCard.audit.test.tsx`
- Re-run after the follow-up fixes: all 8 test files in components/thread-cash/__tests__, components/social/__tests__ and components/translation/__tests__, plus tests/story-stickers.test.ts. 20 tests, all pass.
- Ran: those 3, plus the existing `components/translation/__tests__/CaptionTranslation.test.tsx` and `tests/story-stickers.test.ts`, all pass. `tests/haptics-map-audit.test.ts` fails for files outside this chunk only; none of its failures are in chunk-10 files. tsc not run (no type changes).
