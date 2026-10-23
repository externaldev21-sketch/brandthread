# Messages + chat — screen audit (4/10)

How this was checked: I read the code for every screen below and rendered it in the web harness on the dev bundle at 393×852, as buyer and seller, fresh and `&demo=1`. I also opened the "…" menus, swipe rows, long-press menus and sheets. Native-only UI (the in-call views) was checked in code only, because the web route shows the "available in the mobile app" notice.
**[FIXED]** = fixed in this PR. Lines without a tag are real issues left open, either because they need a product decision or because they go beyond a safe mechanical fix.

**Messages inbox — buyer** (`app/(buyer)/inbox.tsx`)
- [FIXED] The selected Inbox/Requests pill was invisible on the default theme. Its fill and border were `cardElevated`, which is the same pure black as the screen, so the *selected* pill looked unselected and the other one looked active. It now uses the app's FilterChip convention: white fill, black label.
- [FIXED] Removed the dead "Filter messages" pill. Tapping it only showed a "Message filters — coming soon" snackbar. It also rendered as a stretched oval, not a circle.
- [FIXED] A fresh (empty) account showed a seeded "Your story" ring, and tapping it opened a demo story. The preview "my story" is now limited to `demo=1`.
- [FIXED] Conversations weren't sorted by recency. Rows showed 3m, 6m, 2h, 55m, 3h, 1h. Pinned threads still come first, then newest.
- [FIXED] Conversation rows had no accessibility role or label; a screen reader only heard the testID. Rows now read "Open conversation with X, unread", with a long-press hint.
- [FIXED] The load-error state said "Pull to refresh" and had no button. It now reads "Couldn't load your messages" with a **Try again** action.
- [FIXED] Off-scale type: the "typing…" line was 14 and is now `FS.sm`. Suggested-person reason and the Requests explainer were at the 11pt badge floor and are now `FS.meta`. Fixed off-token gaps of 8 and 12.
- [FIXED] The search field's focus fill was hard-coded `rgba(255,255,255,0.10)`. It is now derived from the theme text colour.
- Search only filters the Inbox tab. Typing a name while on Requests changes nothing.
- The "Delete" swipe action actually archives the thread, and the snackbar says "Conversation archived". The label and the action disagree.
- "Your story" shows an empty black circle when the account photo fails to load. There is no initials fallback once `hasImage` is true.

**Message requests — buyer** (`app/(buyer)/inbox.tsx`, Requests tab)
- [FIXED] Requests weren't sorted by recency (Thu, Tue, Wed). They are now newest first.
- [FIXED] Request rows had no accessibility role or label. They now read "Open message request from X".
- [FIXED] The empty-state sentence was missing its full stop.
- Search doesn't apply to requests (see above).
- Block and Delete are only reachable by swiping. Screen-reader users get no `accessibilityActions` for them (shared `InboxSwipeRow`).

**New message / compose** (`app/(buyer)/inbox.tsx` compose sheet, `components/community-inbox/InboxComposeMenu.tsx`)
- [FIXED] Empty-directory copy "No one to show yet" is now "Search for someone to message". "No one found" is now `No one matches "<query>"`.
- [FIXED] The start-conversation failure alert was "Try again." and is now "Please try again.", matching every other alert on the screen.
- People rows always show grey initials. They ignore the person's photo and colour, unlike every other people list.
- Tapping the dimmed area above the sheet does nothing. The backdrop is a plain View; only the X or a swipe closes it.
- The compose menu itself (New message / Create group / Join a group / Cancel) is fine.

**Messages inbox + requests — seller** (`app/seller-inbox.tsx`)
- [FIXED] The selected Inbox/Requests pill was invisible on the default theme. Same fix as the buyer inbox.
- [FIXED] Inbox rows ignored the buyer's photo and always drew initials, even though Request rows used the photo. Inbox rows now render `avatarUri`.
- [FIXED] When every thread was a request or archived, the Inbox tab showed the search empty state ("No matches — try a different name") with no search active. It now shows "No messages yet".
- [FIXED] The error copy said "Pull to refresh" next to a Retry button. It now says "Couldn't load your messages." with **Try again**.
- [FIXED] Inbox and Requests are now sorted by recency, pinned first.
- [FIXED] Inbox rows announce unread state and the long-press hint. The Requests explainer moved off the 11pt badge floor to `FS.meta`.
- The Mute swipe gives no confirmation; the buyer inbox shows "Muted X".
- The "Delete" swipe archives (same mismatch as the buyer inbox).
- The Requests tab shows "No message requests" even when loading failed.
- Search doesn't filter the Requests tab.
- `totalUnread` is computed but never shown. Its comment refers to a header subtitle that doesn't exist.

**Chat thread — buyer** (`app/buyer-conversation.tsx`)
- [FIXED] Received bubbles had no visible fill on the default theme (`cardElevated` = background), so incoming messages floated as bare text. They now fall back to a neutral 12% white fill. The chosen chat themes still win.
- [FIXED] The header avatar and the per-message avatars ignored the person's photo and always drew initials. They now use the photo.
- [FIXED] There were no loading or error states: the thread was blank while loading and stayed blank, with an "Unknown" header, after a failed load. It now shows a spinner, then "Couldn't load this conversation" with **Retry**.
- [FIXED] The "Add to message" sheet backdrop was collapsed (`PressableScale` puts `flex: 1` on its inner view), so there was no dim and tapping outside didn't close the sheet. It is now a real full-screen Pressable.
- [FIXED] Long-press **Copy** appeared on photo, voice and card messages, copied an empty string and still said "Copied". It now only appears when there's text.
- [FIXED] "Delete for me" and "Archive conversation" failures were swallowed. Archive even navigated back as if it had worked. Both now show an alert, and archive stays on the thread.
- [FIXED] The order context card always opened the orders list and had no label. It now opens that order's detail ("View order BT-…").
- [FIXED] Thread Cash claim/cancel errors showed the raw `e.message`. They now use friendly copy.
- [FIXED] The online status line was mint green (`theme.success`). It is now monochrome muted.
- [FIXED] Off-scale type: bubble time 10 → `FS.xs`, header name 16 → `FS.base`, date separator 12 → `FS.meta`, message text 15 → `FS.base`, AI tag 10 → `FS.xs`. "Unread Messages" → "Unread messages".
- [FIXED] Added labels and roles to photo grid cells, the failed-send retry row, reaction chips (with selected state), media-sheet options and attachment-picker tabs and rows.
- Post and profile attachment cards without a `postId`, and all profile cards, are dead taps.
- The order context badge shows the raw DB status string (e.g. lowercase "shipped").
- The header online dot is still `theme.success` green.
- A failed Follow from the "follow back" snackbar is silently swallowed.
- The header icon group uses `gap: 20` and bubbles use `paddingHorizontal: 12`. Both are off the spacing scale, but fixing them would rework the layout.

**Message request thread** (`app/buyer-conversation.tsx`, `app/seller-conversation.tsx` request panel)
- [FIXED] The Block / Delete / Accept buttons collapsed to their text width (`flex: 1` on `PressableScale` never reached the row). Accept rendered as a tiny white box with its label clipped. Each button now gets an equal third.
- [FIXED] "View profile" on a buyer-sent request opened `/seller-profile` for a buyer account. Buyers now open their buyer profile.
- [FIXED] The request explainer moved off the 11pt floor (`FS.meta`, line height 17), in both screens.
- The call and video icons still show on an unaccepted request, so you can ring someone whose request you haven't accepted.

**Brandthread Agent chat** (`app/buyer-conversation.tsx`, agent mode)
- [FIXED] When the agent API failed, the app made up a canned "agent" reply in a real conversation, i.e. fake data outside demo mode. Now the unsent bubble is removed, the text is put back in the composer, and "Message not sent" is shown. Preview threads keep their scripted demo.
- [FIXED] Agent info and deep-link cards had no role or label.
- The header ⓘ button is labelled "About Brandthread Agent" but opens the generic Archive / **Block Brandthread Agent** / Report sheet. That lets you archive or block the always-pinned official account, and there is no "About" content.

**Chat thread — seller** (`app/seller-conversation.tsx`, including the quick-replies, product-picker, attach and buyer-context sheets)
- [FIXED] All five sheets ("Add to message", "Attach to message", quick replies, product picker, buyer context) had a collapsed backdrop. On "Add to message" the sheet rendered at the **top** of the screen with no dim. Nothing closed on an outside tap. They now dock at the bottom, dim, and close on an outside tap.
- [FIXED] Received bubbles had no fill on the default theme. Same fix as the buyer thread.
- [FIXED] In the seller preview with any signed-in session, the seller's own seeded messages rendered on the left as received, with a "Y" avatar. This affects preview only.
- [FIXED] Tapping a reaction in preview threads called the API, failed and silently rolled back. Reactions now stick locally in preview.
- [FIXED] Added labels and roles to photo cells, reaction chips and sheet close buttons. Close buttons got hitSlop.
- [FIXED] Copy: "No products found" → "No active products to share yet". "No other orders from X yet" → "No orders from X yet". An empty quick-reply list now explains how to add one. The Thread Cash "sent, but the chat message failed" line is now plain English.
- [FIXED] Off-scale values: bubble time 10 → `FS.xs`, reaction count 11 → `FS.xs`, reply quote and spacer padding moved onto `SP`.
- A failed initial load has no error state. It shows a "Buyer" header, an empty list and a live composer.
- An empty thread renders blank, with no empty state.
- The send-failure fallback alert says "Tap to retry", but an alert can't retry. `tests/seller-message-requests.test.ts` pins that string.
- In preview, voice send and the disappearing-messages quick toggle hit the API and show failure alerts.
- Video bubbles use the video URI as an image source, so the thumbnail can be blank.
- The order card's "SHIPPED" badge is orange. That comes from the shared order-status palette and is off black/white/silver.

**Chat cards** (`components/chat/ChatAttachmentCard.tsx`, `components/chat/SystemLine.tsx`)
- [FIXED] Product and order cards were invisible on the default theme: the card fill and the icon placeholder were both pure black on black.
- [FIXED] Order cards (no photo) reserved a full 3:4 photo frame, leaving a ~300pt empty block with one icon in the thread. The icon-only frame is now 2:1.
- [FIXED] The inline "Change" / "Turn on" links in system lines now have `accessibilityRole="link"`.

**Media viewer** (`components/chat/MediaViewer.tsx`, `components/chat/VideoMessageViewer.tsx`)
- [FIXED] The "Pinch to zoom" hint had no font family (it fell back to the system font, not Inter) and used a raw 12. It is now Inter `FS.meta`.
- The "Saved" and "Permission" alerts are silent no-ops on web.
- VideoMessageViewer: clean after code review.

**Voice messages** (`components/chat/VoiceMessageBubble.tsx`, `components/chat/VoiceRecordingBar.tsx`)
- [FIXED] "View transcription" showed developer copy to users: "…isn't wired up to a real speech-to-text service yet — this is placeholder text". It now says "Transcription isn't available for this voice message yet."
- [FIXED] The playback-speed pill had no role or label and a tiny target. It is now labelled "Playback speed 1x" with hitSlop. The transcription link got a role.
- [FIXED] Sub-floor type: speed 10, transcription 11 and web lock hint 10 are now `FS.xs`.
- [FIXED] The web "Tap to keep recording hands-free" control had no role or label.

**Reactions + reply** (`components/chat/ReactionOverlay.tsx`, `ReactionBar.tsx`, `ReplyBanner.tsx`, `SwipeToReplyBubble.tsx`)
- [FIXED] The reaction chip label used `fontWeight: '600'` with no font family (system font, not Inter). It is now `FONT.semibold` / `FS.meta`, and the 8s are `SP.sm`.
- [FIXED] Emoji buttons now read "React with ❤️" with selected state. Context-menu items got a role and label.
- [FIXED] The reply banner's close control was a typed "×" glyph. It is now the standard Feather `x` icon.
- SwipeToReplyBubble: clean after code review.

**Conversation details** (`app/conversation-details.tsx`, including the mute sheet)
- [FIXED] The mute sheet backdrop was collapsed: no dim, and tapping outside didn't close it.
- [FIXED] Opened without a colour or initials, the big avatar was a blank white circle. It now falls back to the identity colour and the first initial.
- [FIXED] The Options sheet listed Cancel first; it is now last. Mute-duration rows and the disappearing-messages switch got labels.
- [FIXED] Sub-floor type: the "New" pill was 10, and action labels and row subtitles were at 11. They are now `FS.xs` / `FS.meta`.
- The "New" pill on Theme never goes away.
- Profile and "Something isn't working" silently do nothing when the participant id is missing.
- "Something isn't working" files a *profile report*, not a bug report.
- In preview, Block calls the real API.

**Chat theme picker** (`components/chat/ThemePickerSheet.tsx`, `components/chat/ThemePreviewScreen.tsx`)
- [FIXED] The tile grid was broken: the `width: '25%'` column sat on `PressableScale`'s inner view, so tiles overlapped the left edge and labels wrapped one letter per line ("Ru / n.", "Sa / tin"). Each tile now sits in a proper 25% cell.
- [FIXED] The sheet backdrop was collapsed (no dim, no tap-out close).
- [FIXED] Tiles got a role, a label and selected state. The label size moved from 10/12 to `FS.xs`/14.
- [FIXED] The theme-preview explainer was on the wrong bubbles: the *received* bubble described "messages you send".
- The "Street" theme swatch is neon yellow, which is off black/white/silver. It's a deliberate user-chosen chat theme, so I left it.

**Conversation settings sheet** (`components/chat/ConversationSettingsSheet.tsx`)
- [FIXED] The confirm Cancel/Block/Unblock/Unfollow buttons and the backdrop had no role or label.
- No screen imports this component. It's dead code.
- If it is revived, its confirm buttons use `flex: 1` on `PressableScale` and will collapse the same way the request panel did.

**Search in conversation** (`app/conversation-search.tsx`)
- [FIXED] Searches fired on each keystroke could resolve out of order and show stale results. A sequence guard now drops older responses.
- [FIXED] A network failure showed "No messages found". It now shows "Couldn't search this chat…".
- [FIXED] The input got a label and a search return key. The empty-state text got side padding.
- Tapping a result does nothing; it doesn't jump to that message.
- No clear (×) button in the field.
- Matches aren't highlighted in results.

**Nicknames** (`app/conversation-nicknames.tsx`)
- [FIXED] The input had no accessibility label.
- [FIXED] On web the input showed the browser focus outline. `WEB_INPUT_RESET` is now applied.
- In preview, Save shows success but doesn't keep the nickname.
- Save stays enabled when nothing changed.

**Privacy & safety** (`app/conversation-privacy-safety.tsx`)
- [FIXED] Rows had no button role.
- [FIXED] "Unblock X" was in destructive red. Only "Block" is red now.
- [FIXED] The explainer body moved from the 11pt floor to `FS.meta`.

**Create a group chat** (`app/conversation-group-create.tsx`)
- [FIXED] Selectable people rows had no checkbox role, checked state or label.
- [FIXED] Long names didn't truncate (`numberOfLines={1}`).

**Calls** (`app/call-screen.tsx`, `components/calls/*`)
- [FIXED] Turning off **your** camera hid the **other person's** video.
- [FIXED] The "Flip camera" button was a dead tap (empty handler) in the in-call and outgoing views. Removed.
- [FIXED] The outgoing screen showed a camera toggle on voice calls.
- [FIXED] A repeated join callback could start a second timer and double the call-duration speed.
- [FIXED] The screen-share toggle showed "on" even when the SDK threw.
- [FIXED] The background was off-palette navy `#0A0A14` and is now black. Camera-off initials went from 22 to `FS.xl`.
- [FIXED] Back (which hangs up), Mute, Camera, End and Share got roles, labels and on/off state.
- [FIXED] The web notice said "open Brandthread on iOS or Android" twice (body plus footnote). The body copy now says something different.
- The call-quality rating on the call-ended screen confirms the tap, but nothing saves it.

**Community chat** (`app/community-chat.tsx`, `components/community-chat/*`)
- [FIXED] Screen readers couldn't hear message text: the bubble label replaced it with "Message from X". It now includes the text (or "Photo" / "N photos").
- [FIXED] Sub-floor and off-scale type: timestamps 10 → `FS.xs`, message text 15 → `FS.base`, avatar initials 11 → `FS.xs`, "Reconnecting…" → `FS.meta`.
- Outside live mode, Report group and Report message just show "Thanks, we'll take a look" and send nothing.
- Avatar initials use the theme text colour on the identity colour, where every other avatar uses white.

**Community inbox row** (`components/community-inbox/CommunityInboxRow.tsx`, `components/inbox/*`)
- [FIXED] Group rows showed "45d" while the DM rows beside them show a weekday or date. They now use the same format.
- [FIXED] The preview text was a raw 14; it is now `FS.sm`, matching DM rows. The row label now says when a group is muted.
- With a row swiped open, tapping it opens the chat without closing the row first (`InboxSwipeRow`).
- More than one row can be swiped open at once.
- `components/inbox/FollowerAvatarCard.tsx` isn't imported anywhere. It's dead code.
