# Chunk 04
## Files read
| file | lines read (= file length) | defects found | defects fixed |
|---|---|---|---|
| artifacts/mobile/components/chat/ChatAttachmentCard.tsx | 257 | 0 | 0 |
| artifacts/mobile/components/chat/ConversationSettingsSheet.tsx | 198 | 0 | 0 |
| artifacts/mobile/components/chat/ConversationThread.tsx | 4372 | 7 | 7 |
| artifacts/mobile/components/chat/LinkPreviewCard.tsx | 66 | 0 | 0 |
| artifacts/mobile/components/chat/MediaUploadThumb.tsx | 76 | 0 | 0 |
| artifacts/mobile/components/chat/MediaViewer.tsx | 168 | 1 | 1 |
| artifacts/mobile/components/chat/ReactionBar.tsx | 91 | 0 | 0 |
| artifacts/mobile/components/chat/ReactionOverlay.tsx | 199 | 0 | 0 |
| artifacts/mobile/components/chat/ReplyBanner.tsx | 92 | 0 | 0 |
| artifacts/mobile/components/chat/SwipeToReplyBubble.tsx | 111 | 0 | 0 |
| artifacts/mobile/components/chat/SystemLine.tsx | 76 | 0 | 0 |
| artifacts/mobile/components/chat/ThemePickerSheet.tsx | 86 | 0 | 0 |
| artifacts/mobile/components/chat/ThemePreviewScreen.tsx | 75 | 0 | 0 |
| artifacts/mobile/components/chat/TypingBubble.tsx | 60 | 0 | 0 |
| artifacts/mobile/components/chat/UploadRing.tsx | 75 | 1 | 1 |
| artifacts/mobile/components/chat/VideoMessageViewer.tsx | 54 | 0 | 0 |
| artifacts/mobile/components/chat/VoiceMessageBubble.tsx | 140 | 0 | 0 |
| artifacts/mobile/components/chat/VoiceRecordingBar.tsx | 121 | 0 | 0 |
| artifacts/mobile/components/checkout/AddToOrderOffer.tsx | 258 | 0 | 0 |
| artifacts/mobile/components/checkout/CheckoutLanguage.tsx | 25 | 0 | 0 |
| artifacts/mobile/components/checkout/CheckoutNotLive.tsx | 41 | 0 | 0 |
| artifacts/mobile/components/checkout/CheckoutPrimitives.tsx | 304 | 0 | 0 |
| artifacts/mobile/components/checkout/CheckoutSheet.tsx | 40 | 0 | 0 |
| artifacts/mobile/components/checkout/CheckoutTermsLine.tsx | 56 | 0 | 0 |
| artifacts/mobile/components/checkout/ContactSection.tsx | 63 | 0 | 0 |
| artifacts/mobile/components/checkout/GiftCardSection.tsx | 142 | 0 | 0 |
| artifacts/mobile/components/checkout/GiftOptionRow.tsx | 66 | 0 | 0 |
| artifacts/mobile/components/checkout/OrderConfetti.tsx | 140 | 1 | 1 |
| artifacts/mobile/components/checkout/OrderConfirmation.tsx | 532 | 1 | 1 |
| artifacts/mobile/components/checkout/OrderReview.tsx | 390 | 0 | 0 |
| artifacts/mobile/components/checkout/OrderSummarySection.tsx | 218 | 0 | 0 |
| artifacts/mobile/components/checkout/PaymentSection.tsx | 368 | 0 | 0 |
| artifacts/mobile/components/checkout/PostPurchaseOffer.tsx | 249 | 0 | 0 |
| artifacts/mobile/components/checkout/PromoCodeSection.tsx | 112 | 0 | 0 |
| artifacts/mobile/components/checkout/RegionPickerSheet.tsx | 225 | 0 | 0 |
| artifacts/mobile/components/checkout/ShippingSection.tsx | 288 | 0 | 0 |
| artifacts/mobile/components/checkout/StripePayment.tsx | 415 | 0 | 0 |
| artifacts/mobile/components/checkout/StripePayment.web.tsx | 412 | 0 | 0 |
| artifacts/mobile/components/checkout/ThreadCashSection.tsx | 103 | 0 | 0 |
| artifacts/mobile/components/checkout/TipSection.tsx | 71 | 0 | 0 |
| artifacts/mobile/components/checkout/stripePaymentTypes.ts | 56 | 0 | 0 |
| artifacts/mobile/components/closet/ClosetProofCard.tsx | 90 | 0 | 0 |
| artifacts/mobile/components/closet/ClosetViews.tsx | 201 | 0 | 0 |
| artifacts/mobile/components/closet/UnboxingMoment.tsx | 153 | 0 | 0 |
| artifacts/mobile/components/closet/WrappedProfileCard.tsx | 85 | 0 | 0 |
| artifacts/mobile/components/comments/CommentPhoto.tsx | 245 | 0 | 0 |
| artifacts/mobile/components/community-chat/CommunityComposer.tsx | 288 | 0 | 0 |
| artifacts/mobile/components/community-chat/CommunityMessageRow.tsx | 320 | 0 | 0 |
| artifacts/mobile/components/community-chat/useCommunityChat.ts | 360 | 0 | 0 |
| artifacts/mobile/components/community-inbox/CommunityInboxRow.tsx | 123 | 0 | 0 |
| artifacts/mobile/components/community-inbox/InboxComposeMenu.tsx | 21 | 0 | 0 |
| artifacts/mobile/components/community/CommunityAvatar.tsx | 57 | 0 | 0 |
| artifacts/mobile/components/community/CommunityRow.tsx | 126 | 0 | 0 |
| artifacts/mobile/components/community/GroupFormFields.tsx | 160 | 0 | 0 |
| artifacts/mobile/components/community/SignInPrompt.tsx | 31 | 0 | 0 |
| artifacts/mobile/components/community/VerifiedMark.tsx | 35 | 0 | 0 |

(Line counts are the pre-fix lengths from chunk04.txt; every line was read. Post-fix lengths: ConversationThread 4400, MediaViewer 175, OrderConfetti 144, OrderConfirmation 535, UploadRing 75.)

## Fixes
- `artifacts/mobile/components/chat/ConversationThread.tsx:726` — load catch did `setLoadFailed(status !== 404 && status !== 403)` and then an unconditional `setLoadFailed(true)` (a merge leftover), so a deleted/forbidden conversation (404/403) showed "Couldn't load this conversation. Try again" with a useless retry instead of "Conversation not found" → removed the clobbering line. Test: `artifacts/mobile/components/chat/__tests__/ConversationThread.audit.test.ts` (failed before: yes)
- `artifacts/mobile/components/chat/ConversationThread.tsx:740` — the subscribeSocial refetch `getMessages(conv.id).then(setMessages)` had no catch → unhandled promise rejection whenever the refetch fails offline → added `.catch(() => {})` (same as the poll refetches next to it). Test: same file (failed before: yes)
- `artifacts/mobile/components/chat/ConversationThread.tsx:1301-1317` — handleVoiceRecorded ran `sendMessage` and the follow-up `getMessages` refresh in one try, so a failed refresh after a SUCCESSFUL send alerted "Voice message not sent" (buyer re-records → duplicate voice note) → alert only on send failure; refresh failure is silent (next poll/realtime catches up). Test: same file (failed before: yes)
- `artifacts/mobile/components/chat/ConversationThread.tsx:1811-1822` — handleSend clears the composer, then `await enqueueOutboxMessage(...)` with no try/catch (the media-upload branch above it does guard this): an AsyncStorage write failure rejected handleSend unhandled and the typed text/attachment/reply were silently lost → wrapped in try/catch that restores the draft and alerts "Message not saved" (same copy/guards as the upload branch). Test: same file (failed before: yes)
- `artifacts/mobile/components/chat/ConversationThread.tsx:2033-2039` — sheetDelete chained `deleteMessageForMe(...).then(() => getMessages().then(setMessages)).catch(alert)`, so a failed refresh after a successful delete alerted "Couldn't delete message" and left the message visible → on success mark it `deletedForMe` locally, refresh best-effort; alert only when the delete itself rejects. Test: same file (failed before: yes)
- `artifacts/mobile/components/chat/ConversationThread.tsx:2575-2588,2955` — baseline TS error (2553 boolean→number): the search-result focus effect wrote `focusHoldRef.current = true` into the numeric takePendingChatFocus hold ref, which onContentSizeChange immediately cleared, while `searchFocusHoldRef` (the hold the messages.length effect releases, with focusHoldLenRef) was never set true anywhere → after jumping to a search hit, the next content-size change (highlight wrapper, image load, typing bubble) scrolled the list back to the bottom. → set `searchFocusHoldRef.current = true` when the found message is scrolled to, honour it in onContentSizeChange, reset it on thread/user switch; dropped the bad boolean write. Test: same file (failed before: yes)
- `artifacts/mobile/components/chat/ConversationThread.tsx:3530-3534` — statusLineFor rendered `last seen ${timeAgo(ts)} ago`, and timeAgo returns 'now' under a minute → "last seen now ago" → "last seen just now" for that case. Test: same file, executes the extracted function (failed before: yes)
- `artifacts/mobile/components/chat/MediaViewer.tsx:42-55,96` — swipe-down-to-close called `onClose()` without resetting translateY/backdropOpacity/scale (only the X/back path did), so the next photo opened still dragged down and dimmed; also the PanResponder is created once (useRef), so it called the FIRST render's onClose → swipe path now goes through handleClose (resets transform) and calls the latest onClose via a ref. Test: `artifacts/mobile/components/chat/__tests__/MediaViewer.audit.test.tsx` (failed before: yes)
- `artifacts/mobile/components/checkout/OrderConfetti.tsx:108-122` — reduceMotion started as `false` and was resolved async, so with `play` true on mount the burst + success haptic fired before the setting was known; when it then resolved true the cleanup cleared the hide-timer and the overlay stayed mounted. Header promises "Skipped entirely under Reduce Motion" → reduceMotion is null until known and the burst waits for a known `false`. Test: `artifacts/mobile/components/checkout/__tests__/OrderConfetti.audit.test.tsx` (failed before: yes)
- `artifacts/mobile/components/checkout/OrderConfirmation.tsx:244` — "Message {seller}" opened `/buyer-conversation?type=buyer_to_seller_order&contextOrderNumber=…` without contextOrderId. Server (api-server routes/conversations.ts:579-582) reuses an existing thread of that type with `contextOrderId IS NULL` when none is given, so every later order's "Message seller" reopened the first order's thread labelled with the first order number (buyer-order-detail.tsx:943 passes contextOrderId correctly) → pass `contextOrderId=<verified order id>` when known. Test: `artifacts/mobile/components/checkout/__tests__/OrderConfirmation.audit.test.tsx` (failed before: yes)
- `artifacts/mobile/components/chat/UploadRing.tsx:8-12` — doc comment said the ring is "intentionally indeterminate" because uploads report no progress, but the component has a determinate `progress` mode and ConversationThread feeds it real uploadMediaFile progress → comment rewritten to describe both modes. Test: none (comment only).

## Judgment calls — not changed
- `artifacts/mobile/components/checkout/OrderConfirmation.tsx:136-138` — "More from {Brand}" tile price is `min(v.priceCents ?? 0)` so a variant with a null price would show $0.00 (ConversationThread's picker filters `> 0` instead). Did not verify whether GET /api/public/sellers/:id can return a null variant price; left.
- `artifacts/mobile/components/checkout/OrderSummarySection.tsx:167-178` — with BOTH Thread Cash and a gift card applied, two "Order total" lines render with different values (orderTotalCents, then totalCents+giftCard). Edge case display; product decision on the right breakdown, left.
- `artifacts/mobile/components/chat/VoiceMessageBubble.tsx:42,60-64` — each bubble keeps its own speed pill state (starts 1x) while ConversationThread plays at one screen-wide `voiceSpeed`, so a bubble can show "1x" while playing at 2x. UX model choice, left.
- `artifacts/mobile/components/chat/VoiceMessageBubble.tsx:50-56` — scrub uses `nativeEvent.locationX`, which is relative to the touched child bar, not the track, on native. Needs device verification; left.
- `artifacts/mobile/components/chat/ReactionOverlay.tsx:100` — rowTop subtracts `hintBlockH` though the measured rowH already includes the hint text (extra ~26pt gap). Cosmetic.
- `artifacts/mobile/components/chat/ConversationThread.tsx:3172-3179` — Thread Cash onSent: a refresh failure after a successful sendMessage reports "Sent, but the chat message failed" (message text says refresh). Copy is honest enough; left.
- `artifacts/mobile/components/chat/ConversationSettingsSheet.tsx:311-317` — retryFollowStatus has no unmount/visibility guard (setState after close). Benign.
- `artifacts/mobile/components/chat/MediaViewer.tsx:72` — responder captures first-render `height` for the backdrop fade (stale after rotation). Cosmetic.
- `artifacts/mobile/components/checkout/AddToOrderOffer.tsx:55-67` — offer isn't cleared when orderId/api changes (component is per-order screen; not reachable in practice).
- `artifacts/mobile/components/checkout/StripePayment.web.tsx:331,352,364` — `priced` ref is written but never read (dead state). Harmless.
- `artifacts/mobile/components/community-chat/CommunityMessageRow.tsx:8` — unused `Dimensions` import.
- `artifacts/mobile/components/community/CommunityRow.tsx:28-45` — OneLineOrNothing never resets `fits` if the text changes. Minor.
- `artifacts/mobile/components/closet/UnboxingMoment.tsx:64` — assumes `moment.pieces[0]` exists (server contract).
- `artifacts/mobile/components/chat/ConversationThread.tsx:609` — duplicate `setLoadFailed(false)`; harmless.

## Cross-chunk defects (not fixed)
- none found

## Test files touched / created
- created `artifacts/mobile/components/chat/__tests__/ConversationThread.audit.test.ts` (source-structure — the 4k-line screen can't render in the vitest shim; the statusLineFor case executes the extracted function via typescript.transpileModule)
- created `artifacts/mobile/components/chat/__tests__/MediaViewer.audit.test.tsx`
- created `artifacts/mobile/components/checkout/__tests__/OrderConfetti.audit.test.tsx`
- created `artifacts/mobile/components/checkout/__tests__/OrderConfirmation.audit.test.tsx`
- Each was verified to fail against the HEAD version of its source file (swapped in temporarily via `git show HEAD:… > file`, then restored) and pass with the fix. Related existing suites (tests/messages-*, seller-messages-parity, official-profile, media-upload-thumb, checkout-redesign.structure, etc.) show the same failures before and after my changes (only a load-dependent 5s timeout in tests/a11y-icon-only-lint.test.ts differed). tsc on the changed files: no errors (baseline ConversationThread:2553 error gone).
