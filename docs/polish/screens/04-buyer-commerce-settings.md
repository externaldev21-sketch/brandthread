# Buyer: checkout, orders, chat & settings

[← Back to the punch list](../punch-list.md) · [Design rules](../design-rules.md)

**35 P0 · 90 P1 · 33 P2.** Rows are sorted P0 → P1 → P2 inside each screen. Line numbers are from `dev` @ `7e0f547` and will drift as other branches land. Search for the quoted code if a line has moved.


Scope: 30 files in `artifacts/mobile/app`. Everything was read, and every line number was checked against the working tree.
Key theme facts used below: static `ACCENT`/`PURPLE` = `#F7F7FA` and `ON_DARK` = `#FFFFFF` (lib/theme.ts:41-50). Every runtime preset has a **light** accent with a **dark** `onAccent` (for example Monochrome accent `#F7F7FA`, Purple `#D990FF`). So any "accent background + ON_DARK / '#fff' foreground" pairing is white-on-white or white-on-pastel.

---

### Buyer checkout — `app/buyer-checkout.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Successful payments are reported as cancelled or declined. Payment opens in `WebBrowser.openBrowserAsync`. On iOS the sheet only resolves `cancel`/`dismiss` when the buyer closes it, which the code treats as "Payment was cancelled." On Android it resolves `opened` immediately, so polling (6 × 2s) runs while the buyer is still typing their card, then shows "Your payment was declined". The deep-link `successUrl` (`mobile://checkout/return`, lib/api.ts:939) has no route. The other Stripe flows (boost.tsx:683, sample-detail.tsx:455) use `openAuthSessionAsync`. | 1510-1535 | Switch to `openAuthSessionAsync(url, 'mobile://checkout/return')` and branch on `type === 'success'`. On timeout show "Confirming your payment…" with a "Check order status" button. Never say "declined" unless Stripe says so. |
| P0 | Copy | The declined message shows raw `verification.declineReason` from the server (for example Stripe codes), and "declined" is also the fallback when verification simply timed out. | 1531 | Map codes to copy. Generic: "Your card was declined. Try another card or contact your bank." Timeout: "We're still confirming your payment. This can take a minute." |
| P0 | Copy | Tax is always `$0.00` (cartService.ts:462 hard-codes 0), but the Review card shows "Tax $0.00" and the CTA says `Pay securely · $X`. Stripe then charges X + tax, so the amount on the pay button is not what the buyer pays. Only the receipt sheet (243-245) explains this. | 911-914, 1658, 234-237 | Tax row value: "Calculated at payment". CTA: "Continue to payment" (or "Pay $X + tax"). Total label: "Estimated total". |
| P0 | Theme | The required-policy checkbox tick is `ON_DARK` white on `theme.accent`, so the tick is invisible on Monochrome (#F7F7FA) and barely visible on the pastel presets. | 958-959 | Use `theme.onAccent` for the check icon. |
| P0 | Theme | The "Create an account" button uses a `theme.accent` background with `ON_DARK` text: white on near-white. | 2043-2044 | `color: theme.onAccent`, or reuse `PrimaryButton`. |
| P1 | Theme | The finalizing clock icon is `ON_DARK` on a `PURPLE` (accent) circle, so it is invisible on Monochrome. | 1080-1084 | Icon colour `theme.onAccent`. |
| P1 | Motion | Double-submit window. `placing` is only set inside `pay()`, but on the review step `handleContinue` first awaits `validateServerCart()` (a network call). During that call the CTA stays enabled with no spinner, so a second tap starts a second `pay()`. Continue on the information and delivery steps has the same problem: the button looks dead while validation runs. | 1406-1444, 1811-1815 | Set a `busy` flag at the top of the onPress, disable the CTA and show the spinner until the whole chain resolves. |
| P1 | Visual | The pay bar is absolutely positioned with `paddingBottom: insets.bottom + 8` inside `KeyboardAvoidingView behavior="padding"`. With the keyboard up it keeps the ~34pt home-indicator padding, leaving a dead gap above the keyboard. On Android `padding` plus `adjustResize` double-shifts the bar. | 1662, 1808 | Use `behavior={Platform.OS==='ios'?'padding':undefined}` and drop `insets.bottom` while the keyboard is visible (`Keyboard` listener). |
| P1 | Copy | Payment errors render at the very bottom of the scroll content, below all three accordions, so after a decline the buyer only sees the CTA label change. | 1783-1803 | Pin the error card directly above the pay bar, or scroll to it and fire an error haptic. |
| P1 | Copy | Validation relies on Alert pop-ups with "Please" padding and all-fields-at-once copy ("Enter your first and last name, a valid email and phone number, and every required shipping address field."). | 388, 1382, 1415, 1432, 1438 | Show inline field errors. Alert copy: "Add your street, city, state, ZIP and country.", "Choose a delivery option for each seller.", "Accept the policies to continue." |
| P1 | Copy | Generic network failure copy: "We could not start secure checkout. Please try again." | 1586 | "Couldn't open secure payment. Check your connection and try again." |
| P1 | Consistency | The "Contact & shipping address" section shows a green ✓ without checking the phone number, but Continue rejects an invalid phone. A section marked complete that fails validation reads as a glitch. | 1651-1653 vs 1379 | Add the phone regex to `informationComplete`. |
| P1 | Copy | Email and phone are collected twice: once in the Contact card (653-665) and again in the address modal preview (581-595). | 581-595 | Remove the second pair from the address preview. Keep only first and last name there. |
| P1 | Visual | The address modal is a `pageSheet` but adds `insets.top` to its header, which leaves a large blank band on iOS. Its title always reads "Add new address", even when editing. | 724-725 | Drop `insets.top` for pageSheet. Title: `address.line1 ? "Edit address" : "Add address"`. |
| P1 | Motion | Accordion sections pop open and closed with no animation, so the page height jumps. Receipt sheet: the backdrop is inside a `slide` Modal, so the dark scrim slides up with the sheet instead of fading. | 168, 185-186 | Use `LayoutAnimation`/Reanimated for the accordion. Put the shared sheet pattern (`SheetHandle`, fade backdrop) in BrandthreadUI. |
| P1 | Perf | Every sub-component (`Card`, `Input`, `GuidedSection`, …) calls `useThemeAliases()` + `makeStyles(theme)`, which is a ~120-style `StyleSheet.create` on every render. All form state lives in the root, so each keystroke rebuilds dozens of stylesheets. | 88-92, 102-103, 1228, 1850 | Wrap `makeStyles` in `useMemo([theme])` once in the root and pass `s` down (or use a context). |
| P2 | Copy | Confirmation: "Thank you!" (exclamation), all-caps eyebrows "PAYMENT RECEIVED"/"PURCHASE COMPLETE", and "N ITEMS IN YOUR ORDER". | 1088-1089, 1115 | "Order confirmed", eyebrow "Payment received" (sentence case), "3 items". |
| P2 | Copy | Multi-seller notice is long and names the vendor twice. | 926 | "Items from 2 sellers — you'll pay each seller separately." |
| P2 | Visual | The "Check order status" button has `borderWidth: 1` but no `borderColor`, so it defaults to black and the outline is invisible. | 2033 | `borderColor: BORDER`. |
| P2 | Motion | Promo Apply has no try/finally: if `onApply` throws, the button stays on "…" forever. The busy state is also a text ellipsis instead of a spinner. | 823-833 | try/finally, `ActivityIndicator`, success haptic. |
| P2 | Copy | "Create an account" routes to `/sign-in`. | 1201 | Route to sign-up, or relabel "Sign in". |

### Checkout settings (seller) — `app/checkout.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | The whole screen is a non-functional mock. Every row, "Edit checkout content", "Add rule", "Address collection", "Add-to-cart limit" and the in-text links "SMS App" and "marketing automations" only fire a haptic, and nothing is saved. | 43-49, 86, 146, 157-178, 197, 203 | Wire the rows or hide them. Remove the dead inline links. |
| P0 | Copy | Shopify-clone jargon that doesn't exist in Brandthread: "by Managed Markets", "SMART checkout rules", "Abandoned checkouts settings are no longer managed here", "To launch SMS campaigns, you need to install an SMS App". | 205, 116, 86, 46-47 | Remove. If kept: "Address check" / "Verified at checkout". |
| P1 | Consistency | The checkout mode "select box" shows a chevron-down but cycles values on tap. That is a fake dropdown. | 37-40 | Use a segmented control, or a sheet with the 3 options. |
| P1 | Visual | 11pt text (`hintText`, `onPillText`) and hard-coded font names, radii 10/12/14 and sizes 12-15 ignore the FS/RADIUS tokens. The checkbox is 18pt with no hitSlop. | 237-278, 253, 276 | Use FS.sm+, `FONT.*` and `RADIUS.*`. Add `hitSlop`. |
| P2 | Copy | Header "Checkout" in a seller settings list is ambiguous. | 33 | "Checkout settings" |

### Order detail — `app/buyer-order-detail.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Theme | The "Submit review" button uses static `ACCENT` (#F7F7FA) as background with `ON_DARK` (#FFF) text and spinner, so the label is invisible on every theme. | 413, 415, 380 | Background `theme.accent`, text `theme.onAccent`, or use `PrimaryButton`. |
| P0 | Copy | Dead stub buttons in a primary flow. "Track on carrier" shows an Alert "Track X on the carrier's website." "Help Center" shows an Alert "Visit help.brandthread.com". "Copy tracking" doesn't copy (it shows the number in an Alert) yet fires a success haptic. | 986, 1073, 648-652 | Open the carrier URL with `Linking.openURL`. Push `/help`. Use `Clipboard.setStringAsync` + toast "Tracking number copied". |
| P0 | Copy | The payment summary doesn't add up. Tax is hard-coded to 0 (447), so it always shows "Tax $0.00", and there is no discount row, so Subtotal + Shipping + Tax ≠ Total whenever tax or a promo applied. | 447, 949-957 | Map `row.taxCents`/`row.discountCents`. Add a "Discount −$X" row, and hide Tax when it is unknown. |
| P0 | Copy | Raw `err.message` is shown in Alerts ("Error", "Cannot Cancel"). | 697, 732 | "Couldn't post your review. Try again." / "This order can't be cancelled now. Message the seller for help." |
| P1 | Motion | 15s polling: any failed poll or pull-to-refresh sets `order = null`, and the whole screen flips to the wifi-off error page. Transient blips wipe visible content. | 582-588, 606, 630-636 | Keep the last good order on failure. Show "Couldn't refresh. Pull to try again." inline. |
| P1 | Motion | Loading state is a bare full-screen spinner with no header. The `!order` fallback is a blank page. | 755-760, 785-791 | Use a skeleton with `BrandthreadHeader`. |
| P1 | Copy | Title Case and ALL CAPS everywhere: "Order Details", "Order Progress", "Order Placed", "Ready to Ship", "Shipping Address", "Payment Summary", "Cancel Order", "Keep Order", "Yes, Cancel", "Report a Problem", "Report Seller", "Buy Again", "Leave a Review", "Contact Seller", "Label Created", "Out for Delivery", status badges "NEW"/"SHIPPED". | 88-97, 102-108, 151-155, 766, 860, 940, 949, 1016-1032, 1066, 1074, 1091, 1097 | Sentence case: "Order details", "Order placed", "Cancel order", "Keep order", "Cancel order" (confirm), "Leave a review", "Message seller". |
| P1 | Copy | Return status badge shows the raw enum uppercased (for example "PENDING_REVIEW" with underscore). | 879 | Reuse the title formatter (875) → "Pending review". |
| P1 | Copy | "Buy Again" opens an Alert telling the buyer to browse Discover. | 738-751 | Push the product detail for `lineItems[0]`, or hide the button. |
| P1 | Visual | The sticky bottom bar can stack "Leave a Review" card + "Help Center" + "Contact Seller" (~200pt), covering a third of the screen. | 1045-1075 | Keep one primary ("Message seller"). Move Help into the actions list. |
| P1 | Consistency | Cancel success uses an Alert. The cancel confirmation is a bespoke Modal with a fixed `paddingBottom: SP.xl+20` instead of insets. | 728, 1078-1102 | Use the shared sheet + insets. Success toast: "Order cancelled. Your refund is on its way." |
| P1 | Theme | Imports static BG/CARD/FG/ACCENT/BORDER for the timeline, cards, sheet and badges, so it ignores the user's preset. | 35-44, 209-227, 390-416 | Use `theme.*` in `makeStyles(theme)`. |
| P1 | Copy | Robotic disclaimer: "This order view shows your purchase details only. Internal seller information is not visible here." | 1039 | Remove. |
| P2 | Copy | "Excellent!", "Review submitted — thank you!", and "Shipped via " rendered with an empty carrier. | 313, 1050, 848 | "Excellent", "Thanks for your review", and guard the carrier. |

### Return request — `app/buyer-return-request.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Motion | If the order fails to load, the form still renders with no items and Submit silently does nothing (`if (!order) return`). | 76-79, 85 | Show an error state: "Couldn't load this order. Go back and try again." |
| P1 | Visual | No KeyboardAvoidingView. The description textarea sits under the keyboard and behind the fixed submit bar. | 140-262 | Wrap in KAV and use `keyboardShouldPersistTaps`. |
| P1 | Copy | Title Case and "Please" copy: "Request Return", "Eligible Items", "Return Reason", "Describe the Issue", "Evidence Photos", "Preferred Resolution", "Submit Return Request", "Back to Order", Alerts "Select Reason"/"Please select a return reason.", "Error". | 83-84, 109, 124, 129, 147, 163-258 | "Request a return", "Choose a reason", "Submit request", "Back to order". Error: "Couldn't send your request. Try again." |
| P1 | Copy | Vague success note "Return requests will appear here once confirmed." ("here" is a success screen). | 126 | "Track it anytime from your order." |
| P2 | Visual | The remove-photo "×" is a 16pt target, the evidence thumbnail uses `'#fff'`/rgba literals, and the header back button is 40pt. | 216-218, 271 | 28pt badge + hitSlop, 44pt back. |

### Refund request — `app/buyer-refund-request.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | Internal-sounding copy: "Do not claim a refund is approved until the seller or payment provider confirms it." and "Refunds are not automatic — the seller or payment provider must confirm." | 219, 113 | "We'll let you know as soon as the seller responds." |
| P1 | Motion | "Photo evidence" picker allows video (`MediaTypeOptions.All`, a deprecated API) with no selection limit. | 60-64 | `mediaTypes: ['images'], selectionLimit: 5 - photos.length`. |
| P1 | Copy | Same Title Case issue as the return form ("Request Refund", "Order Items", "Refund Reason", "Submit Refund Request") plus "Please"/"Error" alerts. | 81-82, 99, 112, 131, 147, 163, 226 | Sentence case. "Couldn't send your request. Try again." |
| P2 | Consistency | Screen is orphaned: nothing routes to `/buyer-refund-request` (only `_layout.tsx:878`). | — | Link it from order detail or delete it. |

### Problem report — `app/buyer-problem-report.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Motion | Infinite spinner. `loading` starts true, and the effect returns early without an `orderId`. Settings "Report a problem" (buyer-settings.tsx:67) and story viewer "Report" (buyer-story-viewer.tsx:339) both open it without one. | 41, 62-63, 93-95 | `if (!orderId) { setLoading(false); return; }` and show a general-report variant. |
| P0 | Copy | Attached evidence photos are silently discarded (`evidenceUris: []`). | 82 | Pass `evidencePhotos`. |
| P1 | Copy | "Message Seller First" opens the generic inbox, not this seller's thread. | 205 | Push `/buyer-conversation?participantId=…&type=buyer_to_seller_order`. |
| P1 | Copy | Legalistic copy: "Do not fabricate claims or evidence. Fraudulent reports may result in account action." Also Title Case "Report a Problem", "Describe the Problem", "Contacted the Seller", "Submit Problem Report", "Report Submitted". | 223, 101, 119, 145, 192, 209, 230 | "Reports are reviewed by our team." / "Report a problem" / "Send report". |
| P2 | Motion | The Switch has no haptic and a static thumb `FG`. The picker allows video. | 195-199, 53 | `HapticSwitch`, images only. |

### Buyer conversation — `app/buyer-conversation.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | "Reply" is fake. It shows a reply bar, but `handleSend` ignores `replyTo` and clears it, so the message goes out as a plain message. | 646-648, 567-576, 933-947 | Send `replyToId`, and render the quoted snippet in the bubble. |
| P0 | Copy | The "Copy" long-press action is a no-op. | 663-668 | `Clipboard.setStringAsync(msg.text)` + toast "Copied". |
| P1 | Motion | FlatList is not `inverted`. It calls `scrollToEnd` on every `onContentSizeChange` plus a 100ms `setTimeout`, so the thread visibly jumps on open and yanks the reader to the bottom whenever a reaction or message arrives while they're scrolled up. | 231-235, 919-930 | Use `inverted` with reversed data and remove the manual `scrollToEnd` calls. |
| P1 | Motion | `isLoading` is never rendered: no skeleton, no empty state. A new thread shows a blank void. | 151, 919-930 | Message skeleton + `ListEmptyComponent`: "Say hi to {name}". |
| P1 | Motion | Send has no optimistic bubble. The text vanishes, then the message appears after `sendMessage` + `getMessages` (two round-trips). There is no haptic and no sending spinner. | 567-587, 1030-1042 | Append a local `status:'sending'` message immediately, add a light haptic, and a spinner in the send button. |
| P1 | Copy | Per-message timestamps are missing. Only date pills show, and `timeAgo` is dead code. | 61-69, 741-782 | Show time under the last bubble of each run: "9:41 AM". |
| P1 | Consistency | Message actions, emoji reactions and header options all use chained `Alert.alert` (emoji as alert buttons). Error copy is "Error"/"Failed to send message. Please try again." | 581, 593-637, 642-686 | Use a long-press action sheet with a reaction bar. Error: "Message not sent. Tap to retry." |
| P1 | Visual | The input row keeps `insets.bottom` padding while the keyboard is open, leaving a gap above the keyboard. Android uses `behavior="height"`. | 794-797, 985 | Drop `insets.bottom` when the keyboard is visible. Use `undefined` on Android. |
| P1 | Theme | Bubbles, header, input and date pills use static `CARD/BG/BORDER/FG`. The "disabled" banner uses hard-coded orange rgba. | 12-15, 728-729, 1284, 1318-1320, 1342, 1501, 1508 | Use `theme.card/background/border/text` and `theme.warning`. |
| P1 | Visual | Voice waveform bars are `PURPLE_DIM` on an own-bubble `PURPLE_DIM` background, so the waveform is invisible. The play icon is `#fff` on a light accent circle. | 1677 vs 728, 477, 1674 | Bars `theme.accent`, icon `theme.onAccent`. |
| P1 | Visual | The video attachment renders the .mp4 URL in RN `<Image>`, which gives a black box. | 466 | Store a poster frame (`expo-video-thumbnails`) and use expo-image. |
| P1 | Consistency | The attachment picker backdrop can't be tapped to dismiss, although the media sheet's can. The media sheet ignores the bottom inset (fixed 20pt spacer). | 1086, 1076 | Use one sheet component with backdrop dismiss and `insets.bottom`. |
| P1 | A11y | Back, store, call, video and more header buttons have no `accessibilityLabel`. Call buttons are 36pt. | 801-859, 1643 | Add labels and 44pt targets. |
| P2 | Copy | "Message..." uses three dots. Robotic strings: "Messaging disabled — friendship was removed.", "Options", "Message Options", "Not ready" / "Wait for the conversation to load.", "No active products available." | 1023, 913, 593, 686, 316, 1129 | "Message…", "You can't message this account anymore.", "Couldn't start the call yet. Try again in a moment.", "This seller has no items for sale yet." |

### Chat thread (legacy) — `app/chat/[id].tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Theme | Own bubbles and the send icon are white `#FFFFFF` on a gradient of `accentDim` → `accent` (light on every preset), so the text is unreadable. | 70-76, 105, 320-323 | Text/icon `colors.primaryForeground`. Gradient `theme.primaryGradient`. |
| P0 | Copy | Dead phone and video buttons. The header centre is a touchable with no action. | 245, 260-265 | Wire them to `/call-screen` (as buyer-conversation does), or remove them. |
| P0 | Copy | Raw `error.message` in the red banner ("Message was not sent: …", "Could not mark messages as read: …"). A mark-read failure is shown to users as an error. | 173, 210 | "Message not sent. Tap send to retry." Swallow mark-read errors. |
| P1 | Copy | A load failure shows only a lone "Go back" button with no explanation. `loadError` is never set. | 175-180, 223-230 | "Couldn't load this conversation." + [Try again] [Go back]. |
| P1 | Theme | The entire palette is hard-coded hex (`#121110`, `#1D1A15`, `#8C8577`, `#2A261E`, `#3A1F20`, `#FCA5A5`), a warm-brown scheme that ignores every preset. | 46-48, 62, 135-140, 278-279, 320 | Use `useColors()` tokens. |
| P1 | Motion | Not inverted. An animated `scrollToEnd` on each length change makes the thread scroll from top to bottom on open. | 189-193, 270 | `inverted`. |
| P1 | Visual | The send error lives in `ListHeaderComponent` (top of the list), which is off-screen when the user is at the bottom. KAV is disabled on Android. | 277-281, 236 | Show the error above the input. `behavior` per platform. |
| P1 | Consistency | A second, divergent chat UI. Bubble radius here is 20/5, while buyer-conversation uses 18/4 (RADIUS.lg/4). Headers, send buttons and colours also differ. | 103-104 | Delete this screen or redirect to buyer-conversation. Pick one bubble spec (18/4). |
| P2 | Copy | A timestamp under every single bubble; "✓✓" typed as text; header subtitle "Conversation"; 11pt divider; "No messages yet." | 85-93, 91-92, 254, 110, 284 | Show the time on the last bubble per run. Subtitle: handle. Empty state: "Say hi to {first name}." |

### Settings index (legacy) — `app/buyer-settings.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Motion | It paints the full 40-row list, then `router.replace('/settings')` fires in `useEffect`, which flashes one frame of a different settings page. | 82-84 | Replace the body with `<Redirect href="/settings" />` and delete the dead UI. |
| P2 | Copy | Hard-coded "Brandthread v1.0.0"; mixed casing "Accounts Center", "Close Friends", "Hidden Words", "Privacy Center". | 131, 17, 28, 37, 68 | Read `Application.nativeApplicationVersion`. Use sentence case. |

### Settings detail — `app/buyer-settings-detail.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Dev text shown to users. Tapping any non-toggle row pops "This control is ready for backend wiring." This is reachable from Accounts Center → "Ad and recommendation preferences" → "Reset suggested content". | 110 | Remove the fallback Alert. Hide rows without an action. |
| P0 | Copy | Fake people and brands: "@jordan", "Maya Chen", "Kai Nakamura" (Close Friends), "Vault Studios", "NxGen" (Favorites). | 23-24, 33 | Load real data or remove these sections. |
| P1 | Copy | Values are static strings unrelated to state ("0 people", "Everyone", "On", "Friends", "Default", "Daily average"), and each has a chevron that goes nowhere. | 20, 25-29, 35-36, 43-44 | Show values only when bound to state. Drop the chevron on inert rows. |
| P1 | Motion | "Hide offensive comments" and "Advanced comment filtering" are both bound to `hiddenWords`, so toggling one flips both. | 30 | Give each its own key, or merge them into one row. |
| P1 | Copy | `loadError` is never rendered. A failed load shows an empty page. | 59, 75-77, 110 | "Couldn't load settings." + [Try again]. |
| P2 | Visual | Sub text 11.5pt, value 12pt, intro 13 in raw numbers. | 118 | FS.xs/FS.sm tokens (≥12). |

### Accounts Center — `app/buyer-account-center.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Theme | Static `CARD/BORDER/FG/MUTED/SUBTLE` for the card, rows and header. The "B" logo is `ON_DARK` on `theme.accent`, which is invisible on Monochrome. | 9-12, 51, 82-96 | `theme.*`, logo text `theme.onAccent`. |
| P1 | Motion | Rows have no haptic and the default 0.7 opacity flash. | 62-66 | `PressableScale` + selection haptic. |
| P2 | Copy | Meta-ism "Accounts Center"; British and US spellings mixed ("personalisation", "memorialisation" vs "Favorites"); "memorialisation" isn't offered anywhere. | 28-29, 43 | "Account", "Deactivation and deletion", "Control personalization". |
| P2 | Visual | Subtitle 11.5pt. | 91, 96 | FS.xs. |

### Account control — `app/buyer-account-control.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | The delete-account confirmation button says "Deactivate". | 70 | `type === 'delete' ? 'Delete account' : 'Deactivate'` |
| P0 | Copy | Dev notes shown as feature bullets: "Server-side enforcement pending backend", "Request saved locally on this device"; the modal says "Your deactivation request will be saved on this device." | 142, 49 | Bullets: "Profile hidden while you're away", "Reactivate anytime by signing in". Modal: "You'll be signed out. Sign back in anytime to reactivate." |
| P0 | Copy | Raw `error.message` in "Account deletion failed". | 98-100 | "Couldn't delete your account. Try again or contact support." |
| P1 | Motion | While deletion runs, the modal's confirm button has no spinner and stays tappable, so it can be tapped repeatedly. The busy text is on the button behind the modal. | 65-71, 171 | Pass `deleting` into the modal, disable the button and show a spinner. |
| P1 | Visual | The centred modal with a TextInput has no KeyboardAvoidingView, so the keyboard covers the confirm button on smaller phones. | 39-41 | KAV, or pin the sheet to the bottom. |
| P2 | Copy | Title Case: "Account Control", "Delete Account Permanently?", "Deactivate Account?". | 45, 120 | "Delete account?", "Deactivate account?", "Account control". |

### Addresses — `app/buyer-addresses.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Raw `e.message` in the save Alert. | 118 | "Couldn't save this address. Try again." |
| P1 | Motion | The "Set as default address" checkbox is only rendered while unchecked, so tapping it makes the row vanish. | 218-225 | Always render it and toggle the check. |
| P1 | Copy | A load failure shows the empty state "You haven't saved any addresses yet." | 49-51, 236 | Error state: "Couldn't load your addresses. Pull to refresh." |
| P1 | A11y | Edit and delete icons have `padding: 4`, about 24pt targets. | 248-253, 305 | 44pt + labels "Edit address"/"Delete address". |
| P1 | Copy | Validation "Please fill out all required fields." doesn't say which field. Delete: "Delete Address" / "Are you sure you want to remove this address?" | 97, 125 | Name the missing field. "Delete this address?" / "It won't show at checkout anymore." [Delete] |
| P2 | Copy | "Save Address", "ZIP / Postal Code", "Apt, Suite, etc. (optional)". The empty state has no action line. | 228, 205, 190, 236 | "Save address", "ZIP code", "Apt, suite (optional)". Empty state: "No saved addresses" / "Add one for faster checkout." |

### Archive — `app/buyer-archive.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | "Delete permanently" has no confirmation. The Warning haptic fires before the call, and nothing is caught on failure. | 62-68, 192 | Confirm: "Delete this post?" / "This can't be undone." [Delete]. try/catch with an error toast. |
| P1 | Visual | Grid cells are gradient placeholders with a type icon, not the actual post thumbnail. | 94-105 | Render the post's first media with expo-image. |
| P1 | Motion | No loading state: "No archived posts" flashes before the data arrives. | 37, 41-44, 141 | Grid skeleton until the first load. |
| P1 | Copy | The Stories tab is a permanent empty stub. | 160-167 | Hide the tab until stories are archived. |
| P2 | Theme | Static `CARD/BORDER/FG/MUTED/SURFACE`. | 15-18, 208-231 | `theme.*`. |

### Blocked & muted — `app/buyer-blocked.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Motion | No loading state (the empty state flashes first). Unblock and unmute have no error handling. | 42-46, 64-67, 80-83 | Skeleton rows. "Couldn't unblock. Try again." |
| P1 | Consistency | Duplicates `buyer-muted.tsx` (a Muted tab here plus a separate Muted screen). The header has no fixed height and no border, unlike its siblings. | 164-196, 206-216 | One source of truth. Shared header. |
| P2 | Copy | "Unblock" is styled destructive; "Blocked & Muted" title; Alert title "Unblock" + message "Unblock X?". Names have no `numberOfLines`. | 63, 159, 57-58, 97 | Title "Unblock {name}?" / "They'll be able to find and message you again." Default style. "Blocked and muted". |

### Download data — `app/buyer-download-data.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Tech jargon: "JSON archive", "authenticated Brandthread account", "The server uses your signed-in identity…"; the fallback Alert prints a `file://` path. | 92, 101, 129, 56 | "Your data is ready. Save it or send it anywhere." / "We'll bundle the selected info into one file." Remove the path. |
| P0 | Copy | Raw `err.message` in "Export failed". | 63 | "Couldn't prepare your data. Try again." |
| P1 | Motion | The Download button is never `disabled`, so it can be tapped repeatedly while "Generating…" (duplicate exports). With 0 categories it silently does nothing. | 139-150, 44 | `disabled={loading || selectedCount===0}` + spinner. |
| P1 | Theme | Switch thumb `ON_DARK` on a `PURPLE` (accent) track: a white thumb on a white track on Monochrome. | 114-119 | `thumbColor={theme.onAccent}` or `HapticSwitch`. |
| P2 | Copy | Title Case "Download Your Data", "Download My Data". | 81, 147 | "Download your data", "Download". |

### Login activity — `app/buyer-login-activity.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | A security screen shows fabricated sessions ("MacBook Pro · New York", "Chrome · Windows · Los Angeles") seeded from `SEED_SESSIONS` (lib/accountService.ts:52-56). Users will think they've been hacked. | 26-28 | List real Clerk sessions (`user.getSessions()`), or show only "This device". |
| P0 | Copy | Implementation disclaimers shown to users: "maintained locally and does not represent real-time server sessions", "Revoking the session on the server requires signing in on that device." | 85, 34, 53 | Remove after wiring real sessions. |
| P1 | Copy | The "sign out of all" action is labelled "Sign out of this device", and so is its Alert. | 52, 123 | "Sign out of other devices" / "You'll stay signed in here." |
| P1 | Motion | While loading it renders a blank page with no header. | 69 | Header + skeleton. |
| P2 | A11y | Remove button is 32pt with no label. "Login Activity" and "Saved Devices" are Title Case. | 110, 149, 77, 89 | 44pt, "Sign out of {device}". "Login activity". |

### Muted accounts — `app/buyer-muted.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P2 | Motion | No loading state, and unmute has no error handling. The empty-state line doesn't explain how to mute. | 30-34, 41-45, 92 | "Mute someone from their profile to hide their posts here." |

### Payment methods — `app/buyer-payment-methods.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | A load failure shows "No saved payment methods", which is misleading on a trust screen. | 79-81, 151 | "Couldn't load your cards. Pull to refresh." |
| P1 | Copy | The vendor story is repeated twice on one screen ("stored securely by Stripe", "Brandthread never sees your full card number"), and the empty body has a stray line break. | 145, 153-154 | Keep one line: "Cards you use at checkout are saved here, encrypted by our payment partner." |
| P2 | A11y | The remove button is 34pt with no label, and the brand pill text is 11pt. `BRAND_ICONS` is dead code. | 193-200, 55, 35-42 | 44pt + "Remove card ending 4242". FS.xs. |

### Personal details — `app/buyer-personal-details.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | The email field is hard-coded as "••••@gmail.com" for every user. | 71 | Show the Clerk primary email, masked from the real value. |
| P0 | Copy | Vendor name shown: placeholder "Managed via Clerk" and the note "…managed by Clerk… visit Clerk account settings." | 34, 141 | "Change your email in Login methods." |
| P1 | Motion | Save fires a success haptic before saving, with no spinner and no error handling. The save bar pops in and pushes the layout. There is no KAV, so the bar sits under the keyboard. | 77-91, 146-154 | Await, then haptic. try/catch "Couldn't save changes." Keep the bar mounted but disabled. Add KAV. |
| P2 | Copy | "Personal Details", "Save Changes" in Title Case. The screen is blank while loading. | 101, 150, 93 | "Personal details", "Save". |

### Privacy settings — `app/buyer-privacy-settings.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Server save errors are swallowed (`.catch(() => {})`) and then "Saved / Privacy settings updated." is shown anyway. Tapping Back auto-saves and also pops that Alert. | 74-78, 81-83 | Only confirm on success. Use a toast "Privacy updated". On error: "Couldn't save. Try again." |
| P1 | Consistency | All pickers are `Alert.alert` button lists with Title Case titles ("Profile Visibility", "Friend Requests", "Post Visibility"). | 56-63, 160-164, 178-230, 290-303 | Use a bottom-sheet radio list with sentence case. |
| P1 | Copy | "Followers only" is described as "Only people you follow can send you DMs", which is the opposite relationship. | 284-288, 299 | "People you follow" / "Only people you follow can message you." |
| P1 | Perf | `PickerRow`/`ToggleRow`/`SectionHeader` are defined inside render, so every state change remounts every row. | 86-130 | Hoist them to module scope. |
| P1 | Theme | Switches have no haptic, and the thumb is `ON_DARK` on the accent track (invisible on Monochrome). Static CARD/BORDER/FG. | 114-119, 10-14 | `HapticSwitch`, `theme.*`. |
| P2 | Copy | "Who can..." (three dots), "Search & Discovery", "Blocked & Muted". Every row draws a bottom border, including the last. | 170, 259, 310, 386 | "Who can…", "Search and discovery". Skip the last divider. |

### Report — `app/buyer-report.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | API persistence failure is swallowed but the screen still says "Report Submitted … We'll review this within 24 hours." | 79-95, 110-112 | Treat an API failure as a failure. Success: "Thanks for letting us know" / "We'll review it soon." |
| P1 | Consistency | The close button is a text "×" glyph with no a11y label, and reason chips have no haptic. | 135-137, 174 | Feather `x` IconButton + "Close". Selection haptic. |
| P2 | Copy | "Submitting...", "Submit Report", "Describe what happened...", and the context line "Reporting profile" (raw enum). | 231, 192, 156 | "Sending…", "Send report", "Tell us more…". Map enum → "Reporting an account". |

### Restricted accounts — `app/buyer-restricted.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P2 | Motion | The confirmation "sheet" (it has a handle) uses `animationType="fade"`. There is no loading state or error handling on unrestrict. | 112-120, 37-42 | Use the shared slide sheet. try/catch. |

### Password & security — `app/buyer-security.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Vendor name: "Set up in Clerk account settings." The row shows an external-link icon but isn't tappable (a dead affordance). | 67, 61-70 | Make the row open Login methods. Sub: "Add a second step when you sign in." |
| P1 | Copy | The "Login alerts" and "Save login info" toggles only write local settings and have no effect. | 32-42 | Hide them until wired. |
| P2 | Copy | "Password & Security"; blank screen while loading; RN Switch thumb `ON_DARK`. | 52, 44, 80-85 | "Password and security". |

### Your activity — `app/buyer-your-activity.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | Errors show zeros as if they were real data (`setLoadError(false)` inside the catch). | 78-82 | Set true and render "Couldn't load your activity. Pull to refresh." |
| P1 | Copy | The settings entry promises "Likes, comments, searches, links and time spent", but the screen shows only Posts, Saved and Reposts. `BarChart`/`weeklyTime` are dead code. | buyer-settings.tsx:19, 21-47, 91 | Align the subtitle: "Posts, saves and reposts". |
| P2 | Visual | 3 stat cards with `minWidth: '45%'` lay out 2 + 1 with a stretched third card. | 156 | Use 3 equal columns. |

### QR code — `app/buyer-qr-code.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Visual | The QR is drawn light-on-dark with a gradient on a transparent background. Inverted and gradient codes scan poorly on many Android cameras. | 72-79, 142 | Black modules on a white rounded tile. |
| P1 | Copy | Placeholder "Your Name" shows while loading and when there is no name. With no username, Share sends the generic homepage "Find me on Brandthread! https://brandthread.app". | 115, 35, 41 | Hide the row until loaded. Disable Share without a username. Message: "Find me on Brandthread: {url}". |
| P2 | Visual | Not scrollable: the card + button + info card overflow on iPhone SE. Title Case "QR Code", "Share QR Code". | 60-124, 54, 106 | ScrollView. "QR code", "Share". |

### Shopping preferences — `app/shopping-preferences.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | The literal "&amp;" renders in the section title, because RN doesn't decode HTML entities. | 188 | "Alerts and notifications" |
| P1 | Motion | Mixed save model. Sizes, fit and toggles save instantly (`patch`), but style categories only save via the button, and Back silently discards them. | 92-104, 122 | Save everything instantly and remove the Save bar, or confirm on back. |
| P1 | Copy | New users get fake preferences: "streetwear" and "vintage" are preselected. | 88 | Default to an empty set. |
| P1 | Theme | Switch track `'#333344'`, thumb `'#fff'`; static `CARD/BG/BORDER/FG`; save text `'#FFF'`. | 206-207, 226-227, 240-241, 16, 303 | `HapticSwitch`, `theme.*`. |
| P2 | Consistency | Emoji category icons mixed with Feather. Title Case "Shopping Preferences", "Your Sizes", "Preferred Fit", "Style Categories", "Dark Fashion", "Business Casual", "Save Preferences". Size chips are 36pt tall. | 34-43, 125-169, 275 | Sentence case. 44pt chips. |

### Call screen — `app/call-screen.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Theme | The "Return to messages" button is static `PURPLE` (#F7F7FA) with `#fff` text and icon, so it is invisible on every theme. | 659, 666, 431 | Background `theme.accent`, foreground `theme.onAccent`. |
| P0 | Copy | Dev jargon shown to users: "Calling is not supported in Expo Go or this device build. Use a native Brandthread build…", "not configured for this workspace", "lost its secure connection and could not be renewed. Media was closed." | 216, 237, 252, 155, 324 | "Calls aren't available right now. Keep chatting by message." / "The call dropped. Try calling again." |
| P1 | Copy | Back arrow = hang up, with no confirmation. | 407-413 | Minimise, or confirm "End call?". |
| P1 | Motion | No haptics on mute, camera or hang up. Labels are crammed inside the 68pt circles ("Camera off" at 11-12pt). | 510-565, 710-730 | Put labels under the circles (iOS pattern). Light impact on toggle, heavy on end. |
| P1 | Consistency | Avatar text uses `fontFamily: 'System'` instead of Inter. The caller avatar falls back to "Me" on `#555` because the conversation screen never passes `myInitials`. | 64-65, 103-104 | `FONT.bold`. Pass the user's initials and colour. |
| P1 | Theme | Hard-coded `CALL_DARK '#0A0A14'`, `#111`, rgba reds; static `PURPLE/FG/MUTED`. | 37-40, 576, 611 | `theme.background`, `theme.error`. |
| P2 | Copy | "Share" (screen share) is ambiguous, and the header status says "Unavailable". | 562, 399 | "Share screen". Status: "Call ended". |

---

## Clean / low-risk
- `app/thread-checkout.tsx`: a one-line re-export of buyer-checkout. Clean.
- `app/thread-product-detail.tsx`: a one-line re-export of buyer-product-detail (no trailing newline, so `wc -l` reports 0). Clean.

## Cross-cutting patterns in my slice
- **Accent + white foreground is broken on every preset (8 spots, 5 files).** Preset accents are light and `onAccent` is dark, but code pairs the accent with `ON_DARK`/`'#fff'`. Invisible cases: order-detail "Submit review" (static ACCENT #F7F7FA + #FFF), call-screen "Return to messages", chat/[id] own bubbles, checkout policy tick and "Create an account", the account-center logo, and conversation voice buttons. A grep for `ON_DARK` or `'#fff'` next to `accent`/`PURPLE`/`ACCENT` will find them.
- **Static theme tokens:** 21 of 28 real screens import surface/text colours (`BG/CARD/FG/BORDER/MUTED`) from `lib/theme`, so they ignore the chosen preset. 37 hex literals across 7 files; chat/[id] has its own warm-brown palette.
- **Raw `error.message` shown to users:** 12 occurrences in 7 files (order-detail ×2, addresses, account-control, download-data, chat ×2, call-screen string-matches it).
- **Dead or fake UI:** 16 dead or stub actions (checkout.tsx ×9, order-detail track/help/copy/buy-again, conversation Reply/Copy, chat phone/video) and 4 screens showing fabricated data (seed login sessions, "@jordan"/"Maya Chen"/"Vault Studios", hard-coded "••••@gmail.com", preselected style categories).
- **Vendor or dev jargon:** "Clerk" ×3, "Expo Go", "workspace", "JSON archive", "backend wiring", "Server-side enforcement pending backend", "Managed Markets", "SMART", and a literal "&amp;".
- **Alert.alert:** 71 calls in 17 files, used for pickers (privacy ×7), reactions, message menus, success ("Saved", "Order Cancelled") and every validation error. None of these screens use `Toast`/`InlineFeedback`.
- **Buttons and press feedback:** 371 `TouchableOpacity` in 28 files versus 0 `PressableScale`. Only 1 of 8 screens with switches uses `HapticSwitch` (checkout). Three switch screens have no haptic at all (privacy, report, problem-report).
- **Headers:** only 2 of 28 screens use `ScreenHeader`/`BrandthreadHeader`. The other 26 hand-roll headers with heights 58, 40-44 or none, a mix of `arrow-left` and `chevron-left`, and back targets of 40pt or 36pt.
- **Loading states:** 9 screens render a blank View or a bare spinner with no header while loading (login-activity, security, personal-details, privacy, shopping-prefs, order-detail, return, refund, problem-report). 5 lists flash their empty state before data arrives. 0 skeletons, except checkout.
- **Title Case / ALL CAPS drift:** 60+ labels break the sentence-case rule. Worst offenders: order detail, the return, refund and problem forms, and the settings sub-screens. Also 3 "..." instead of "…" and 4 "Please …" prompts.
