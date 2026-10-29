# Chunk 06
## Files read
| file | lines read (= file length) | defects found | defects fixed |
|---|---|---|---|
| artifacts/mobile/components/feed/ForYouEmptyShop.tsx | 65 | 0 | 0 |
| artifacts/mobile/components/feed/UploadProgressPill.tsx | 111 | 0 | 0 |
| artifacts/mobile/components/finance/RecoveryPauseCard.tsx | 67 | 0 | 0 |
| artifacts/mobile/components/first-run-tips/AnchoredCardTip.tsx | 131 | 0 | 0 |
| artifacts/mobile/components/first-run-tips/FirstRunTip.tsx | 70 | 0 | 0 |
| artifacts/mobile/components/first-run-tips/FullScreenGuideTip.tsx | 103 | 0 | 0 |
| artifacts/mobile/components/first-run-tips/GestureGlyph.tsx | 94 | 0 | 0 |
| artifacts/mobile/components/first-run-tips/GestureHintTip.tsx | 125 | 0 | 0 |
| artifacts/mobile/components/first-run-tips/SpotlightOverlay.tsx | 132 | 0 | 0 |
| artifacts/mobile/components/first-run-tips/SpotlightTip.tsx | 65 | 0 | 0 |
| artifacts/mobile/components/first-run-tips/TipBubble.tsx | 77 | 0 | 0 |
| artifacts/mobile/components/first-run-tips/tipTargets.ts | 97 | 0 | 0 |
| artifacts/mobile/components/first-run-tips/types.ts | 18 | 0 | 0 |
| artifacts/mobile/components/freelancer/JobNoteSheet.tsx | 122 | 0 | 0 |
| artifacts/mobile/components/giftCards/GiftCardFace.tsx | 55 | 0 | 0 |
| artifacts/mobile/components/globe/FlatOrderMap.tsx (READ-ONLY) | 0 (excluded, owned by another session — not read) | - | - |
| artifacts/mobile/components/globe/GlobeSurface.tsx (READ-ONLY) | 0 (excluded — not read) | - | - |
| artifacts/mobile/components/globe/GlobeSurface.web.tsx (READ-ONLY) | 0 (excluded — not read) | - | - |
| artifacts/mobile/components/globe/OrderGlobePopover.tsx (READ-ONLY) | 0 (excluded — not read) | - | - |
| artifacts/mobile/components/globe/globeColors.ts (READ-ONLY) | 0 (excluded — not read) | - | - |
| artifacts/mobile/components/growth/GrowthUI.tsx | 111 | 1 | 1 |
| artifacts/mobile/components/help/HelpArticleSheet.tsx | 36 | 0 | 0 |
| artifacts/mobile/components/help/HelpLink.tsx | 50 | 0 | 0 |
| artifacts/mobile/components/icons/ArrowUpDownIcon.tsx | 19 | 0 | 0 |
| artifacts/mobile/components/illustrations/EmptyStateArt.tsx | 120 | 0 | 0 |
| artifacts/mobile/components/inbox/ConversationPreview.tsx | 72 | 0 | 0 |
| artifacts/mobile/components/inbox/InboxPillRow.tsx | 87 | 0 | 0 |
| artifacts/mobile/components/inbox/InboxSwipeRow.tsx | 85 | 0 | 0 |
| artifacts/mobile/components/inbox/MessagesInbox.tsx | 2513 | 2 | 2 |
| artifacts/mobile/components/inbox/inboxPillColors.test.ts | 18 | 0 | 0 |
| artifacts/mobile/components/inbox/inboxPillColors.ts | 28 | 0 | 0 |
| artifacts/mobile/components/intl/ApproxPrice.tsx | 35 | 0 | 0 |
| artifacts/mobile/components/layout/EmptyState.tsx | 171 | 1 (comment) | 1 |
| artifacts/mobile/components/layout/EmptyStateBadge.tsx | 139 | 0 | 0 |
| artifacts/mobile/components/layout/Grid.tsx | 46 | 0 | 0 |
| artifacts/mobile/components/layout/Header.tsx | 306 | 0 | 0 |
| artifacts/mobile/components/layout/ResponsiveContainer.tsx | 28 | 0 | 0 |
| artifacts/mobile/components/layout/Screen.tsx | 136 | 0 | 0 |
| artifacts/mobile/components/layout/ScreenChrome.tsx | 139 | 0 | 0 |
| artifacts/mobile/components/layout/Skeleton.tsx | 116 | 0 | 0 |
| artifacts/mobile/components/layout/StickyFooter.tsx | 64 | 0 | 0 |
| artifacts/mobile/components/layout/TabPageHeader.tsx | 104 | 0 | 0 |
| artifacts/mobile/components/layout/emptyStateIcons.ts | 2186 | 0 | 0 |
| artifacts/mobile/components/layout/index.ts | 10 | 0 | 0 |
| artifacts/mobile/components/layout/useBreakpoint.ts | 36 | 0 | 0 |
| artifacts/mobile/components/legal/LegalAcceptanceGate.tsx | 184 | 1 | 1 |
| artifacts/mobile/components/legal/LegalConsent.tsx | 115 | 0 | 0 |
| artifacts/mobile/components/legal/LegalDocument.tsx | 354 | 0 | 0 |
| artifacts/mobile/components/legal/LegalMarkdown.tsx | 92 | 0 | 0 |
| artifacts/mobile/components/listing/ListingRows.tsx | 222 | 0 | 0 |
| artifacts/mobile/components/listing/PhotoStrip.tsx | 143 | 0 | 0 |

(Line counts are the original lengths; edited files grew: MessagesInbox 2522, LegalAcceptanceGate 190, GrowthUI 114, EmptyState 172.)

## Fixes
- `components/inbox/MessagesInbox.tsx:266,378,802,1002` — wrong counterpart. The buyer variant took `participants[0]` as "the other person" for rows, Requests search and the long-press context menu (the seller variant also used `participants[0]` for Requests search and long-press). GET /api/conversations (api-server `routes/conversations.ts` `buildConversationView`) returns every participant, the viewer included, and create inserts the creator first (`routes/conversations.ts` ~l.617), so on any thread the buyer started, the inbox row showed the buyer's OWN name/avatar/live ring. Searching the other person's name missed it, and long-press previewed yourself. Seller Requests search and long-press had the same bug. → Added the exported pure `inboxCounterpart(conv, viewerId)`, which skips the viewer id and the legacy 'me' id and falls back to `participants[0]` for one-participant preview rows. Both variants now use it via `participantOf`. The seller branch's original expression is kept as-is so `tests/seller-messages-parity.test.ts`'s literal string check still passes, and the header comment is updated. Test: `components/inbox/MessagesInbox.audit.test.ts` (failed before: yes — no helper; `getParticipant(conv)` present).
- `components/inbox/MessagesInbox.tsx:616` — the snackbar auto-hide `setTimeout` was never cleared on unmount, so `setSnackbarMessage` ran after unmount. → Added an unmount cleanup effect. Test: `components/inbox/MessagesInbox.audit.test.ts` (source-structure; mounting the whole screen in the vitest shim is impractical) (failed before: yes).
- `components/legal/LegalAcceptanceGate.tsx:44-66,83` — stale-account race. `check()` set gate state after awaiting `/me` with no account guard. On an account switch, A's slow "already agreed" answer could land after B's check and call `setNeedsAgreement(false)`, so account B would skip the legal gate without ever agreeing. A's late "needs agreement" could also wrongly gate B. → `check(isActive)` now ignores results (and skips `acceptLegal` for pending consent) once the effect for that account was cleaned up. Test: `components/legal/__tests__/LegalAcceptanceGate.audit.test.tsx` (failed before: yes, verified by temporarily reverting the guard).
- `components/growth/GrowthUI.tsx:44-58` — CopyRow's 2s reset `setTimeout` was never cleared, so it fired `setState` after unmount. Rapid re-taps also let an older timer flip the check mark back early. → The timer is now held in a ref, cleared on re-tap and on unmount. Test: `components/growth/__tests__/GrowthUI.audit.test.tsx` (failed before: yes, verified by reverting the cleanup).
- `components/layout/EmptyState.tsx:34` — the JSDoc for `compact` claimed it "shrinks the icon circle", but the badge is deliberately the same size everywhere (see the in-body comment). → The comment now says it tightens padding and drops the message. Comment-only, no test.

## Judgment calls — not changed
- `components/inbox/MessagesInbox.tsx:1500` — `isFromMe` (the "You:" prefix) compares `lastMessageSenderId`, but the server never sends `lastMessageSenderId` (it does not appear anywhere in api-server/src). "You:" therefore only ever shows on seeded preview threads, and the seller `=== userId` branch is dead. This is a server/API gap, not fixable in this file.
- `components/inbox/MessagesInbox.tsx:279,1120` — `markReadSafely` is now unused. The comment at 1120 ("matching openConversation's markReadSafely") is stale: openConversation inlines its own guarded call. Dead code with no behavior impact, left alone.
- `components/inbox/MessagesInbox.tsx:516-520,586,617-619,699` — several comments say the `isPreviewSession()` check protects against a fake-signed-in Clerk stub with a truthy userId. But `isPreviewSession` itself requires `!userId`, so it never does that. No behavior change in production, so left alone; flagged for the lead.
- `components/inbox/MessagesInbox.tsx:959` — "Delete all" on Requests deletes only the search-filtered requests (`requestConvs`) when a search is active. This could be intended, so left alone.
- `components/layout/Screen.tsx:70` — `Screen` with `withTabBarInset={false}` applies no bottom safe-area padding, while `ScreenScroll` applies `insets.bottom`. The header says safe-area insets are "always applied". No current caller passes `withTabBarInset={false}` to `Screen`; left alone as layout behavior.
- `components/first-run-tips/SpotlightOverlay.tsx:68-82` with `AnchoredCardTip.tsx:88` — on web, if TipBubble is clamped inside a screen-wide hole, a tap on "Next" also hits the hole's document listener and can advance two steps. This is an edge case of very large targets, not reproduced, so not changed.
- `components/illustrations/EmptyStateArt.tsx:79-93` — if `AccessibilityInfo.isReduceMotionEnabled()` rejected, or `animated` flipped from true to false mid-draw, the stroke would stay partially drawn. Not observed in practice, so not changed.
- `components/growth/GrowthUI.tsx:64` — `dollars()` would render negative cents as "$-1". Server revenue (routes/growth.ts) is a sum of order totals and is never negative, so not changed.

## Cross-chunk defects (not fixed)
- `artifacts/mobile/tests/seller-inbox-search-and-swipe-actions.test.ts:25,57` and `artifacts/mobile/tests/seller-messages-parity.test.ts` ("pushed from Profile…", "seller empty state…", "keeps the seller first-run tip") — 5 stale source-string assertions that already fail before my changes. The source now uses `{ icon: 'search', …}` (not `name:`), `inboxPinRank` sorting, `id={inboxTipId}` / `gesture={{ ...(isSeller ? … ) }}`, and the reframe `QuietEmptyState`. → Update those literals to the current source. None of them is caused by this chunk's edits.
- Server `api-server/src/routes/conversations.ts` `buildConversationView` — does not expose the last message's sender id. That is why the mobile `lastMessageSenderId` "You:" preview never works for real accounts. → Add `lastMessageSenderId` to the view if "You:" previews are wanted.

## Test files touched / created
- created `artifacts/mobile/components/inbox/MessagesInbox.audit.test.ts`
- created `artifacts/mobile/components/legal/__tests__/LegalAcceptanceGate.audit.test.tsx`
- created `artifacts/mobile/components/growth/__tests__/GrowthUI.audit.test.tsx`
- Ran with no edits: `components/inbox/inboxPillColors.test.ts` (pass), `tests/legal-acceptance-gate-hooks.test.tsx` (pass), `tests/inbox-notes.test.ts`, `tests/messages-swipe-a11y-preview-block.test.ts`, `tests/messages-action-sheet-web.test.ts` (pass). In `tests/seller-messages-parity.test.ts` and `tests/seller-inbox-search-and-swipe-actions.test.ts`, only the 5 already-failing tests listed above fail.
- tsc, filtered to the changed files: no errors.
