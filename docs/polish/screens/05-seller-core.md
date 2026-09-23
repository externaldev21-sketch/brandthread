# Seller: home, orders, customers & profile

[← Back to the punch list](../punch-list.md) · [Design rules](../design-rules.md)

**36 P0 · 88 P1 · 37 P2.** Rows are sorted P0 → P1 → P2 inside each screen. Line numbers are from `dev` @ `7e0f547` and will drift as other branches land. Search for the quoted code if a line has moved.


Auditor slice: `app/(tabs)/*` (excluding `_layout.tsx`) plus the root seller screens listed in the brief. Everything below was read in source; line numbers were checked. One file outside the slice, `components/SellerHomeCommerceDashboard.tsx`, is included because `(tabs)/index.tsx` renders it as the whole seller home (see the first section).

**Top-level summary of what's wrong in this slice:** three root causes produce most of the problems.
1. **Mock screens that look live.** Hardcoded numbers, fake customers, fake notifications and buttons that only fire a haptic are shipped in Marketing, Shipping, Shipping & delivery, Customers, Customer accounts/events/privacy and the feed notification sheet.
2. **A demo data layer behind real money actions.** `services/orderService.ts` holds seller orders in AsyncStorage and starts empty; the API never fills it. Shipping label, refund and return screens read from it, so a real order shows "Order not found", or the screen fakes a refund.
3. **Errors that look like empty states.** Orders, products, inbox, reviews and the dashboard all swallow fetch errors and show "no orders / $0.00 / all caught up".

---

### Seller home (wrapper) — `app/(tabs)/index.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Perf | `dashboardLayout` is hard-set to `'commerce'`, so the whole legacy UI (about 350 lines) never renders. It still fires 8 API calls on every mount (analytics.dashboard, quoteRequests, sampleOrders, threads, inventory, finance.balance, orders.list, products.list, analytics.revenue) and throws the results away. `SellerHomeCommerceDashboard` then fetches its own data. | index.tsx:345-409, 597-606 | Delete the legacy branch (606-955) and every fetch except `loadSetup`. The home screen does twice the network work for nothing. |
| P1 | Motion | Skeleton/content shape mismatch. The loading skeleton is a legacy 2×2 KPI grid plus two icon buttons (577-586). The real dashboard is a "Dashboard" title plus range pills and **3 full-width stacked tiles**, so the page visibly re-lays-out when `loadSetup` resolves. | index.tsx:568-593 vs SellerHomeCommerceDashboard.tsx:449-526 | Let `SellerHomeCommerceDashboard` own its skeleton, and render it immediately while setup loads, not a different skeleton. |
| P2 | Perf | A no-op `setTimeout(() => {}, 500)` named `minLoad`. | index.tsx:338 | Remove it. |
| P2 | Consistency | Dead code still holds Title Case copy ("Net Revenue", "Needs Attention", "Finish Setup", "Quick Actions", "Share Your Store", "Post a Drop"), `Alert.alert('Notifications','No new notifications.')` and chart `useNativeDriver:false`. It will be copied again if anyone revives it. | index.tsx:615, 664, 698, 737, 818, 844, 178 | Delete with the legacy branch. |

### Seller home dashboard (actual UI) — `components/SellerHomeCommerceDashboard.tsx` (rendered by `app/(tabs)/index.tsx`)

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | An analytics failure is silently replaced with `zeroSellerHomeAnalytics`. A seller who is offline, or hitting a 500, sees "$0.00 total sales", "0 orders" and a green "All caught up", which is false data on the first screen. | SellerHomeCommerceDashboard.tsx:224-230, 667-674 | Keep an `error` state. Render the tiles as "—" and show an inline banner: "Couldn't load your sales. Pull to refresh." Never show "All caught up" unless the fetch succeeded. |
| P1 | Motion | No pull-to-refresh, and no refetch on focus. Tabs use `freezeOnBlur`, so after fulfilling an order and coming back, "N orders to fulfill" is stale until the range pill is changed. | SellerHomeCommerceDashboard.tsx:428-441, 211-235 | Add `<RefreshControl>` (tint `theme.accent`), and refetch analytics and balance in `useFocusEffect`. |
| P1 | Motion | Every range change flashes the skeleton: `selectSellerHomeAnalytics` returns null for the new key. The Withdraw button and the whole "Needs attention" block unmount while `loading` is true (`data && !loading`), so the page jumps by about 180px on every pill tap. | :209, 544, 612 | Cache snapshots per range and keep the previous range's data visible (dimmed) while loading. Gate only on `data`, not `!loading`. |
| P1 | Visual | The KPI "grid" is a column: `statGrid.flexDirection:'column'` stacks three 82px-high tiles full width, so Total sales, Orders and Visitors fill the first viewport and push the chart below the fold. | :793-807 | Make it a row: `flexDirection:'row'`, `statTile.flex:1`, with "Total sales" spanning 2 columns or sitting on top. That's the Shopify/Depop pattern. |
| P1 | Motion | Chart bars pop in with no animation and change height instantly between ranges. The empty state shows ghost bars behind an opaque overlay. | :587-607 | Animate a `scaleY` transform from 0 to 1 (native driver) with a 250 ms `ANIM.base`, staggered 20 ms. |
| P1 | Copy | Button says "Withdraw", the confirm alert says "Cash out", and the a11y label says "Withdraw available balance". The icon is a literal "$" text glyph. | :562-565, 312, 319 | Use one verb everywhere: button "Cash out", with the Feather `arrow-down-circle` icon. |
| P1 | Consistency | Cash-out success and all errors use `Alert.alert`. | :364-367, 388 | Use the Toast: "{amount} is on its way to your bank." |
| P1 | Copy | "Pending Balance" / "Available Balance" are Title Case. The no-balance alert is robotic: "Money still processing will move from Pending Balance to Available Balance when it can be paid out." | :530, 536, 307 | "Pending" / "Available". Alert body: "Nothing to cash out yet. Pending money becomes available after delivery." |
| P1 | Theme | The action card, setup list, count badges, chart track and range-pill defaults use static `BORDER` (7%) and `SELLER_DASHBOARD_GLASS` from lib/theme, and the check icon is hardcoded `#41C72A`. Only some elements have runtime overrides, so on olive or maroon themes the cards read as a different material from the stats card. | :972-976, 1063-1068, 1047-1055, 905-911, 670 | Pass `palette.border` and `palette.glass` to every card, as `statsCard` does at :487. Use `theme.success` for the check. |
| P2 | Visual | Counts are not locale-formatted: `{orderCount}` and `{visitorCount}` render "12345". | :511, 522 | `orderCount.toLocaleString()` |
| P2 | Visual | Badge and count text is 11px. | :1020, 1061 | FS.xs is fine, but use FONT.semibold at 12 for tabular numbers. |
| P2 | Copy | The setup "..." options sheet is an `Alert` with a destructive "Dismiss". | :409-415 | Use an action sheet; label "Hide from checklist" (not destructive). |

Radial create menu (`SellerStudioRadialMenu.tsx:181-221`): springs have a damping ratio of about 0.95, use the native driver, and have Medium haptics on open. Motion is clean, with no overshoot. It is not a finding.

### Orders tab — `app/(tabs)/orders.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | `DB_STATUS_MAP` has no `delivered`, `refunded` or `disputed` keys, and the default is `'new'`. Delivered and refunded orders therefore show a **"NEW" badge and a green "Accept" quick action and swipe** in the list. The detail screen maps the same statuses correctly (order-detail.tsx:73-83). | orders.tsx:151-158, 172 | Share one status adapter with order-detail. Add `delivered:'delivered', refunded:'refunded', disputed:'disputed', refund_pending:'cancelled'`, and default to `'cancelled'`/neutral, not `'new'`. |
| P0 | Copy | Every row hardcodes `paymentStatus: 'paid'` and `returns/disputes: []`. The "Unpaid" chip is always 0, the green "Paid" pill shows on pending, voided and refunded orders, and RETURN/DISPUTE badges can never appear. | :190, 211 | Derive payment status the way order-detail.tsx:88-99 does. Hide the Unpaid chip until the list API returns payment state. |
| P0 | Copy | A fetch failure clears the list, and "Your orders will show up here." is shown to a seller who has orders. `updatesPaused` is set after 3 failures but never rendered. | :620-633, 590, 881-889 | Keep the last good list on error, and render a banner: "Couldn't refresh orders. Pull to try again." |
| P1 | Motion | `loading` is never read. On first open the empty state ("Your orders will show up here.") flashes before rows arrive. | :588, 981 | While `loading && !hasLoadedRef.current`, render 6 skeleton rows (reuse `LoadingSkeleton` at height 76). |
| P1 | Copy | The search box has a map-pin icon and the placeholder "All locations · Search orders" (Shopify multi-location copy), but no location filter exists. | :929-934 | Remove the pin. Placeholder: "Search orders or customers". |
| P1 | Copy | Robotic abbreviations and all-caps tags: "Part. Refunded", "Mfg Pending", "Mfg Fulfilled", "MFG", "NEW", "RISK", "RETURN", "DISPUTE", "PRE-ORDER", "High Risk". | :86, 98, 275-276, 353, 360, 365, 370, 409, 414 | "Partly refunded", "With manufacturer", "Made by manufacturer", "New", "Review", "Return", "Dispute", "Pre-order", "High risk" (sentence case, no caps). |
| P1 | Copy | Vague errors: `Alert.alert('Error','Could not update order.')` ×2 and 'Could not bulk update orders.' ×2. | :724, 734, 766, 777 | Title "Couldn't update order", body "Check your connection and try again." |
| P1 | Consistency | The "..." menu is an `Alert` with "Export CSV / Bulk Actions / Refresh". "Bulk Actions" opens another Alert: `('Bulk','Long-press orders to select.')`. The title chevron opens a third Alert as a view picker. | :804-811, 807, 901-906 | Use one bottom sheet (the same component as Sort/Filter). Drop "Bulk actions" and show a one-time hint row: "Tip: press and hold an order to select several." |
| P1 | Visual | Quick-action pills use three different gradients (accent, accentLight→secondary, success→secondary), with 11px icons and about 24px-tall hit areas. | :435-466, 1395-1400 | One style: a solid `theme.accent` pill 32px high with a 14px icon. Swipe already covers the fast path. |
| P1 | A11y | The search box and filter/sort buttons are 36×36, below the 44pt target. | :1115, 1124-1127 | Height 44 (or `hitSlop` 4) to match `COMP.iconBtn`. |
| P1 | Perf | `OrderRow` calls `createStyles(theme)` (a full `StyleSheet.create`) per row instance. The 30-second poll rebuilds every Order object, so all rows re-render and `renderItem` is recreated whenever `selectedIds` changes. | :309, 658, 614, 825-858 | Hoist styles to the screen and pass them down. Wrap `OrderRow` in `React.memo`. Skip `setOrders` when `updatedAt`s are unchanged. |
| P1 | Motion | A full swipe past 64px fires Accept/Ready immediately, with no undo and no visible success. The row springs back and changes only after the reload. | :827-857; SwipeActionRow.tsx:65-72 | Show an undo toast: "Order accepted" [Undo]. Optimistically update the row status. |
| P2 | Theme | The "Ready" swipe/quick action paints `theme.onAccent` text on `theme.accentLight`, which is not the accent. On gold or olive presets that can fall below 3:1. | :831, 449-451 | Use `theme.accent` for all swipe backgrounds, or `theme.text` on accentLight. |
| P2 | Consistency | `renderSectionHeader`, `ListEmptyComponent` and `ListHeaderComponent` are memoised with `[]` or partial deps but read `s`, so they keep stale styles after a theme switch. | :818-823, 881-889 | Add `s` to the deps. |
| P2 | Copy | "Sort Orders" / "Filter Orders" titles, "Export CSV", "Orders Export". | :505, 547, 806, 798 | "Sort by", "Filter", "Export CSV" → "Export as CSV". |

### Orders redirect — `app/orders.tsx`
| Pri | Area | Issue | Where | Fix |
|---|---|---|---|---|
| P2 | Motion | Renders `null` and then `router.replace` in an effect, which gives a blank frame. This duplicate is a redirect, not a second UI, so it has no visual drift. | orders.tsx:6-9 | Use `<Redirect href="/(tabs)/orders" />` from expo-router. |

### Order detail — `app/order-detail.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Consistency | The primary CTA "Buy Label" / "Buy Shipping Label" opens `shipping-label`. That screen reads the demo `orderService.getOrder`, whose seller store starts empty, so **every real order shows "Order not found."** | :954, 960, 1328 → shipping-label.tsx:75, 171 | Load the order through `api.orders.get(id)` + `adaptApiOrder` in shipping-label. Until then, hide "Buy label". |
| P0 | Copy | "Accept Dispute" shows a success alert saying the dispute "has been accepted and the customer will be refunded" **without calling any API**. | :1549 | Wire it to the disputes API, or remove the button. Confirm copy: title "Accept this dispute?", body "The buyer gets a full refund of {amount}. You can't undo this.", buttons "Keep disputing" / "Accept and refund" (destructive). |
| P0 | Copy | Dev text is visible: "Return label issuance available in production build." | :1485 | Remove the button, or wire it. |
| P0 | Consistency | Dead buttons on the Customer tab. "Message Customer" shows an Alert telling you to open the inbox; "View Profile" says "Customer profile details will appear here." | :1086-1087 | "Message" → `router.push('/seller-conversation?…')`. "View customer" → `/customer-orders?customerId=`. Otherwise remove both. |
| P0 | Copy | Raw `e.message` is shown in 7 error alerts titled "Error". | :541, 547, 553, 559, 579, 619, 631, 644 | "Couldn't update this order. Check your connection and try again." (cancel: "Couldn't cancel this order…") |
| P0 | Consistency | "Deny" return uses `Alert.prompt`, which is iOS-only, so it does nothing on Android. | :1481 | Use an inline TextInput sheet, like return-detail.tsx:276-300. |
| P0 | Copy | Notes and note pins are local only ("no API endpoint"). The 15-second poll replaces `order`, so a note the seller adds **disappears within 15 s**. Note type "customer" implies the buyer sees it, but nothing is sent. | :586-605, 651-658, 480-482 | Persist notes via the API, or hide Notes and "Add internal note" until it exists. |
| P1 | Consistency | Action hierarchy for `ready_to_ship` has four buttons: Primary "Buy Label", Secondary "Add Tracking", Secondary "Mark Shipped", Secondary red "Cancel Order". "Save & Mark Shipped" becomes a second primary when expanded. | :957-971, 988 | One primary: "Buy label". Secondary: "Add tracking" (which ships on save). Move "Cancel order" into the header "..." menu as a destructive item. |
| P1 | Copy | Cancel modal: title "Cancel Order", buttons "Go Back" / "Confirm Cancel". A red confirm that says "Cancel" next to "Go Back" is ambiguous. | :791, 822-824 | Title "Cancel this order?" Buttons "Keep order" / "Cancel order". Warning: "Cancelling doesn't refund the buyer. Issue the refund from the Payment tab." |
| P1 | Copy | "Order cancelled successfully." ("successfully" is banned). The banner uses hardcoded `#1A3A2A`. | :763, 1865 | "Order cancelled." Use `theme.success + '22'` as the background. |
| P1 | Copy | The pinned system note carries an emoji and the vendor name: "⚠️ … Please verify in your Stripe dashboard and issue a manual refund if needed." | :295 | "The automatic refund may not have gone through. Check Payouts and refund the buyer if needed." |
| P1 | Copy | Hero badges use `status.replace(/_/g,' ').toUpperCase()` ("READY TO SHIP", "PARTIALLY REFUNDED"). The meta line reads "Source: app · Brandthread · USD". The risk badge shows a Feather icon plus "⚠ High Risk", and it also shows for *medium* risk. | :900-901, 905-911, 912-916 | Human labels ("Ready to ship"). Drop the source line. Risk: "High risk" only when `riskLevel==='high'`, with one icon. |
| P1 | Copy | "View Tracking" dumps the tracking number into an Alert. | :977 | Open the carrier tracking URL, or the existing Tracking Events modal (`setTrackingModalShipmentId`). |
| P1 | Visual | Estimated delivery is a raw text field with the placeholder "YYYY-MM-DD". | :1253-1266 | Use a date picker. Label "Estimated delivery". |
| P1 | Consistency | The Returns and Disputes tabs are always empty: the adapter hardcodes `returns: [], disputes: []`. That's 2 of 8 tabs showing "No Return Requests" / "No Disputes" forever. | :285-287, 316-325 | Hide those tabs until the API returns data. Then use EmptyState copy "No returns" / "Nothing to handle here." |
| P1 | Motion | First load is a full-screen `ActivityIndicator` on a transparent background, with no header or back button. | :673-679, 1670 | Render the header and a skeleton hero card plus 3 rows. |
| P1 | A11y | The back button (36×36) and the 8 tab items have no `accessibilityLabel` or role. | :715, 733-739, 1674 | `accessibilityLabel="Back"`, `accessibilityRole="tab"`, `accessibilityState={{selected}}`, 44×44. |
| P2 | Copy | Title Case throughout: "Mark Ready to Ship", "Payment Breakdown", "Amount Held" (always shown, orange, even at $0.00), "Add Internal Note", "Group 1 — Seller Fulfilled", "Order delivered · Read-only". | :953, 1103, 1113, 1421, 1287, 984 | Sentence case. Hide "Held" when 0. "Group 1" → "Your shipment". "Delivered" with no "Read-only". |
| P2 | Visual | The "Picked / Packed" checkboxes look tappable but are not. | :1309-1318 | Render them as static status text, or make them toggles. |

Money formatting is consistent: all amounts go through `formatCents` (`usd()` at :338). No `toFixed` money was found.

### Products tab — `app/(tabs)/products.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Perf | `loadProducts` depends on `searchQuery`, so **every keystroke** triggers a network fetch and a full-screen skeleton overlay. It also runs twice on mount (useEffect + useFocusEffect). | :391-410 | Debounce search to 300 ms and filter locally. Drop the `useEffect` that duplicates `useFocusEffect`. |
| P1 | Motion | Each reload lays a `ProductGridSkeleton` (a grid) over the existing row list, `pointerEvents="none"`, so the list flickers every time the tab gains focus. | :658-662 | Show the skeleton only when `products.length === 0`, and use a row skeleton that matches `ProductRow`. |
| P1 | Copy | A fetch error clears the list and shows "Your first product starts here." to a seller who has products. | :397-399, 520-529 | Keep the old list and show "Couldn't load products. Pull to refresh." |
| P1 | Motion | No pull-to-refresh on the FlatList. | :621-630 | Add `refreshControl`. |
| P1 | Consistency | "Duplicated" success uses `Alert.alert` ×2. Archive, unarchive and duplicate have no error handling. | :182, 416, 162-172 | Toast: "Duplicated as a draft". Wrap the calls in try/catch with "Couldn't archive. Try again." |
| P2 | Consistency | The title-chevron view picker and the "..." menu are `Alert`s. The bespoke header does not match other headers. | :539-543, 559-563 | Use the shared sheet pattern. |

### Feed (buyer/seller thread) — `app/(tabs)/feed.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | The Notifications sheet is hardcoded fake data: "NXGEN liked your comment on Ripstop Cargo Trousers", "Meridian Co. started following you", "@street.era replied to your comment". `hasUnread` starts `true`, so every user sees a fake unread dot. | :1952-1954, 1290 | Load real notifications, or route to `/notifications`. Initial `hasUnread` = false. Empty copy: "No notifications yet" / "Likes, follows and replies land here." |
| P1 | Perf | Ten runway MP4s plus posters (**30 MB** in assets/videos) are `require`d at module scope for `__DEV__`-only preview posts, so they ship in the production bundle. | :282-312, 1474-1476 | Move the previews into a dev-only module loaded with a guarded `require` inside `if (__DEV__)`. |
| P1 | Perf | Full-screen paged video FlatList with no `windowSize`, `maxToRenderPerBatch` or `removeClippedSubviews`. Every mounted `SpotlightPage` creates a `useVideoPlayer`, and the default window keeps about 21 pages mounted. | :1750-1762, 759 | `windowSize={3}`, `initialNumToRender={1}`, `maxToRenderPerBatch={2}`, `removeClippedSubviews`. |
| P1 | Visual | Videos use `contentFit="contain"`, which letterboxes feed videos. The poster is an RN `Image` with `resizeMode="contain"`. | :775-785 | `contentFit="cover"` (TikTok standard). Use expo-image for the poster with `transition={150}`. |
| P1 | Consistency | The top-left **user avatar** icon opens Notifications. | :1869-1880 | Use a `bell` icon with `accessibilityLabel="Notifications"`. |
| P1 | Theme | The search empty state uses hardcoded warm grey `#8C8577`. The live page background is `#0a0209` and the media placeholder is `#17131D` (purple-tinted). | :1774-1775, 651, 2042 | `MUTED` / `theme.background` / `theme.card`. |
| P2 | Copy | "Search creators, products..." uses three dots. "High Demand" is Title Case. | :1854, 145 | "Search creators or products…", "High demand". |
| P2 | Consistency | FontAwesome (comment, share) is mixed with Feather icons on the same rail. | :1020, 1076 | Use Feather `message-circle` / `send`. |

### Profile tab (seller's own) — `app/(tabs)/profile.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | A verified check (`check-circle`, accent) is shown next to **every** seller's name, whether or not they are verified. | :306 | Render it only when `profile.verified`. Otherwise show nothing, or a subtle "Get verified" link to `/seller-verification`. |
| P1 | Consistency | Post grid tiles have no `onPress` (dead). They show caption text on a card instead of the media thumbnail. | :423-440 | Show `CachedImage` of the cover with a video icon overlay. Tap → post detail. |
| P1 | Motion | No skeleton: "My Brand", initials and "Free Plan" render first and then swap to real data. Everything loads only on mount, with no focus refresh or pull-to-refresh, so edits made on `/edit-profile` don't show. | :210, 240, 304, 327-329, 145-154 | Skeleton the name, pill and stats until `profile` loads. Add `useFocusEffect(loadPage)` + `RefreshControl`. |
| P1 | Theme | The static stylesheet uses lib/theme `CARD`, `BORDER`, `SURFACE`, `FG`, `MUTED` for cards, stat dividers, the grid, the sheet and inputs (36 uses). | :557-690 (e.g. 577, 619, 633, 652, 668, 681) | Use `createStyles(theme)`. |
| P1 | Perf | Posts are rendered with `.map` in a ScrollView, and the list is unbounded. | :415-442 | FlatList with `numColumns={3}`. |
| P2 | Copy | "No posts yet. Create your first post!" / "No drafts saved." / "Free Plan" / "Pro Plan". Stats show "—" for 0 followers but "0" for likes. Stats are touchable with no handler. | :454-456, 322-328, 340-349 | "No posts yet" + [Create post]; "Free plan"; show "0" consistently; drop the TouchableOpacity. |
| P2 | Perf | The avatar uses RN `Image`. | :287 | expo-image / CachedImage. |

### Analytics — `app/(tabs)/analytics.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | 2 of the 3 segments ("14 Days", "Custom") are stubs: they fetch nothing and show "Detailed analytics for this range aren't available yet." with "—" values. "Leads" is always 0 and Traffic sources is always "No data yet". | :256-258, 416-419, 576-578, 584, 431 | Ship only "7 days" until the API supports other ranges. Remove the Leads and Traffic sources cards. |
| P1 | Consistency | Custom dates use `Alert.prompt` "Enter date as YYYY-MM-DD" on iOS. On Android it falls back to an Alert with "Use today" / "Use 7 days ago". | :467-521 | Use the DateRangePicker component (components/DateRangePicker.tsx exists). |
| P1 | Motion | A full-screen spinner reading "Loading analytics" (no ellipsis) appears on first load *and every segment change*. | :389-390, 524-531 | Skeleton the stat cards and chart. Keep the old data visible on segment change. |
| P1 | Theme | The static stylesheet uses `SCREEN_BG`, `CARD_GLASS`, `BORDER`, `FG`, `MUTED` from lib/theme (21 uses). Chart grid lines use static `BORDER`. | :607+, 152 | Use `useColors()` or `createStyles(theme)`. |
| P2 | Perf | Dead render-time ref code ("useEffect replacement…"). | :446-459 | Delete. |
| P2 | Visual | Y-axis label shows "$1.0k". | :146 | Drop the trailing ".0": "$1k". |

### Marketing — `app/(tabs)/marketing.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | **The whole screen is mock data.** It shows fake campaigns ("Summer Drop 2025", "$2,840"), fake discount codes (SUMMER20, VIP50), a fake social calendar, "Push Subs 8.1k", and "124 active referrers · $3,240 earned total". Automation switches only flip local state. It is reachable from More → Marketing. | :13-37, 106, 230 | Replace it with real data: discounts API, Klaviyo counts. Empty states: "No campaigns yet" / "Connect Klaviyo to send your first email." Otherwise remove the route from More and Settings. |
| P0 | Consistency | The "New +" (×2) and "Add Post" section actions, discount copy icons and the referral card have no handlers. | :139, 165, 184, 226-232 | Wire them or remove them. |
| P2 | Visual | `Platform.OS==='web' ? 67` top-pad hack. The root is transparent. It has a bespoke back button that pushes `/(tabs)/more`. | :59, 76-89 | Use `ScreenHeader`. |

### More (hidden tab) — `app/(tabs)/more.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | A hardcoded **"PRO"** badge shows for every user. Profile tab shows "Free Plan" for the same user at (tabs)/profile.tsx:328. | :199 | Show the real plan from `useSubscriptionPlan()`: "Free", "Starter", "Growth". |
| P1 | Consistency | **This duplicates `app/seller-settings.tsx`** (its comment says "same as old More screen"), and the two have drifted. seller-settings adds Vacation Mode, Review Reports, Boost Posts, Invite Friends, Download My Data, App theme and Delete Account; More has none of these. | more.tsx:45-94 vs seller-settings.tsx:50-96 | Keep one source (`lib/sellerNavSections.ts`) and render it in both, or delete one route. |
| P1 | Copy | "Sign out" has no confirmation. The error is `Alert('Error','Failed to sign out. Please try again.')`. | :157-166, 234-240 | Confirm: "Sign out of Brandthread?" [Cancel] [Sign out]. Error: "Couldn't sign out. Try again." |
| P2 | Copy | "Continue setup →" routes to /settings rather than the checklist, and still shows at 100%. Items are Title Case ("Store Builder", "Taxes and Duties", "Help & Support"). | :212-219, 45-83 | Hide at 100%; route to home. Sentence case. |

### Studio (hidden tab) — `app/(tabs)/studio.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Theme | Template cards use saturated hardcoded gradients (sky blue, indigo, teal, orange). The "Go Live" tool uses `#FF3B30`. Both clash with the monochrome and runtime themes. | :98-102, 74-75 | Use real template thumbnails, or `theme.primaryGradient`. Live red is OK as a semantic colour, but take it from `theme.error`. |
| P1 | Visual | Tool descriptions have no `numberOfLines`, so grid cards have uneven heights. Project thumbnails are the same accent gradient for every project. | :253, 288-293 | `numberOfLines={2}` plus `minHeight`. Show the project preview image. |
| P2 | Copy | Arrow glyphs in copy ("Open →", "New project →", "Tap to open →", "View all →", "Browse all →"). "Create Content" / "Film and edit Seller posts". "My Projects". | :215, 255, 266, 300, 323, 81-82, 207 | Drop the arrows and "Tap to open". "Create content" / "Film and edit posts". "My projects". |
| P2 | Motion | The Recent projects spinner changes the section height. Errors fall back silently to "No projects yet". | :270-273, 152 | Skeleton 2 rows. |

### Following (hidden tab) — `app/(tabs)/following.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | The page is titled "Following", but it lists *all* public drops (`api.publicDrops.list()`), not drops from followed sellers. | :172, 239 | Filter to followed sellers, or retitle it "Drops". |
| P1 | Consistency | The header `user-plus` button has no onPress, and the avatar-row items only fire a haptic. | :243-245, 253-254 | Wire them to find sellers / seller profile, or remove them. |
| P1 | Perf | Every DropCard runs its own 1 s `setInterval` countdown, even for off-screen cards. | :60-65 | Use one shared 1 s ticker via context, and pause off-screen cards (`onViewableItemsChanged`). |
| P1 | Theme | Seller colours are a hardcoded rainbow (`#0EA5E9`, `#BE185D`, …). The static `BG`, `BORDER`, `FG` and `SCREEN_BG` are used throughout. | :71, 79, 237-239, 293-318 | Use neutral `theme.card` avatars with the seller image. Use runtime tokens. |
| P2 | Copy | "Live Now", "Shop Drop", "View Drop" (Title Case). Initials use `slice(0,2)` of the brand name ("TH" for "Threadhaus"). | :103, 128, 180 | "Live now", "Shop drop", "View drop". |

### Return request (alias) — `app/return-request.tsx`
Clean: it is a re-export of `buyer-return-request` (buyer slice).

### Return detail — `app/return-detail.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Consistency | It runs entirely on the demo `orderService` (AsyncStorage). A real order can never be found, and actions only mutate local demo data. It is only reachable from order-detail's always-empty Returns tab. | :111-129 | Move it to the returns API (`api.returns.*`, already used by shipping.tsx:52), or remove the route. |
| P0 | Copy | Fake success Alerts with no API: "A message will be sent to the customer…", "Store credit will be issued…", "An exchange order will be created…". "Issue Return Label" shows an alert *and* marks the label issued without creating one. | :264, 317-318, 324, 361 | Remove these buttons until they are wired. |
| P1 | Visual | Loading and not-found are bare centred text ("Loading…" / "Return not found.") with no header or back button. The root is transparent. | :133-139 | Use a header, a skeleton, and EmptyState "Return not found" with a [Back] button. |
| P2 | Theme | Gradient ends are hardcoded (`#34D399`, `#F87171`, `#60A5FA`). The static stylesheet uses 29 lib/theme tokens. | :260, 303, 340, 412+ | Use runtime tokens. |

### Refund (issue) — `app/refund-detail.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | "Issue Refund" calls the **demo** `createRefund`. No money moves: a timeline entry reads "(demo)", and a `setTimeout` marks the refund complete. The UI then says "Refund Initiated … Processing time: 3–5 business days." | :155-165, 181-196; orderService.ts:692-727 | Call the real refund API, or remove the route. Never show a success state for a simulated refund. |
| P0 | Consistency | **No confirmation before a money-moving action.** The primary button submits straight away. | :374-380 | Confirm: "Refund {amount} to {buyer}?" / "This can't be undone." [Cancel] [Refund {amount}] (destructive). |
| P1 | Copy | "Error" / "An unexpected error occurred." A notice uses the `demoNotice` style and says "Refunds are processed via Stripe". | :169, 172, 214-218 | "Couldn't issue this refund. Nothing was charged. Try again." Notice: "Refunds go back to the buyer's original payment method." |
| P2 | Copy | "Refund Issued" header vs "Refund Initiated" title vs "submitted" body. | :181, 187-189 | Header "Refund", title "Refund on its way", body "{amount} back to the buyer in 3–5 business days." |

### Dispute detail — `app/dispute-detail.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | "Accept Dispute (Concede)" shows a fake success ("…the customer will be refunded"). "Submit All Evidence" is an Alert only. "Attach Files" says "File attachment will be available in the next release." (a coming-soon stub). | :381-388, 403-404, 357 | Wire or remove. Confirm copy is in the order-detail row. Remove "Attach files" until uploads work. |
| P0 | Copy | Raw `err.message` in "Error" alerts. "payment processor" is shown as jargon. | :196, 213, 404 | "Couldn't submit evidence. Try again." / "…to the card network for review." |
| P1 | Consistency | Falls back to the demo `orderService` ("Legacy path … demo data"). "Message Support" is an Alert telling you to open the inbox. | :134-140, 393-394 | Remove the fallback. Route "Contact support" to `/help`. |

### Shipping — `app/shipping.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Fake data shown as real: stats "8 / 24 / 384" and Returns "6" as the fallback, a fake "Active Shipments" list (Jordan Lee, Maya Chen, SH-8821…), and fake warehouses ("East Coast Hub … 85% full"). | :14-24, 138-142, 169+, 269+ | Derive stats from `api.orders.list()`. Remove the warehouses. Empty state: "No active shipments" / "Buy a label on an order to start tracking." |
| P0 | Consistency | Four dead quick actions (Print Labels, Add Carrier, Returns, Pickup) with no onPress. | :153-163 | Remove them, or wire them. |
| P0 | Copy | "Add Rate" (a **setup-checklist task**) uses nested `Alert.prompt`, which is iOS-only and dead on Android. It asks the seller for "Flat Rate (cents)" / "Enter the flat rate in cents (e.g. 499 for $4.99)". | :69-105 | Use a sheet with Name + "Price" currency input ("$4.99"), converted to cents in code. |
| P1 | Copy | Raw `e?.message` in the error. "Shipping & Fulfillment" / "Labels, carriers & returns". | :94, 126-127 | "Couldn't save this rate. Try again." "Shipping". |
| P1 | Consistency | **Duplicates `shipping-delivery.tsx`**, a second, different shipping settings screen reachable from Settings. The two show contradictory carrier and rate info. | shipping.tsx vs shipping-delivery.tsx | Merge into one "Shipping" screen. |

### Shipping label — `app/shipping-label.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Consistency | Reads the demo `orderService.getOrder`, so it shows "Order not found." for real orders (see order detail). Rate and purchase also go through orderService. | :15, 73-79, 164-174 | Load via `api.orders.get`, and verify that `getShippingRates` / `purchaseShippingLabel` hit the real API. |
| P1 | Copy | "Copy Tracking Number" shows the number in an Alert instead of copying it. | :259-260 | `Clipboard.setStringAsync` + Toast "Tracking number copied". |
| P1 | Copy | `err?.message` in "Rates unavailable" / "Could not void label". "Fetching rates..." uses three dots. "RECOMMENDED" and "FROM" are all caps. | :99, 145, 453, 468, 318 | "Couldn't load rates. Check the package details and try again." "Getting rates…" "Best value". "From". |
| P2 | Copy | Funding notice: "…Brandthread will not fall back to a card." is legalistic. | :305-307 | "Paid from this order's earnings. No card needed." |

### Shipping and delivery — `app/shipping-delivery.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | **A static Shopify clone with fake data:** "Tapstitch - Dropshipping", "220 products · 1 location · 30 zones", "2 profiles", "3 rules", "1 box", a 👕 emoji, USPS/UPS chips in hardcoded brand colours. | :62-150, 84-90, 125-129 | Remove the route from Settings until it's real, or feed it from shipping rates. |
| P0 | Consistency | Every row and button only fires a haptic (`onPress={haptic}`): Add custom profile, Connect carrier account, Local delivery, Pickup in store, Templates, and the underlined "split shipping" link. | :69, 76, 87, 99, 114, 138, 157, 165, 181, 186 | Same as above. |
| P1 | Motion | Six accordions toggle with no animation (instant height jump). | :35-40 | Use a `LayoutAnimation` easeInEaseOut on toggle, or Reanimated layout. |

### Customers — `app/customers.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Fake stats and programs: "Total 1,240", "VIP 84", "CLV $480", "Retention 42%", "Loyalty Program … 840 customers enrolled · $3.2k rewards issued", and "Rewards & Gifts" (312 wishlists, $4,800 gift cards…). | :94-103, 118-120, 199-215 | Compute Total and spend from the customers API. Remove the Loyalty and Rewards sections. |
| P0 | Consistency | Segment chips (All, VIP, Returning, At-Risk) set state that the list never reads. "Manage" has no handler. | :141-152, 123 | Filter by segment, or drop the chips. Remove "Manage". |
| P1 | Copy | Subtitle "CRM, loyalty & rewards" is jargon. "Loading customers...", "Search customers...", "No customers found." | :76-77, 130, 158, 162 | Subtitle "People who've bought from you". Use "…". Empty: "No customers yet" / "Your buyers show up here after their first order." |
| P1 | Perf | Customer list is `.map` inside a ScrollView (unbounded). | :166-195 | FlatList. |
| P1 | Copy | Errors silently keep the old or empty data. | :55-57 | Inline error row: "Couldn't load customers. Pull to refresh." |
| P1 | Consistency | **Two customer screens:** More/Settings "Customers — Browse your customer list" routes to `/customer-accounts` (a sign-in settings page), while this list is only reachable through studio shortcuts. | seller-settings.tsx:76, more.tsx:65 | Point "Customers" at `/customers`. |

### Customer accounts / events / privacy — `app/customer-accounts.tsx`, `app/customer-events.tsx`, `app/customer-privacy.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Static Shopify-style settings with fake values: account URL "https://brandthread.app/70327206006/account", a "Klaviyo … Server/Web · Optimized" pixel, "Brandthread Network Intelligence — Enabled". | customer-accounts.tsx:121-124; customer-events.tsx:55-70; customer-privacy.tsx:71-79 | Remove the three routes from Settings until they're backed by an API. |
| P0 | Consistency | Every "Customize", "Manage", "Change domain", "Sort", "Learn more" and "Additional Services Terms" link only fires a haptic. Switches don't persist. | customer-accounts.tsx:60, 71, 82, 115, 121; customer-events.tsx:22, 44, 56; customer-privacy.tsx:44, 88, 103, 125, 136 | Same as above. |
| P2 | Theme | Android `thumbColor '#FFFFFF'` and a `#0B0B0B` pixel icon background. | customer-accounts.tsx:37; customer-events.tsx:52 | Use theme tokens. |

### Customer orders — `app/customer-orders.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Consistency | Order rows are plain Views with no link to order detail. | :200-228 | Make each row pressable → `/order-detail?id=`. |
| P1 | Consistency | Status badge colours differ from every other orders screen: `cancelled` is `error` (red) here but `neutral` in order-detail. `pending` is `neutral` here but `new`=`info` elsewhere. The label is the raw lowercase DB value ("pending"). | :47-54, 222-225 vs order-detail.tsx:342-354 | One shared `orderStatusBadge(status)` in `lib/` used by all 4 screens, with human labels. |
| P1 | Theme | Static lib/theme `BG`, `CARD`, `BORDER`, `FG`, `MUTED` in the stylesheet (21 uses). | :236+ | Use runtime tokens. |
| P2 | Copy | "Order History" (Title Case). Spinner on a blank screen. | :138, 74 | "Orders". Skeleton. |

### Seller public profile — `app/seller-profile.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Consistency | In the owner's post action sheet, "Open post", "Pin post", "Archive post", "Save post" and **"Delete post"** only close the sheet. "Copy link" shows "Link copied" without copying anything. | :917-923 | Wire them to the posts API and the clipboard, or remove the rows. Put "Delete post" behind "Delete this post?" / "This can't be undone." |
| P1 | Theme | 67 static lib/theme token uses (`BG`, `CARD`, `BORDER`, `FG`, `MUTED`, `ACCENT`), plus the `rgba(10,10,11,0.72)` pill and hardcoded `avatarColor '#0F766E'`. This is the buyer-facing storefront, so it ignores the seller's and viewer's themes. | :28-31, 126, 950, 938+ | Use `createStyles(theme)`. |
| P1 | Motion | Full-screen spinner "Loading seller profile…". | :592-598 | Skeleton the header, stats and a 3×2 grid. |
| P1 | Consistency | Owner view duplicates the Profile tab with different actions ("Edit Profile / Messages / Create Post" here vs "Go Live / Create Post / My Profile / Messages" there). | :731-737 vs (tabs)/profile.tsx:355-388 | Route owners to `/(tabs)/profile`, or share one header component. |
| P2 | Perf | RN `Image` for avatars (×3). | :262, 643, 652 | expo-image. |

### Seller reviews — `app/seller-reviews.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | `error` is set but never rendered, so a failure shows "No reviews yet". | :173, 190-191, 259-263 | "Couldn't load reviews. Pull to refresh." |
| P1 | Perf | Reviews are `.map` in a ScrollView with no pull-to-refresh. | :249-268 | FlatList + RefreshControl. |
| P2 | Copy | "My Reviews", "Post Reply", "Error". The placeholder uses "...". | :220, 150, 66, 126 | "Reviews", "Post reply", "Couldn't post your reply. Try again.", "Write a public reply…". |

### Seller inbox — `app/seller-inbox.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | `loadError` is set but never rendered, so a failure shows "No messages yet". | :58, 118-121, 257-264 | Banner: "Couldn't load messages. Pull to refresh." |
| P1 | Motion | Spinner, then list. The back button has no a11y label. | :253-256, 231-240 | Use 6 skeleton conversation rows and `accessibilityLabel="Back"`. |

### Seller conversation — `app/seller-conversation.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Motion | Non-inverted FlatList plus `scrollToEnd({animated:false})` on every content-size change. It jumps on open and on each 15 s poll (:204), and `groupByDate(messages)` is recomputed every render. | :626-635 | `inverted` list with reversed data. Memoise the grouped rows. |
| P1 | A11y | Back, call, video, attach, camera and mic buttons have no `accessibilityLabel`. | :567-603, 660-690 | Add labels: "Back", "Voice call", "Video call", "Attach", "Photo or video", "Record voice message". |
| P1 | Copy | "Failed to send message. Please try again." / "Unable to send message." / "Error: Could not read video file." The order status badge shows the raw value. | :502-508, 298, 614-615 | "Message not sent. Tap to retry." / "You can't message this buyer." / "Couldn't read that video." Human status label. |
| P2 | Visual | The input row keeps `insets.bottom` padding while the keyboard is open, leaving a gap above the keyboard. | :561-564, 655 | Use `insets.bottom` only when the keyboard is hidden, or `KeyboardAvoidingView` with `keyboardVerticalOffset`. |
| P2 | Perf | Chat photos use RN `Image`. "Reply..." uses three dots. | :377, 389, 695 | expo-image; "Message…". |

### Seller settings — `app/seller-settings.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Consistency | Duplicates `(tabs)/more.tsx` (see above). It includes "Review Reports — Moderate flagged content" → `/admin-reports`, an admin tool, in seller settings. | :50-96, 82 | Single nav source. Show admin rows only for staff roles. |
| P1 | Consistency | "Customers — Browse your customer list" routes to `/customer-accounts`. | :76 | → `/customers`. |
| P2 | Copy | Mixed casing in one list: "Store Builder", "Download My Data", "Delete Account" vs "App theme". | :56-94 | Sentence case for all. |

### Seller verification — `app/seller-verification.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | A platform config error is shown to sellers: "Stripe Identity not enabled / Your Stripe account needs Stripe Identity enabled. Log in to your Stripe Dashboard → More → Identity to activate it." | :154-157 | "Verification is unavailable right now" / "We're on it. Try again later or contact support." (and log it). |
| P1 | Copy | "Error" titles ×3. Title Case "Identity Verification", "Verified Seller Badge". | :129, 159, 181, 194, 227 | "Couldn't start verification. Try again." "Identity verification", "Verified badge". |

### Go live / Live — `app/seller-go-live.tsx`, `app/seller-live.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | Raw `e?.message` in "Could not start live". | seller-go-live.tsx:85 | "Couldn't go live. Check your connection and try again." |
| P1 | Copy | When the native Agora module is missing, the host sees "Camera preview available on device" while the stream is actually live. | seller-live.tsx:252-255 | Block go-live when the module is unavailable, with "Live needs the latest Brandthread app." |
| P1 | Motion | End stream swallows `live.end` errors, then fires a Success haptic and navigates anyway. | seller-live.tsx:227-233 | On failure: "Couldn't end the stream. Try again." |
| P2 | Theme | `LIVE_RED '#FF3B30'` and many `#fff` / `rgba` literals over the camera. Acceptable over video, but `LIVE_RED` should come from `theme.error`. | seller-go-live.tsx:16-17; seller-live.tsx:19 | Use `theme.error`. |

### Data export — `app/seller-data-export.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Shows a raw device path: `Alert('Export ready', 'Saved to file:///data/user/0/…/cache/brandthread-export-….json')`. | :63, 76 | "Export ready. Open it from the share sheet." Always fall back to `Sharing`. |
| P2 | Copy | "Export My Data" (Settings calls it "Download My Data"), "Generate Export", "Export ready!". | :94, 161, 173 | "Download your data", "Create export", "Export ready". |

### Vacation mode — `app/vacation-mode.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | Emoji Alert titles used as success toasts: "🏖 Vacation Mode Active" / "✅ Store Reopened". Raw `e?.message` on error. | :60-68 | Toast: "Vacation mode on" / "Your store is open". Error: "Couldn't save. Try again." |
| P1 | Visual | Return date is a raw "YYYY-MM-DD" text field. The placeholder says "We're away until [date]. Thank you for your patience!" | :139-149, 132 | Date picker. Placeholder: "Back on June 3. Orders ship when I return." |
| P2 | Consistency | Bespoke save button (`#fff` text) instead of PrimaryButton. The focus refetch overwrites unsaved edits. | :174-180, 217, 35-48 | PrimaryButton label "Save". Don't refetch when the form is dirty. |

### Users (team member) — `app/users.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | Raw `err.message` in "Error" alerts. | :81, 107 | "Couldn't change this role. Try again." / "Couldn't remove this member. Try again." |
| P2 | Copy | "Change Role", "Recent Activity", "Member not found." with no way back. | :182, 200, 127 | "Change role", "Activity", EmptyState with [Back]. |

---

## Clean / low-risk
- `app/return-request.tsx`: a pure re-export of the buyer screen.
- `app/orders.tsx`: a redirect only; one P2 above, and no UI drift.
- `components/SellerStudioRadialMenu.tsx` motion: near-critically damped springs, native driver, haptics. Fine.
- Money formatting across the slice goes through `formatCents`. No ad-hoc `toFixed` dollars, except the analytics axis label (P2).

## Cross-cutting patterns in my slice
- **Mock/demo UI that looks real: 9 screens** (marketing, shipping, shipping-delivery, customers, customer-accounts, customer-events, customer-privacy, the feed notifications sheet, and the "PRO" badge in more). More than 25 hardcoded fake numbers, names or IDs, and more than 30 controls whose `onPress` is only a haptic or nothing.
- **The demo `services/orderService.ts` sits behind 4 money/fulfilment screens** (shipping-label, refund-detail, return-detail, dispute-detail fallback). Seller orders there start empty and are never synced, so the order-detail primary CTA "Buy label" dead-ends at "Order not found."
- **Errors shown as empty states: 8 screens** (dashboard, orders, products, seller-inbox, seller-reviews, customers, studio projects, following). Two of them (`loadError`, `updatesPaused`) compute an error flag and never render it.
- **Fake success with no API call: 9 instances** (order-detail Accept dispute, dispute-detail Concede and Submit all, return-detail ×4, refund-detail demo refund, seller-profile "Link copied").
- **`Alert.alert` in this slice: 90 calls.** At least 18 are success or info messages that belong in a Toast. 14 show raw `e.message` / `err.message` (order-detail ×8, dispute ×2, users ×2, go-live, vacation). 4 flows depend on the iOS-only `Alert.prompt` (order-detail deny, analytics custom date, shipping add rate ×2).
- **Status badge drift across 4 order screens.** `cancelled` is neutral in order-detail and red in customer-orders. `ready_to_ship` is purple in detail and warning in the legacy home. The list lacks `delivered`/`refunded`/`disputed` entirely. There is no shared `orderStatusBadge()`.
- **Duplicated screens that have already drifted: 5 pairs.** `(tabs)/more` vs `seller-settings`, `(tabs)/profile` vs `seller-profile` (owner view), `shipping` vs `shipping-delivery`, `customers` vs `customer-accounts` (the nav label points at the wrong one), and the legacy vs commerce dashboard inside `(tabs)/index`.
- **Static lib/theme tokens that ignore the runtime theme: 11 files** (analytics, feed, following, profile, customer-orders, refund-detail, return-detail, seller-profile, vacation-mode, plus the SellerHomeCommerceDashboard cards). That is about 280 static-token style uses, plus 160 hex/rgba literals (feed alone has 80).
- **Spinners where a skeleton belongs: 17 full-screen or section `ActivityIndicator`s** across 14 files, versus skeletons in only 2 files (the dashboard and products). Only 6 of the 34 screens have pull-to-refresh.
- **Title Case copy on buttons and headings: more than 60 strings** ("Mark Ready to Ship", "Confirm Cancel", "Save Changes", "Sort Orders", "Pending Balance"…). The brand voice asks for sentence case.
