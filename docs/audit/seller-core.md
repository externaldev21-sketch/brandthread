# Seller core — screen audit (6/10)

How this was checked: I read each screen's code and rendered it in the web harness (`?bt_preview=seller`, fresh and `&demo=1`, 393×852). I also tapped through order → detail → Ship → packing, product card → detail → "…", the Products/Orders header "…" menus and the Profile "…" menu. Items marked **[FIXED]** are fixed in this PR and were re-rendered after the fix. Everything else is still open.

The seller swipe menu itself (SellerStudioRadialMenu, the swipe gesture, silver bar, glow, page loading) and the tab bar were **not touched**. Of the menu's destinations, only Add product is in this area, and it is audited below. Payouts, Analytics, Content, Community, Customers, Go Live, Create post, Manufacturer Hub and the design tools are covered by other audit areas. A mouse drag in headless Chromium doesn't fire the swipe gesture, so the swipe menu was not exercised here. That is a limit of the harness, not a missing menu.

**Dashboard** (app/(tabs)/index.tsx → components/SellerHomeCommerceDashboard.tsx, SellerDashboardRecentOrders.tsx, SellerDashboardSections.tsx, lib/sellerDashboardStats.ts)
- [FIXED] Every Recent orders row said "0 items". The normalizer read a non-existent `listItemCount` field, but `GET /api/orders` returns `itemCount`. This affected real accounts, not just preview. A test is added.
- [FIXED] Amounts in Recent orders were cut to "$" or "$18…" whenever the row also had a status badge. The value/badge column was capped at 38% and the amount was the item that shrank.
- [FIXED] The order subtitle wrapped mid-phrase ("BT-18204 · 1 / item"). "2 items" now stays together.
- "Continue setup · 88%" and "Launch your store · 3/8" sit next to each other and disagree. They come from two separate progress systems (local setup store vs server launch checklist). Merging them is a product decision.
- Change lines show the direction twice: "↑ +$31.54 (14.7%)" has both an arrow and a "+". The label format is locked by tests.
- In demo, Top products shows letter tiles (W/R/H) instead of the products' photos. The preview path passes an empty image list to `mergeTopProductImages`.

**Products** (app/(tabs)/products.tsx, components/products/ProductCard.tsx)
- [FIXED] The "Active"/"Draft" chip sat on the photo with no backing and couldn't be read on light images. It now has the same dark scrim as the card's "…" button.
- [FIXED] The card's category/variant line and stock line were 11pt, which `FS` reserves for badges. They are now 12pt (`FS.meta`).
- Status chips and stock text use green, amber and red, outside black/white/silver. This is the app-wide status palette and was left alone.
- Checked and working: card swipe (archive/delete), card "…" quick actions, and the header "…" menu (select, import, export, launches, waitlist, size charts).

**Add / edit product — listing flow** (app/add-product.tsx; app/product-editor.tsx redirect)
- [FIXED] On variant rows, the SKU/Price/Stock inputs overflowed the card and the Price field was cut off at the right edge. Web TextInputs default to about 20 characters wide; they now have `minWidth: 0`.
- [FIXED] In the inventory stepper, the "In stock" label was jammed against the − button and + was pushed to the far edge. The stepper input now has a fixed width.
- [FIXED] The variant trash icon had no accessibility label and a 22pt tap target. It now has a label and hitSlop.
- [FIXED] The variant select checkbox had no role, state or label and an 18pt target.
- [FIXED] The stepper −/+ buttons were 28pt targets. They now have hitSlop.
- The "Track inventory" and "Allow overselling" switches are iOS green. This is a documented exception in the shared HapticSwitch, which is outside this area.
- Every variant row shows an empty "Price" even when the product price is set (for example $98). Nothing says the variant inherits that price.
- The photo row's 4th "+" tile is about half the width of the photo tiles, so it looks clipped.
- Checked and expanding: Profit, Shipping, Sales model, Size chart, Manufacturing, Storefront & SEO, Preview. `product-editor.tsx` is a redirect only and is clean.

**Product detail** (app/product-detail.tsx)
- [FIXED] The header "…" (Archive / Duplicate / Share) used `Alert.alert`, which does nothing on web, so the tap was dead there. It now uses the shared `showActionSheet`. Native still shows the same Alert.
- [FIXED] The "Product duplicated — View copy" confirmation was also Alert-only on web.
- [FIXED] The header "Edit" label sat at the top of its button instead of being vertically centered.
- [FIXED] Scroll padding ignored the floating seller bar, so the last Details rows ended under the bar and the FAB.
- There are two edit controls (header "Edit" and a floating pencil), and the pencil covers Details rows mid-scroll.
- The 3rd and 4th stat tiles (Stock, Margin) are cut off at the right edge. The strip scrolls sideways, but nothing hints at that.
- "Last updated 9/17/2026" is a numeric date, while the rest of the seller UI uses "Sep 17, 2026".
- The margin copy "Margin: — (add cost to calculate)" reads awkwardly.

**Variants & stock** (app/product-variants.tsx)
- [FIXED] The error state showed raw transport text ("API 403: This action is unavailable…"). It now falls back to friendly copy.
- [FIXED] Field labels were 11pt. They are now 12pt.
- Every validation and confirmation ("Already added", "Limit reached", "Saved", save errors) uses `Alert.alert`, so none of them show on web.
- The header uses a centered title and chevron, unlike the other seller screens, which use a left-aligned title and arrow.

**Bulk edit products** (app/products-bulk-edit.tsx)
- [FIXED] The preview meta line used `FS.xs ?? 12` (the fallback never applies, so it was always 11pt). It is now `FS.meta`.
- With `&demo=1` it shows "No products yet." and a salmon "unavailable in the signed-out preview" banner, while the Products tab lists 5 demo products.
- "Select all displayed · 0" can be tapped even when there is nothing to select.
- The header uses a centered title, which doesn't match the other seller list screens.

**Orders** (app/(tabs)/orders.tsx; app/orders.tsx redirect)
- [FIXED] Row captions (item count, time, tracking), the error and paused banners and the bulk button were 11pt. They are now 12pt.
- [FIXED] The header "…" menu had "Bulk Actions" in Title Case among sentence-case items.
- Each row's 8-dot progress tracker has no labels, so it means nothing without opening the order.
- NEW orders ("Paid • To ship") have no Ship button, while older orders with the same status do. The row doesn't say the order has to be marked processing first.
- The empty state wraps and leaves "out." alone on the last line.
- `app/orders.tsx` is a redirect only and is clean.

**Order detail** (app/order-detail.tsx)
- [FIXED] The error and "not found" states had no header or back button. The only way out was the tab bar.
- [FIXED] "Message buyer" was greyed out on guest checkouts with no explanation. It now shows a one-line reason.
- [FIXED] "View tracking" used `Alert.alert`, a dead tap on web. It now uses `showActionSheet`.
- [FIXED] Action labels were in Title Case ("Mark Ready to Ship", "Cancel Order"…) next to sentence case ("Ship some items"). They are now sentence case throughout.
- [FIXED] 26 caption/meta text styles were 11pt. They are now 12pt; badge styles stay at 11pt.
- The status pills are orange (PROCESSING) and green (PAID), outside the palette.
- The tab strip cuts "Fulfillment" off at the right edge, and any further tabs are hidden with no hint that it scrolls.
- In the Items row, "×1" floats above the price instead of lining up with it.

**Fulfill order / packing** (app/fulfill-order.tsx; app/shipping-label.tsx redirect)
- [FIXED] With `&demo=1`, "Ship" on an Orders row opened "Couldn't load this order", so packing was unreachable. Generated demo orders are now resolved the same way order detail resolves them.
- [FIXED] The load error was plain text with no retry. It now has a "Try again" button.
- [FIXED] The title "Fulfill Order" is now "Fulfill order".
- [FIXED] "Order #BT-18204" had a double prefix (the order number already starts "BT-").
- [FIXED] Pack checklist rows had no checkbox role, state or label.
- [FIXED] The item variant and package preset subtitles were 11pt. They are now 12pt.
- The step indicator only labels the current step ("Pack the order"). Steps 2–4 are bare numbers.
- Packed items use a green check-square, outside the palette.
- `shipping-label.tsx` is a redirect only and is clean.

**Fulfill multiple orders** (app/fulfill-batch.tsx)
- [FIXED] When the orders couldn't load, the screen showed an empty "Selected orders" list and disabled buttons with no message. It now shows an error ("Couldn't load these orders" / "N of M") with "Try again".
- [FIXED] Bottom padding ignored the floating seller bar, so "Done" could end up under it.
- [FIXED] The title "Fulfill 2 Orders" is now "Fulfill 2 orders".
- [FIXED] Order numbers were shown with an extra "#".
- [FIXED] The open-label icon was a 20pt target with no hitSlop.
- "Print labels" quietly buys the cheapest rate for a hardcoded 1 lb, 10×8×4 package, and the seller is never shown those assumptions.

**Seller profile tab** (app/(tabs)/profile.tsx)
- The avatar's "+" story badge is about a 16pt tap target. It comes from the shared ProfileStoryAvatar, which is in the profiles area.
- The "Seller" and "Free Plan" chips stack on two lines even though they fit on one.
- In preview, the profile header says "Preview Studio" while More says "Maya Okafor" (the two preview identities don't match).
- Checked: "Edit" is on the profile, and "Share profile" and "View as visitor" are under the "…" menu, as intended.

**More** (app/(tabs)/more.tsx)
- [FIXED] "Store setup" showed 0% while Dashboard and Store setup showed 88%. More called `getSetupState()` without the seller's id (an unscoped read) and only on mount. It now reads the seller's own record on focus.
- [FIXED] The Payouts subtitle was cut off ("…payout history · $42.60 T…"). It is now shorter.
- [FIXED] The account switcher hint and the "Continue setup →" link were 11pt. They are now 12pt.
- The Discounts, Sales, Shipping, Reviews and Subscription icons are tinted gold/yellow and Payouts is green, outside black/white/silver.
- Subscription and Manufacturer Hub show a "•" dot that nothing explains.

**Public seller profile** (app/seller-profile.tsx)
- [FIXED] The vacation notice text was 11pt. It is now 12pt.
- The error state says "Check your connection and try again" even when the failure isn't a network problem (seen in preview).
- The back button is a circled arrow, while other pushed seller screens use a plain arrow.

**Store preview** (app/store-preview.tsx)
- [FIXED] The frame height subtracted `insets.top`, but the bar is offset by `useHeaderTopInset()`, which is at least 54pt on web. On browsers where `insets.top` is 0, the bottom of the store frame was cut off. This was verified in code; the iPhone harness's insets hide it.
- [FIXED] The close and retry buttons were missing a role and label.
- The retry button uses its own styling instead of the shared Button.

**Launch checklist / ready to sell** (app/launch-checklist.tsx)
- [FIXED] The error state was a lone "Try again" button with no message. It now says what failed.
- It shows 3/8 while Store setup shows 88% for the same seller (see Dashboard).
- The progress pill uses an off-token `paddingVertical: 3` and a literal `lineHeight: 19`.

**Store setup checklist** (app/setup.tsx)
- [FIXED] Task descriptions were cut to one line ("…open your wo…", "…already own fro…"). They now wrap to two lines.
- [FIXED] The description and "Skip" text were 11pt. They are now 12pt.
- [FIXED] The task card, the complete-circle and "Skip" had no role or label. They now do, and Skip's tap area is larger.
- Done tasks are dimmed to 60% opacity on top of grey strikethrough, which is low contrast.

**Store setup steps** (app/store-setup-name.tsx, app/store-setup-brand.tsx, app/store-setup-socials.tsx)
- The brand step's CTA says "Done" while the other steps say "Continue", and while disabled it shows as plain grey text.
- In demo, TikTok is prefilled as a full URL while Instagram is a bare @handle. The two inputs aren't normalized the same way.
- The "Available" check and the social link confirmation are green, outside the palette.

## Round 2 fix-backs

Checked at 390×844 in the web harness (`?bt_preview=seller`, fresh and `&demo=1`).

**Fixed**
- One setup number. "Continue setup", Get ready to sell, the dashboard Launch card, the walkthrough sheet, More's Store setup row, Store setup and Launch your store all read the server launch checklist through `launchProgress()` (lib/launchChecklist.ts), so they all say the same thing, e.g. "4/9". Store setup lists those launch steps as its counted list. Domain, first post and manufacturer follow under "Grow your store", uncounted. More's "Continue setup →" now opens Store setup; before, it opened Settings.
- Change lines show direction once: the arrow stays and the "+"/"−" is gone (hero, stat tiles, traffic). Screen readers hear "up"/"down" instead.
- Demo Top products show the products' real photos. Demo order lines use the same product names as the Products tab.
- Product detail: the floating pencil is gone (the header Edit stays). The stat strip has a trailing fade and a peeking third tile. "Last updated" reads "Sep 17, 2026". The margin copy reads "Margin: — Add cost to calculate". The remaining Alert.alert calls are now showAlert.
- Variants & stock uses the left-aligned seller header. When the "Price for new" field is empty it shows "Inherits product price ($X)". Error copy goes through friendlyError.
- Bulk edit: "Select all displayed" is disabled when nothing is listed.
- Orders: Ship shows on NEW paid orders and does both steps, because the server already allows pending → shipped. The empty-state copy fits on one line.
- Order detail: "× 1" sits on the price line.
- Fulfill order: all four steps are labelled (Pack / Package / Ship / Confirm). The "##" double prefix is gone.
- Fulfill multiple shows the package it will use (saved box and item weights, cheapest rate), with an Edit for weight and L×W×H that re-quotes before anything is bought.
- Profile: the Seller and Free Plan chips sit on one line. The preview identity is "Maya Okafor" on both Profile and More.
- More: removed the unexplained "•" dots on Subscription and Manufacturer Hub.
- Public seller profile: a 404 shows "Profile not found", other failures get friendlyError copy, and only a real network failure says "Check your connection".
- Store preview: retry uses the shared Button.
- Store setup: done tasks keep the strikethrough without the extra dim. Tapping a row opens its screen. A manual task is marked complete with a long-press (or its circle), with no 3-button alert.
- Store setup steps: the brand step CTA says "Continue". TikTok and Instagram are both stored as a bare handle and shown as "@handle".
- Launch checklist pill padding and body text use tokens.

**Already fixed on dev before this round:** the 8-dot order tracker (now 3 labelled stages), the order-detail tab strip (the tabs were removed), the bulk-edit demo products and header, the seller-profile plain arrow, the variants Alert.alert calls.

**Left as-is**
- Status colors: green, amber, red, gold icons and the iOS-green switches. These are owner decisions.
- The ProfileStoryAvatar "+" tap target belongs to the profiles area.
- Add product has no per-variant price rows in the current listing flow, so there is nowhere to put an "Inherits" placeholder.
