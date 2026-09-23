# Buyer: feed, discover, social & product

[← Back to the punch list](../punch-list.md) · [Design rules](../design-rules.md)

**26 P0 · 93 P1 · 54 P2.** Rows are sorted P0 → P1 → P2 inside each screen. Line numbers are from `dev` @ `7e0f547` and will drift as other branches land. Search for the quoted code if a line has moved.


Scope: `app/(buyer)/*` except `_layout.tsx`, plus buyer-product-detail, buyer-post-viewer, buyer-post-comments, buyer-story-create, buyer-story-viewer, buyer-other-profile, u/[username], buyer-live, buyer-drop-detail, buyer-saved, buyer-highlights-manager, buyer-notifications, buyer-friend-requests, buyer-close-friends and buyer-invite.
Notes: `(buyer)/index.tsx`, `(buyer)/feed.tsx` and `(buyer)/following.tsx` only re-export `(tabs)/feed.tsx` and `(tabs)/following.tsx`. You asked for a check of the feed, so I cover the feed behaviour briefly under "Thread feed" and don't do a full audit of that shared file.
Theme fact behind several P0s: every preset `accent` is a LIGHT colour (monochrome `#F7F7FA`, purple `#D990FF`, gold `#FFD27A`…) and every `onAccent` is DARK (AppThemeContext.tsx:47-59). So any `#FFF`/`ON_DARK` text on `theme.accent` or `primaryGradient` is white on near-white, and any `onAccent` text on a dark surface is dark on dark.

---

### Thread feed (shared) — `app/(tabs)/feed.tsx` via `app/(buyer)/index.tsx`, `app/(buyer)/feed.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Perf | Full-screen paging FlatList has no `windowSize`/`maxToRenderPerBatch`/`initialNumToRender`. With the default windowSize of 21, about 10 pages mount on each side, and each video page calls `useVideoPlayer`, so many decoders stay alive. The active and inactive pause logic itself is correct. | feed.tsx:1750-1762, 759 | Add `windowSize={3} initialNumToRender={1} maxToRenderPerBatch={2} removeClippedSubviews`. Only create the player when `Math.abs(index-active)<=1`. |
| P1 | Perf | `SpotlightPage` is not memoized, and `handleLike`/`handleSave`/`handleRepost`/`handleFollow` depend on `engagements`. Each like therefore recreates every callback and re-renders every mounted page (with video). | feed.tsx:822, 1523-1651, 1802-1843 | Wrap SpotlightPage in `React.memo`. Read engagements from a ref, or use functional `setEngagements` so the callbacks are stable. |
| P1 | Visual | The carousel dots in photo posts never move: `index === 0` is always the active dot. | feed.tsx:911 | Track `onMomentumScrollEnd` in PhotoVisual and highlight the current page. |
| P2 | Motion | The double-tap-like fires the API call inside the `setEngagements` updater, a side effect that runs twice under StrictMode, and never rolls back on failure. | feed.tsx:1542-1552 | Move the API call out of the updater and roll back on catch, the same way `handleLike` does. The heart burst (native driver) is fine. |
| P2 | Perf | The video poster uses RN `Image` (no cache or transition), while the photos use CachedImage. | feed.tsx:775 | Use `CachedImage`. |
| P2 | Theme/Copy | The search empty state hard-codes `#8C8577`, and the placeholder uses "...". | feed.tsx:1774-1775, 1854 | Use `palette.muted`; placeholder "Search creators and pieces…". |

### Product detail — `app/buyer-product-detail.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Theme | The "Buy Now" label is `ON_DARK` (#FFF) on `theme.primaryGradient`. On monochrome that is white on `#F7F7FA→#FFF`, so the main CTA is invisible. On the other presets it is white on a pastel. The spinner is also ON_DARK. | 1492, 1202, 1210 | `color: theme.onAccent` plus `getOnAccentTextStyle(theme)`, as cart.tsx:937 does. |
| P1 | Copy | Cart and bag wording is mixed on one screen: "Added to your bag!" next to "View Cart", "Cannot Add to Cart" and the a11y label "Add to cart". | 771, 848-849, 1112, 1119, 1140, 1149, 1157 | Use "bag" everywhere: "Added to bag", "View bag", "Add to bag", Alert "Couldn't add to bag". |
| P1 | Visual | The add-to-bag action is an icon-only 52px square (the label is screen-reader only). Depop and Instagram Shopping use a labelled button. | 1143-1160 | Show a visible "Add to bag" SecondaryButton, with "Buy now" as the primary. |
| P1 | Visual | The "Added" banner uses a fixed `bottom: 108` that ignores `insets.bottom`. With the home indicator, the action bar is about 110px tall, so the banner overlaps it. | 1497 | `bottom: COMP.buttonH + SP.md + insets.bottom + SP.sm + SP.sm`, passed inline. |
| P1 | Motion | Gallery dots animate `width` with `useNativeDriver:false` on every scroll frame, which drives the JS thread. | 277, 288-298 | Animate `transform:[{scaleX}]` and `opacity` with `useNativeDriver:true`. |
| P1 | Perf | Gallery and related products use RN `Image`/`Animated.Image` with no cache and no placeholder, so a blank card flashes before each photo. | 216-221, 1336 | Use `CachedImage` (blurhash placeholder), or `Animated.createAnimatedComponent(CachedImage)`. |
| P1 | Motion | The loading state is a spinner plus "Loading product…", and related products show a spinner. | 629-631, 1288-1293 | Use a gallery skeleton plus `SkeletonText` rows, and a `ProductGridSkeleton`-style row. |
| P1 | Copy | Generic alerts and a success-as-Alert: "Error" / "Could not join waitlist. Please try again.", "Reserved!", "Error" / "Something went wrong. Please try again.", "Select Options" / "Please select all options…". | 729-730, 745-746, 781, 817 | Use an inline toast. "Couldn't join the waitlist. Try again.", "Spot reserved. We'll let you know when production starts.", "Couldn't start checkout. Try again.", and haptic plus highlight instead of "Select options". |
| P1 | Copy | A network failure shows "Product not found / This product may be unavailable…" with no retry. | 546, 657-659 | Split the two cases. Offline: "Couldn't load this piece." + [Try again]. |
| P1 | Theme | The loading and not-found shells, QtySelector, the gallery bg and the empty text use static `CARD`/`FG`/`BORDER`/`ORANGE`. | 233-235, 437-444, 629, 655 | Use `useThemeAliases()` values. |
| P2 | Copy | Title Case and caps: "Buy Now", "Select Options", "Sold Out", "Reserve (No Charge)", "Pre-Order Item", "Size Chart", "Customer Reviews", "You Might Also Like", "PRE-ORDER", "SALE", "Please select a size", "Independent Seller". | 1211, 1207, 1182, 944, 1061, 1070, 1098, 861, 866, 980, 116 | "Buy now", "Select a size", "Sold out", "Reserve free", "Pre-order", "Size chart", "Reviews", "You might also like", "Pre-order", "Sale", "Select a size", "Independent seller". |
| P2 | Visual | "Report intellectual property infringement" sits as an underlined link directly under the seller name, which is prime real estate. | 879-886 | Move it into a ••• overflow menu: "Report listing". |
| P2 | Copy | Stock is repeated: "Only 3 left in stock" plus the Qty "3 left". | 433, 995 | Keep one: "Only 3 left". |

### Cart — `app/(buyer)/cart.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | This screen is "Cart", but product detail says "bag", the feed header uses a `shopping-cart` icon and product detail uses `shopping-bag`. | 760, feed.tsx:1905 | Title "Bag". Use the `shopping-bag` icon everywhere. |
| P1 | Copy | The empty state is off-brand and mentions caps "SHOP": "Your cart is ready for something great." / "Browse Thread and tap SHOP on products you love." / "Discover Products". | 771-774 | "Your bag is empty" / "Tap Shop on any post to add pieces here." / [Explore] |
| P1 | Motion | `useFocusEffect` sets `loading=true` on every focus, so the full-screen BrandedLoader flashes each time you open the bag. | 533-536, 745-750 | Only show the loader on first load (`hasLoadedRef`) and refresh silently afterwards. |
| P1 | Visual | "Saved for later" rows show a bookmark icon instead of the product photo. | 372-374 | Render `item.imageUri` with CachedImage, the same as CartItemRow. |
| P1 | Visual | The points input sits under the absolute checkout bar and has no KeyboardAvoidingView, so the keyboard covers the input and the Apply button. | 782-796, 848-856 | Wrap in `KeyboardAvoidingView` and use `automaticallyAdjustKeyboardInsets`. |
| P1 | Copy | Raw `error.message` in "Could not apply points", plus a generic "Error / Something went wrong". | 682, 740 | "Couldn't apply points. Try again." / "Couldn't start checkout. Pull to refresh and try again." |
| P1 | Copy | A vendor name is shown: "…require a separate secure Stripe payment for each seller." | 817 | "Items from {n} sellers check out separately — one secure payment each." |
| P2 | Consistency | A bespoke header, even though BrandthreadHeader is imported and unused. | 37, 759-766 | Use `BrandthreadHeader title="Bag"`. |
| P2 | Copy | "Group subtotal:", "Last one left!", and a Feather icon nested inside Text for "Secured by Brandthread". | 339, 175, 944-946 | "Subtotal", "Last one", and an icon in a row View beside the text. |
| P2 | Perf | Line-item thumbnails use RN Image. | 136 | CachedImage. |

### Discover — `app/(buyer)/discover.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Consistency | The "See all" (For you) and "All drops" CTAs both `router.push('/(buyer)/')`, which lands on the Thread video feed rather than a list. | 885, 917 | Route to a product grid and a drops list (for example `/(buyer)/search?filters=…`), or remove the actions. |
| P0 | Consistency | The bookmark on showcase cards only toggles local `savedIds`. Nothing persists, so it resets when you leave. | 230, 312-322 | Call `saveItem({type:'product',…})` (as in friends.tsx:272), or remove the button. |
| P0 | Theme | The no-image fallback puts white (`ON_DARK`) initials on `colorHex = theme.accent` (light), which is invisible on every preset. | 174-175, 202, 329-330, 391, 657, 694 | Background `theme.cardElevated` with `theme.text` initials, or `theme.onAccent`. |
| P1 | Theme | Every row, card and skeleton uses static `CARD`/`FG`/`MUTED`/`BORDER`/`SURFACE`, so a #18181B card sits on a purple or olive background. | 108, 112, 200-205, 384-399, 477-484, 536-541, 570-600, 968 | Build the styles from `theme` (`makeStyles(theme)`). |
| P1 | Motion | The For you skeleton cards are 158px wide, but the real cards are about viewport-54px, so the layout jumps on load. | 599 vs 233 | Size the skeleton with the same `cardWidth` and `sideInset` as the real cards. |
| P1 | Consistency | The bell labelled "Notifications" opens Inbox, while profile opens `/buyer-notifications`. | 842-846 | `router.push('/buyer-notifications')`. |
| P1 | Consistency | Trending rows without `brandId` are still pressable and fire a haptic, but do nothing. | 506-512 | `disabled={!item.brandId}`, or open the post. |
| P2 | Copy | Title Case and robotic subtitles: "High Demand", "For You", "Products moving fast across the platform", "Real-time engagement across the platform", "Could not load high demand products. Tap to retry.". | 855-856, 882-883, 939, 669 | "High demand" / "Moving fast right now", "For you" / "Picked for your style", "Trending" / "What everyone's saving", "Couldn't load this. Tap to retry." |
| P2 | Perf | For you keys use the index (`fy_${i}`), so rows remount on refresh. | 688 | `id: row.id`. |
| P2 | Visual | 11px brand and meta text on dark cards. | 204, 481, 484, 541 | FS.xs is 11. Use 12 for secondary text. |

### Search — `app/(buyer)/search.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Theme | The masonry price pill puts `theme.onAccent` (dark) text on `${theme.background}C7` (dark), so prices are unreadable on every preset. | 512-513 | `color: theme.text`. |
| P1 | Motion | Each MasonryCard calls `RNImage.getSize` and then changes `aspectRatio`, so the columns reflow and jump as images resolve. | 35-42 | Use server width and height when available. Otherwise fix the ratio at 4:5, or use expo-image `onLoad` once, with a fade. |
| P1 | Consistency | "Browse trending brands and drops" and brand results without a sellerId route to `/(buyer)/feed` (the video feed), not Discover. | 230-233, 243, 336 | `router.push('/(buyer)/discover')`. |
| P1 | Visual | The "Following" badge applies `followingBadge` padding and border to both the View and the Text, so it draws a double border. | 410-411 | Put the border on the View only and use `followingBadgeText` alone on the Text. |
| P1 | Consistency | The bookmark on masonry cards is decorative and looks tappable. | 63 | Remove it or make it a real save. |
| P2 | Copy | Hard-coded caps labels "SORT BY", "PRODUCT FILTERS", "RECENT", "DISCOVER", "SUGGESTIONS", "PEOPLE", "BRANDS", "DISCOVERED FOR YOU"; "Price: Low-High"; "Changes apply when you tap Apply." | 283, 290, 315, 332, 347, 379, 421, 447, 286-287, 277 | Sentence case ("Sort by", "Recent"…), "Price: low to high", drop the subtitle. |
| P2 | Consistency | A bespoke Modal filter sheet with its own handle, rather than SheetHandle. Sizes 11 and 11.5 are used. | 258-306, 488, 528 | Use the shared sheet pattern. |
| OK | Perf | The debounce (350ms, cancelled flag, cleared timeout) is correct. | 178-211 | — |

### Friends — `app/(buyer)/friends.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | The "Your story" bubble shows the hard-coded placeholder identity `MY_INITIALS='J'` and `MY_COLOR` (socialService.ts:98-102), not the signed-in user. | 369-370 | Use the Clerk user's avatar and initials. |
| P1 | Perf/Motion | `ListHeaderComponent` and `ListFooterComponent` are inline arrow functions, so the stories row remounts on every like and its scroll position resets. | 355, 490 | Pass elements (`ListHeaderComponent={header}`) built with `useMemo`. |
| P1 | Copy | Load errors are swallowed (`setLoadError(false)`), so offline shows "Find your crew". | 216-221 | Show "Couldn't load activity. Pull to refresh." |
| P1 | Consistency | The bookmark gives no feedback (the icon doesn't change and there's no toast). "Not Interested" does nothing. The options menu is an Alert. | 141-146, 89, 81-91 | Filled or accent bookmark state plus the "Saved" toast. Remove "Not interested" or implement it. Use a sheet. |
| P1 | Consistency | "See all" by Friend activity pushes `/(tabs)/discover` (a seller-stack route), and "See all" by Following opens Friend requests. | 459, 416 | `/(buyer)/discover` and `/connections?type=following`. |
| P1 | Motion | Loading is plain text, "Loading activity…". | 354 | `FeedSkeleton`. |
| P2 | Theme | Static `CARD`/`BORDER`/`FG`, `#fff` text, and `rgba(255,255,255,0.3)`. | 107, 561, 588, 656, 663-665 | Theme tokens. |
| P2 | Copy | "Your Story", "Friend Activity", "Find Friends", "Message Friends", "Not Interested", and the share text "…— check it out!". | 376, 457, 483, 493, 89, 149 | "Your story", "Friend activity", "Find friends", "Message friends", "Not interested", "See {name}'s post on Brandthread". |
| P2 | A11y | Header plus and user-plus icons have no labels, and the message bubble is 24px, nested inside a touchable. | 325-346, 443-448 | Add `accessibilityLabel` and a 44px hit area. |
| P2 | Copy | `timeAgo` shows "0m ago", and the story name is hard-sliced to 8 characters with no ellipsis. | 39, 404 | "now", and rely on `numberOfLines={1}` alone. |

### Inbox — `app/(buyer)/inbox.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Consistency | The compose button opens an Alert, "New Conversation" / "Start a conversation with:", whose only option is Cancel. It is a dead stub. | 195-202 | Open a people picker (reuse search people), or hide the button. |
| P1 | Visual | The Messages tab count is the total number of conversations, shown in RED, so it always looks like an alert. | 410, 504 | Count unread only, in `theme.accent`. |
| P1 | Visual | The notification unread dot is drawn on the compose icon. | 398 | Remove it, or move it to a bell. |
| P1 | Consistency | A back arrow on a tab root, and a bespoke header. | 380-388 | Remove back on the tab root, and use BrandthreadHeader "Messages". |
| P1 | Copy | Errors are swallowed, so an offline Inbox looks empty. "Loading conversations…" text shows even on Follows. | 91-95, 363 | "Couldn't load messages. Pull to refresh." plus a row skeleton. |
| P1 | A11y | Accept and Decline have 4px vertical padding, about 26px tall. | 557-563, 569-578 | `minHeight: 36`, with hitSlop to 44. |
| P2 | Copy | "Error" titles, and "Messages: Start a conversation" with no action. | 148, 170, 52 | "Couldn't accept request. Try again.", "No messages yet" / "Say hi from any profile." |
| P2 | Theme | `#8A8A8E` chevron, `#FFFFFF` initials, static `BORDER`/`CARD`. | 323, 614, 468, 574 | Theme tokens. |
| P2 | Consistency | Long-press archive doesn't update the list, but swipe does. | 183 vs 190 | Reuse `swipeArchiveConversation`. |

### Orders — `app/(buyer)/orders.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | A fetch failure clears the orders and sets `loadError(false)`, so a buyer with orders sees "Your first find is still out there." The error styles exist but are unused. | 234-238, 320-331, 501-569 | Show a banner: "Couldn't load your orders. Pull to refresh." Keep the previous rows. |
| P1 | Copy | The same "first find" empty state appears for every filter (Returns, Shipped…). | 320-331 | Per filter: "No returns" / "Returns you start show up here." |
| P1 | Copy | The tracking label "Exception" is jargon. The "→ Est." arrow reads oddly. | 71, 164 | "Delivery issue", " · Arrives {date}". |
| P1 | Theme | Cards, buttons and `BLUE`/`BLUE_DIM` are static (BLUE resolves to #F7F7FA). | 362-499 | Theme tokens. |
| P2 | Copy | ALL-CAPS status labels ("READY" is ambiguous), "View Order Details", "Track Shipment" (which opens the same screen), "My Orders". | 52-60, 172, 181, 298 | "Ready to ship", "View order", "Track", "Orders". |
| P2 | Consistency | The action buttons are TouchableOpacity nested inside a TouchableOpacity card. | 109, 171-182 | Use PressableScale, with one tappable card and one "Track" button. |

### Profile — `app/(buyer)/profile.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Visual | The posts grid shows a type icon and caption on a flat card instead of the media thumbnail. The Instagram-style grid looks unfinished. | 473-486 | Render `post.mediaUrl` or the poster with CachedImage, with a type badge in the corner. |
| P1 | Perf | The posts grid, reposts and saved tiles are `.map` inside a ScrollView, with no virtualization for heavy posters. | 473, 513, 541 | FlatList `numColumns={3}` with the header as `ListHeaderComponent`. |
| P1 | Motion | BottomSheet returns `null` when not visible, so there is no exit animation and it pops out. | 60-68 | Keep it mounted until the close animation ends, or use the shared sheet. |
| P1 | Visual | The menu sheet has 13 rows with no ScrollView, so it clips on small phones. | 561-577 | Wrap the rows in a ScrollView with `maxHeight: '80%'`. |
| P1 | Consistency | Sign out has no confirmation and swallows errors. Delete post has no confirmation. | 213-217, 233-239 | Confirm sheet: "Sign out of Brandthread?", "Delete this post? This can't be undone." |
| P1 | Copy | Errors are swallowed, and loading is plain text, "Loading profile…". | 178-183, 337-340 | Profile skeleton, plus "Couldn't load your profile. Pull to refresh." |
| P1 | Copy | "Followers" shows `friendsCount`, and "Following" shows `followingBrandsCount`. | 390, 395 | Use real follower and following counts. |
| P1 | Theme | Static `ACCENT` for the primary button border, text and story ring. Static CARD/BORDER. | 605, 642-644, 606-700 | `theme.accent`, `theme.card`. |
| P2 | Copy | Title Case: "Edit Profile", "Share Profile", "Close Friends", "Your Activity", "My Orders", "My Freelancer Jobs", "Rewards & Points", "Saved Items", "QR Code", "Sign Out", "Share Post", "Delete Post", "Create Post", "View Saved". | 403, 563-585, 468, 536 | Sentence case: "Edit profile", "Orders", "Rewards", "Saved", "Sign out"… |
| P2 | Visual | Share appears three times (top bar, action row, menu). The Posts stat is a TouchableOpacity with no onPress. Icon buttons are 36px. | 316, 408, 564, 384, 599 | Remove the row share icon, use a View for Posts, and 44px icon buttons. |

### Edit profile — `app/(buyer)/edit-profile.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Theme | The "New" pill is `#FFFFFF` text on `theme.secondary` (the light accent), so it is invisible. | 390-391, 479 | `color: theme.onAccent`. |
| P1 | Consistency | Save has no pending state. The success haptic fires before any await. The server `updateProfile` is fire-and-forget, so a failure is silent and the user leaves thinking it saved. | 207, 226-250 | Disable and spin "Save". Await the server call, and on failure show "Couldn't save your profile. Try again." |
| P1 | Visual | There is no KeyboardAvoidingView, so the Style badge fields sit under the keyboard. | 267 | KeyboardAvoidingView plus `automaticallyAdjustKeyboardInsets`. |
| P1 | Motion | A blank screen shows while loading. | 253 | A skeleton card of rows. |
| P1 | Consistency | The gender option "Custom" has no input, so it just saves the string "Custom". | 23, 76 | Open a text field when Custom is chosen. |
| P2 | Visual | Chevrons on free-text inputs suggest navigation. Two avatar circles (photo plus camera). The '😎' fallback. | 51, 270-289, 277 | Drop the chevrons, use one avatar with a camera badge, and initials as the fallback. |
| P2 | Copy | "Edit picture or avatar", "Please wait", "Please choose a different username.", "Username may only contain…". | 291, 192, 188, 184 | "Change photo", "Checking username…", "That username's taken.", "Use 3–30 letters, numbers or underscores." |
| P2 | Theme | Static CARD/BORDER/FG and SCREEN_BG. Sizes 11.5, 12.5 and 13.5 are used. | 17, 472-477, 471, 477, 492 | Tokens. |

### Post viewer — `app/buyer-post-viewer.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Visual | The actual post media is never rendered: the screen shows only a colour gradient with a type icon. | 146-151 | Render the image, carousel or video (`post.mediaUrl`) with CachedImage or VideoView. |
| P0 | Theme | The edit-caption "Save" button is `ON_DARK` text on `theme.accent`, so it is invisible. | 374-375 | `color: theme.onAccent`. |
| P1 | Consistency | The post only loads from `getMyPosts()`, so other people's posts show 0 likes and no author handle, and the owner check uses `'me'`. | 68-79, 66 | Fetch by id from the API, and compare with the Clerk userId. |
| P1 | Visual | The edit and delete sheets have no KeyboardAvoidingView (the autofocused input hides Save) and a fixed `paddingBottom: 40`. | 286-310, 366 | KeyboardAvoidingView plus `insets.bottom`. |
| P1 | A11y | Every icon button (back, send, like, comment, repost, save, flag, share) lacks `accessibilityLabel`. Targets are 40px. | 135-140, 186-250, 341 | Add labels and 44px targets. |
| P2 | Consistency | The like colour is `#F472B6` here, RED `#F87171` in friends and comments, and `#EF4444` in stories. | 187-188 | Use one `theme.error` or like token. |
| P2 | Consistency | Two share icons (header "send" and bar "share-2"). Save can't be undone. No double-tap like. | 139, 248, 225 | Keep one share icon, and toggle save. |

### Comments sheet — `app/buyer-post-comments.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Optimistic comments are authored with the placeholder identity "Jordan" / "@jordan" / "J", and the composer avatar shows "J". | 296-299, 458-459 | Use the Clerk user's name, handle and avatar. |
| P1 | Consistency | Long-pressing your own comment deletes it instantly, with no confirmation or undo. The code comment claims "custom inline delete confirm". | 106-110, 282-285 | Action sheet "Delete comment?", or `showUndo`. |
| P1 | Motion | The sheet has a fixed `height: '52%'` inside a padding KeyboardAvoidingView. With the keyboard up on small phones, the list collapses to about 0 and only the emoji row and input stay visible. | 369-372, 529-538 | Let the sheet grow: `maxHeight: '90%'` while the keyboard is shown, or use `keyboardVerticalOffset` and a flexible list. |
| P1 | Copy | The send error says "Tap to retry", but tapping only dismisses it. | 328, 423 | Retry on tap, or change the copy to "Couldn't post. Tap send to try again." |
| P2 | Consistency | The "Choose emoji" smile button only focuses the input. | 483 | Remove it. |
| P2 | Perf | `CommentRow` calls `makeStyles(theme)` (StyleSheet.create) for every row on every render. `ListHeaderComponent` is an inline function. | 99, 399 | Hoist with `useMemo` in the parent and pass the styles down. |
| P2 | Theme | Static CARD/BORDER/SURFACE/CARD_ELEVATED on the sheet and input. | 532, 537, 682, 753, 79-80 | `theme.card`, `theme.border`. |
| P2 | Motion | No haptic on send or like. A comment like never rolls back. | 260-270, 287 | Light haptic, and roll back on failure. |

### Story create — `app/buyer-story-create.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | The server story is created with `authorName: MY_USER_ID` (literally "me"), handle "@jordan" and initials "J". Other viewers see a placeholder author. | 153-158 | Use the Clerk user's display name, username and avatar. |
| P1 | Consistency | "Open advanced editor — add text, links, GIFs" jumps to `/create-post` and drops the selected media. | 322-336 | Pass the media URIs through, or remove the link. |
| P1 | Visual | A selected video shows a generic play icon plus "12s · ready to post", with no preview frame. | 277-283 | Show a VideoView or thumbnail preview. |
| P1 | Consistency | Server persistence is fire-and-forget, so a failed upload is silent but the story still "posts" locally. | 152-162 | Await the call and show "Couldn't share your story. Try again." |
| P1 | Consistency | The audience picker is an Alert. | 374-380 | Use a sheet with radio rows. |
| P2 | Copy | "Error" / "Failed to post story. Please try again.", "Tap to type...", the close button is a "×" character, and "Story" as the title. | 166, 240, 182, 184 | "Couldn't share your story. Try again.", "Type something…", a Feather `x` icon, "New story". |
| P2 | A11y | 28px colour dots with no labels, and a 36px close button. | 618-622, 423-426 | 44px hit area plus `accessibilityLabel`. |

### Story viewer — `app/buyer-story-viewer.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Consistency | The reply input has no send button and no `onSubmitEditing`, so replies go nowhere. Typing doesn't pause the story, which keeps advancing. | 353-359 | Add a send action (DM to the author), and pause on focus. |
| P0 | Visual | Video slides are rendered as `<Image source={{uri: videoUri}}>` (story-create stores the video in `imageUri`), so video stories never play. | 201-206, create:128 | Use VideoView for `type==='video'`, and base the duration on the clip. |
| P0 | Consistency | In the Options Alert, "Mute" and "Block" do nothing. The product tag Alert's "Shop" just goes back. | 336-343, 323-327 | Wire them to muteUser and api.social.block, and open `thread-product-detail?productId=`. |
| P0 | Theme | Link stickers put `#FFF` text on `${theme.accent}E0` (light), so they are unreadable. | 667, 675 | `color: theme.onAccent`. |
| P1 | Motion | The progress bar animates `width %` with `useNativeDriver:false`, and `progress.setValue(0)` runs whenever `isPaused` changes, so hold-to-pause restarts the slide from zero on release. | 158-170, 294-304 | Animate `scaleX` with the native driver, keep the elapsed value, and resume from `progress.__getValue()`. |
| P1 | Visual | The bottom reply bar is absolute with no keyboard handling, so the keyboard covers it. | 350-390 | KeyboardAvoidingView around the bottom bar. |
| P1 | Visual | There is no close (X) button. An expired or missing story leaves a black screen with nothing but swipe-down. | 180-184, 334-346 | Add an X to the top bar. Empty state: "This story's no longer available." + [Close]. |
| P1 | Copy | The placeholder text "Story content" is visible on slides with no media. | 214 | Remove it. |
| P2 | Consistency | Views are tracked only for the first story, so later stories stay "unviewed" in the tray. | 89-93 | Call `trackStoryView` on every `storyIdx` change. |
| P2 | Copy | "Reply to {name}...", "Loading story…" text. | 357, 182 | "Reply to {name}…", and a black screen with a thin progress skeleton. |

### Other user profile — `app/buyer-other-profile.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | The handle and initials come only from route params, falling back to "@unknown" and "?", and are never replaced by the loaded profile. Opening from Inbox → Follows (which passes only userId, inbox.tsx:213) shows "@unknown" permanently. The avatar colour falls back to `ACCENT` with white initials (invisible). | 48-52, 226, 234, 350 | Derive them from `profile.username` and `displayName`. Fallback avatar: `theme.cardElevated` with `theme.text`. |
| P0 | Consistency | Grid cells are plain Views, so posts can't be opened. | 290-300 | Make them pressable and route to the post viewer. |
| P1 | Motion | Follow isn't optimistic. The button swaps to a differently styled spinner box (CARD outline), then to Primary or Secondary, so it flickers. | 115-134, 180-185 | Flip the state optimistically, keep the same button with an inline spinner, and roll back on error. |
| P1 | Consistency | Block has no confirmation. Mute and Restrict give no visible feedback (haptic only). | 155-171 | Confirm "Block {name}?", and toast "Muted" or "Restricted". |
| P1 | Copy | "No bio yet." shown on other people's profiles, "No posts yet.", and "Error" / "Could not update follow status.". | 237, 287, 130, 147, 169 | Hide an empty bio. "No posts yet", "Couldn't follow. Try again." |
| P1 | Motion | No skeleton: the counts show 0 and then jump. | 69-75, 247-262 | Skeleton the stats until `apiLoaded`. |
| P2 | Consistency | A floating "Messages" inbox pill on someone else's profile duplicates the Message button. | 206-212 | Remove it. |
| P2 | Perf/Theme | RN Image grid plus ScrollView map. Static CARD/BORDER/ACCENT. | 294, 291, 339, 349, 384 | CachedImage, FlatList, theme tokens. |

### Public profile link — `app/u/[username].tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P2 | Copy | "Something went wrong" plus "Could not load this profile. Check your connection." | 390, 282 | "Couldn't load this profile" / "Check your connection and try again." |
| P2 | Motion | Signed-in visitors see a "Loading profile…" spinner, then `replace` to buyer-other-profile, which loads again (a double load, and the avatar has no initials or colour). | 322-334, 312-316 | Pass `initials` and `color` and prefetch, or render the other-profile directly. |
| P2 | Copy | "Member on Brandthread". | 118 | "On Brandthread". |

### Live — `app/buyer-live.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Raw `e.message` is shown to buyers in the join failure Alert and in the purchase sheet errors. | 139, 216, 271 | "Couldn't join the live. Try again.", "Couldn't load this piece.", "Couldn't start checkout. Try again." |
| P1 | Visual | The purchase sheet with 7 inputs has no KeyboardAvoidingView, so the address fields sit under the keyboard. | 405-478 | KeyboardAvoidingView around the sheet plus `automaticallyAdjustKeyboardInsets`. |
| P1 | Motion | A seller "highlight" auto-opens the purchase sheet over the stream and resets any half-filled form. | 165-169, 201-205 | Pulse the product chip instead, and never reset open-sheet input. |
| P1 | Copy | The dev-ish placeholder "Live video available on device" and the double "Stream ended" (an Alert plus the ended screen). | 315, 123 | "Connecting…", and drop the Alert. |
| P1 | Consistency | The success is an Alert, "Order confirmed". | 266-268 | Inline success state in the sheet: "You got it. Order {n} is confirmed." |
| P2 | Copy | "BUY WITHOUT LEAVING LIVE", and the web copy "…device video technology that is not enabled in the browser.". | 410, 43 | "Buy without leaving", "Live video works in the Brandthread app." |
| P2 | A11y/Visual | The close X is 36px with no label. Sizes 11 and 12 on the overlays. | 339-341, 497-514 | 44px plus "Leave live". |

### Drop detail — `app/buyer-drop-detail.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Visual | Load failure or a missing drop renders an empty View with no back button (a dead end). | 212 | "Couldn't load this drop." + [Try again] [Back]. |
| P1 | Perf | Two independent 1s `setInterval` countdowns (Countdown plus the parent `useCountdown`) re-render the whole screen, hero video included, every second. | 61-83, 96, 187 | Compute `isLive` once in the parent and pass it down, or memoize the hero. |
| P1 | Visual | The header bell shows `bell-off` when subscribed, which reads as notifications off. | 233 | `subscribed ? 'bell' (filled or accent) : 'bell'` plus an a11y state. |
| P1 | Copy | Every error is reported as "Sign in to get drop alerts". | 202-203 | Branch on 401. Otherwise: "Couldn't update alerts. Try again." |
| P1 | Visual | Product tiles have no price. | 133-151 | Add a price line. |
| P2 | Copy | Many ALL-CAPS eyebrows ("THE DROP OPENS IN", "DAYS", "PRE-ORDER EDITION", "EST. SHIP", "PREVIEW THE COLLECTION"…), and the raw lowercase category (for example "apparel") shown as the label. | 98-119, 146, 252, 308-339 | Keep one editorial caps style via a token, and title-map the categories. |
| P2 | Consistency | Tiles route to `/buyer-product-detail`, while the rest of the app uses `thread-product-detail`. | 350 | Use `push('/thread-product-detail…')`. |

### Saved — `app/buyer-saved.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Consistency | Tapping a saved item opens the Alert "Saved Item" with "View", which has `onPress: () => {}` and does nothing. | 81-101 | Tap opens the item (post, product or store). Long-press opens a sheet with "Remove from saved". |
| P1 | Visual | Tiles are colour gradients with an icon, not the saved photo. | 112-132 | Use the saved item's image. |
| P1 | Motion | Plain "Loading saved items…" text. | 200 | `ProductGridSkeleton columns={2}`. |
| P2 | Copy | "Follow stores to save them and get updates." (following is not saving). The header bookmark is decorative. | 77, 167-169 | "Save stores to find them fast." Remove the icon. |

### Highlights manager — `app/buyer-highlights-manager.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Perf/Motion | `HLFormModal` is declared inside the component, so each keystroke (`setLabel`) creates a new component type and remounts the Modal and autofocused TextInput. The keyboard flickers and focus drops after every character. | 160-212, 245-256 | Hoist HLFormModal to module scope and pass the state as props. |
| P1 | Consistency | The emoji picker Modal opens on top of another Modal, which iOS won't present. Delete has no confirmation. | 171, 257-261, 104-108 | Inline the emoji grid in the same sheet, and confirm "Delete highlight?". |
| P1 | Visual | The form sheet has no KeyboardAvoidingView (autoFocus), so Save is hidden. | 165-209 | KeyboardAvoidingView. |
| P1 | Consistency | Highlights are only an emoji plus a label. There is no way to add stories, so profile highlights open this manager rather than content (profile.tsx:434). | 91, profile:434 | Add a "Choose stories" step, or hide highlights until it exists. |
| P2 | Copy | "Story Highlights", "New Highlight", "Edit Highlight", "Cover colour" (British spelling vs "color" elsewhere). | 220, 247, 253, 186 | "Highlights", "New highlight", "Edit highlight", "Cover color". |

### Notifications — `app/buyer-notifications.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | The long-press option interpolates the raw category key: "Mute seller_updates notifications". | 289 | Map to labels: "Mute {Social/Orders/Messages/Seller updates/Products/Offers} alerts". |
| P1 | Motion | `loadNotifs` sets `notifLoading=true` on every focus and every socialService event, so a full-screen loader overlays the list each time. | 218-234, 459-463 | Show the loader only on first load and refresh silently. |
| P1 | Consistency | drop_live, price_drop and restock notifications open Discover instead of the product or drop, and orders open the list instead of the order when there's no `targetType`. | 136-156 | Route by `targetId` to `thread-product-detail` or `buyer-drop-detail` or `buyer-order-detail`. |
| P1 | Theme | Rows use a static `BG` (#0A0A0B) and unread rows a static `CARD`, so the rows mismatch the purple, olive and maroon backgrounds. | 352, 561 | `theme.background` and `theme.card`. |
| P2 | Consistency | Long-press options are an Alert. The back button has no size or label. Errors are swallowed. | 266-297, 407, 223 | Use a sheet, a 44px back button with `accessibilityLabel="Back"`, and an error state. |

### Friend requests / Connections — `app/buyer-friend-requests.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Consistency | "Follow" on a suggestion only calls the local `sendFriendRequest` ("demo suggestions") and flips the pill to "Following". It never follows on the server. | 136-142, 309-318 | `await api.social.follow(sug.userId)`, optimistic with rollback. |
| P1 | Consistency | "Dismiss" is local only, so dismissed followers reappear on the next focus. Unfollow has no confirmation. | 118-120, 123-133 | Persist the dismissal, and confirm "Unfollow {name}?". |
| P1 | Copy | Request terms applied to follows: the tabs "Incoming" and "Sent", and the title "Connections". | 154-157, 338 | Tabs "Follow back", "Following", "Suggested". Title "Find friends". |
| P1 | Perf | Followers lists use `FlatList scrollEnabled={false}` inside a ScrollView, so there is no virtualization. | 174-177, 237-240, 369 | Use one FlatList per tab as the scroller. |
| P2 | Copy | Errors are swallowed and show empty states. "Error" / "Could not follow back.". | 94-96, 111, 129 | "Couldn't follow back. Try again." |
| P2 | A11y | 32px buttons, and header icons without labels. | 400-408, 332-344 | 36px plus hitSlop, and labels. |

### Close friends — `app/buyer-close-friends.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | The banner reads like a spec: "…get priority in notifications and future close-friends features…". | 91-93 | "Only you can see this list. People aren't notified when you add or remove them." |
| P1 | Consistency | The list comes from the local `getAcceptedFriends()` while the Friends screen hard-sets `friends=[]` (friends.tsx:210), so this screen is effectively always "No friends yet" with no action. | 33-36, 122-127 | Source from `api.social.following()`. Empty-state action: [Find friends]. |
| P2 | Theme | Static BG save bar, CARD search. "Close Friends" title. | 166, 152, 84 | Tokens. "Close friends". |

### Invite — `app/buyer-invite.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | Load failure is swallowed, so it shows code "------", and "Share invite link" silently does nothing (`invite` is null). | 55-57, 79-80, 131 | Error state: "Couldn't load your invite. Try again." + [Retry]. |
| P1 | Consistency | Copying the link shows the success Alert "Copied!". | 76 | Toast "Link copied". |
| P1 | Theme | The hero gradient ends in a static `BG` (#0A0A0B), so a black band appears on coloured themes. `#22C55E` is hard-coded. | 115, 136-138 | `[theme.accentDim, 'transparent']`, `theme.success`. |
| P2 | Copy | "Invite Friends", "Invite to Brandthread", "Copied!", and 500 points hard-coded in the copy. | 103, 121, 139, 123 | "Invite friends", "Bring your friends", "Copied", read the points from the API. |

---

## Clean / low-risk
- `app/(buyer)/index.tsx`, `app/(buyer)/feed.tsx`, `app/(buyer)/following.tsx`: thin re-exports only (their behaviour is in `(tabs)/feed.tsx` and `(tabs)/following.tsx`).
- `app/u/[username].tsx`: solid states (loading, not-found, error, landing), safe-area correct. Only P2 copy.
- Search debounce (search.tsx:178-211) and feed video pause/play on visibility (feed.tsx:768-771) are implemented correctly.

## Cross-cutting patterns in my slice
- **Light-accent contrast bugs: 7 places.** White (`ON_DARK`/`#FFF`) text sits on `theme.accent` or `primaryGradient`, which is light on every preset: product-detail Buy now, post-viewer Save, edit-profile "New", story link sticker, discover fallback initials, other-profile fallback avatar. One place has the reverse (dark `onAccent` on the dark background): the search price pill. Fix: always pair accent surfaces with `theme.onAccent`, and add a lint rule.
- **Placeholder identity leaks (P0).** `MY_NAME='Jordan'`, `MY_HANDLE='@jordan'`, `MY_INITIALS='J'` and `MY_USER_ID='me'` from socialService.ts:98-102 are shown or sent in 4 files (friends, post-comments, post-viewer, story-create; story-create even posts `authorName:'me'` to the server).
- **Dead or fake actions: 11.** Inbox compose, discover See all/All drops/bookmark, saved "View", story Mute/Block/Shop/reply, friends "Not interested", friend-requests suggestion Follow, other-profile grid, search card bookmark.
- **Swallowed errors that look like empty states: 9 screens.** friends, inbox, orders, profile, notifications, friend-requests, invite, drop-detail, story-viewer. Several set `setLoadError(false)` in the catch.
- **Static theme tokens.** 21 of 23 audited files import static `BG`/`CARD`/`FG`/`BORDER` from lib/theme for surfaces (only cart and search are fully runtime-themed).
- **Alert.alert: 58 calls in the slice** (cart 10, product-detail 10, edit-profile 5, inbox 5…), several of them for success ("Reserved!", "Copied!", "Order confirmed", "You're on the waitlist") or as option menus.
- **Press feedback.** 215 `<TouchableOpacity>` vs PressableScale in 1 file (cart). Spinners (`ActivityIndicator` in 9 files) or plain "Loading…" text (friends, inbox, profile, saved, story-viewer, product-detail) are used where skeletons belong.
- **Images.** RN `Image` in 10 display files vs CachedImage in 3 (discover, search, comments). Profile and post viewer don't render post media at all.
- **Keyboard handling missing on 7 input surfaces.** Cart points, edit-profile, post-viewer caption, story-viewer reply, highlights sheet, live purchase sheet; the comments sheet has fixed-height issues.
- **Wording drift.** cart vs bag (product-detail mixes both; the feed header uses a `shopping-cart` icon, while PDP and the cart empty state use `shopping-bag`). Title Case on about 45 labels. Hard-coded ALL-CAPS eyebrows in search, orders, drop and live. "Please"/"Error"/"Something went wrong" in 12 alerts. `useNativeDriver:false` in 2 places (PDP dots, story progress).
