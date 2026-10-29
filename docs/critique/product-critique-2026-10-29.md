# Product critique: "worse than it should be" (2026-10-29)

This is a read-only critique. No app code was changed. I walked `origin/dev` at `71a99506` in the web fast-preview export (`build-web.js --preview`) at 390×844, as `?bt_preview=seller&demo=1` and `?bt_preview=buyer&demo=1`. I judged it two ways: as a picky clothing-brand owner whose reference apps are Shopify, Instagram and Depop, and as a rival designer looking for things to mock.

Out of scope, because they are already in flight: profile dedupe, plan visibility, globe zoom, desktop layout and the account switcher. Onboarding was out of scope too.

**Setup caveats (read before arguing with a finding):**
- The fast-preview demo is the build Dev evaluates and shows to people, so a demo screen that contradicts itself is reported as a trust problem. Where a finding may only exist on the demo path, it is tagged **[demo path]**. Fix the fixture or the shared data source, whichever is actually wrong.
- I ran the API locally against an empty Postgres. The buyer catalog would not render in the static export because `isPreviewCatalogEnabled()` checks raw `__DEV__` (`artifacts/mobile/lib/previewCatalog.ts:28`), which is false in that export. That probably also leaves Dev's buyer Discover and Search empty in the fast-preview. To get buyer screens with content, I patched it locally to `ALLOW_DEV_TOOLS`, rebuilt, then reverted. Nothing was committed.
- I only got as far as the checkout entry point. Locally it shows "Checkout isn't live yet" because no Stripe keys are configured.

Ranked by how much each finding hurts trust or revenue. Screenshots are in [`product-critique-2026-10-29/`](./product-critique-2026-10-29/).

---

## 1. Seller dashboard: "Ship now" (15 orders) opens "No unfulfilled orders" [demo path]
- **Wrong:** The biggest button on the revenue screen leads to an empty list. The Orders tab says "No orders yet", even though the dashboard shows 15 to ship and five "New" orders from the last 18h.
- **Reference:** In Shopify admin, "X orders to fulfill" opens the Unfulfilled view with exactly those X orders.
- **Fix:** Feed the To-do count, Recent orders and the Orders tab from one orders source (demo fixture included) and assert they match in a test.
- **Shot:** [01-ship-now-dead-end.jpg](./product-critique-2026-10-29/01-ship-now-dead-end.jpg)

## 2. Seller money numbers disagree screen to screen, and none of them say which period they cover [demo path for some values]
- **Wrong:** Several figures can't all be true:
  - Dashboard: "$10,000 in sales" milestone, but TOTAL SALES $0.00, ORDERS TODAY 0 and VISITORS 0, while "New order from Leo Martin · 3h" and "10 visitors right now" sit on the same screen.
  - Top products: Tailored Long Coat shows 107 sold / $4,066, but its own product page says 33 sold / $1,254.
  - Payout date: "Next payout Fri, Oct 30" on the dashboard, "Next payout Oct 31" on Payouts.
  - Analytics shows $0 revenue next to $43k of "Top products".
- **Reference:** Shopify labels every number with its range ("Today", "Last 30 days") and the same metric matches across Home, Analytics and Product.
- **Fix:** Put a range label on every money tile and list ("All time", "Last 7 days"), and drive the payout date and units sold from one selector each.
- **Shot:** [02-numbers-disagree.jpg](./product-critique-2026-10-29/02-numbers-disagree.jpg)

## 3. Add product is a Vinted resale form, not a brand's listing tool
- **Wrong:**
  - The form is titled "Sell an item", with the description placeholder "e.g. only worn a few times, true to size" (`app/add-product.tsx:202,254`).
  - It asks for a Condition and a "Brand" (the seller *is* the brand) and defaults Quantity to 1.
  - Price sits below 8 attribute rows, and the form states "The buyer always pays for shipping" with no free-shipping option.
- **Reference:** Shopify's Add product is Title → Media → Price → Inventory → Variants. Depop at least puts price beside the photos. Neither assumes the item is used.
- **Fix:** Retitle it "New product". Drop Condition (or default it to New and hide it) and Brand. Move Price and Variants/Stock directly under the photos. Add "I'll cover shipping" or a free-shipping threshold.
- **Shot:** [03-add-product-resale-form.jpg](./product-critique-2026-10-29/03-add-product-resale-form.jpg)

## 4. The same coat gets three different product pages with three different answers to "can I buy this?" [demo path]
- **Wrong:**
  - **Shop the post sheet:** "Add to bag" works.
  - **"View details" (thread-product-detail):** shows a seller-side "Preview" pill, the note "Saved on this device only. Buyers can't see or buy it." (`app/buyer-product-detail.tsx:1749`) and a disabled "Not for sale yet" button.
  - **`buyer-product-detail` for the same id:** says "This drop is gone".
- **Reference:** Depop and Shopify have one product page. The quick-add sheet is a subset of it, never a contradiction.
- **Fix:** Route every product tap to one buyer PDP. Never render `sellerPreview` copy unless the viewer owns the product.
- **Shot:** [04-pdp-three-answers.jpg](./product-critique-2026-10-29/04-pdp-three-answers.jpg)

## 5. Bag shows three conflicting shipping messages for one item
- **Wrong:** "Atelier Noire · Free shipping", then "Spend $20.00 more for free shipping from Atelier Noire" with a 96% progress bar, then "Shipping total: Free". This is on a $480 coat.
- **Reference:** The Shopify cart shows one shipping line. A threshold bar shows only while shipping actually costs something.
- **Fix:** Hide `FreeShippingStrip` when the group already ships free, whether from product-level free shipping or because the threshold is met.
- **Shot:** [05-bag-shipping-contradiction.jpg](./product-critique-2026-10-29/05-bag-shipping-contradiction.jpg)

## 6. Discover: tapping a priced product tile opens a TikTok video player, not the product
- **Wrong:** A tile that reads "$410.00 · Orison" opens a full-screen video with Home-feed chrome (LIVE / Following / Threads, cart icon) and no tab bar. The product is a small pill near the bottom.
- **Reference:** In Depop or the Shop app, tapping a tile with a price opens the product.
- **Fix:** Tiles that show a price open the PDP. Tiles that show a play glyph open the player.
- **Shot:** [06-tile-opens-video.jpg](./product-critique-2026-10-29/06-tile-opens-video.jpg)

## 7. A buyer's first screen is an empty "No posts yet — Check back soon"
- **Wrong:** Home → Threads is empty while Discover has 11 shoppable products. The LIVE tab shows the "No posts yet" empty state *above* two live streams with 2,430 viewers.
- **Reference:** Instagram and Depop never show a new user an empty home. They fall back to For You or trending.
- **Fix:** When the Following/Threads feed is empty, fill it with Discover's For You. Never render the empty state when other content is on screen.
- **Shot:** [07-buyer-home-empty.jpg](./product-critique-2026-10-29/07-buyer-home-empty.jpg)

## 8. Payouts puts $42.60 of Thread Cash above $4,281 of real money
- **Wrong:** The hero card is "Thread Cash $42.60" with a big green "Cash out" button. The $4,281.22 payout balance sits below it with no action. The More menu row reads "Payouts · $42.60 Thread Cash".
- **Reference:** Shopify Payouts leads with balance and next payout. Credits and rewards are secondary.
- **Fix:** Lead with payout balance, next payout date and Withdraw, then move Thread Cash into a row underneath. Show the payout balance on the More row.
- **Shot:** [08-payouts-hierarchy.jpg](./product-critique-2026-10-29/08-payouts-hierarchy.jpg)

## 9. Seller buyer-DMs are buried under More › Growth, and the prime tab-bar slot goes to an AI chat
- **Wrong:**
  - Buyers asking "does this come in M?" are pre-sales. Yet "Messages" is the 4th section down the More menu, filed under "Growth".
  - The dashboard header has no inbox icon or unread badge.
  - The always-visible "B" tab button opens an AI "What are we building today?" chat.
- **Reference:** Instagram and Depop both keep the inbox one tap away with an unread count. Shopify Inbox sits on Home.
- **Fix:** Add an inbox icon with an unread badge to the dashboard header, or swap it into the tab bar. Move the AI assistant behind it or into the header.
- **Shot:** [09-seller-messages-buried.jpg](./product-critique-2026-10-29/09-seller-messages-buried.jpg)

## 10. Buyer: there is no visible way to "My orders", and the profile header has two overflow menus
- **Wrong:**
  - Orders lives either in a ••• sheet or ~40 rows down Settings ("Your orders & payments").
  - The profile header has both ••• and ≡, plus a $0.00 wallet pill.
  - The ••• sheet repeats Edit profile and Share profile, which are already buttons on the same screen.
- **Reference:** Depop and the Shop app put Orders on the profile or as a top-level entry. Instagram has exactly one menu (≡).
- **Fix:** Add an "Orders" row or chip to the buyer profile. Merge ••• into ≡ and delete its duplicate rows.
- **Shot:** [10-buyer-orders-buried.jpg](./product-critique-2026-10-29/10-buyer-orders-buried.jpg)

## 11. PDP copy undercuts the price and overpromises delivery
- **Wrong:**
  - "or 4 interest-free payments of $120.00 with Klarna or Afterpay" sits *above* "$480".
  - "Delivered in 15 days or your money back" sits beside "Ships in 3–5 business days".
  - "Brandthread protected" is followed by a legal paragraph saying outcomes "depend on the seller's policy and the law".
- **Reference:** On Shopify themes the price comes first and BNPL is a small line under it. Depop's protection copy is a one-line promise.
- **Fix:** Show price, then BNPL. Show one delivery promise that matches the ship estimate. Keep protection to one sentence plus a "How it works" link.
- **Shot:** [11-pdp-copy.jpg](./product-critique-2026-10-29/11-pdp-copy.jpg)

## 12. Studio is a wall of locks, and the badge names the wrong plan
- **Wrong:** 7 of 8 Studio tiles carry a "PRO" lock badge (`components/BrandthreadUI.tsx:1088`), but the link under each says "Growth plan →". Analytics mixes "Export PRO" and "Advanced analytics GROWTH". A first-time seller reads the tab as a paywall.
- **Reference:** Shopify shows what's included first and upsells inline, with a plan badge that names the plan you would actually need.
- **Fix:** Make the badge show the required plan name. Order unlocked tools first. Show one "Unlock with Growth" banner instead of a lock on each tile.
- **Shot:** [12-studio-lock-wall.jpg](./product-critique-2026-10-29/12-studio-lock-wall.jpg)

## 13. Seller profile: three ways to edit, two ways to share, two ways to Activity, plus a row that opens a tab you already have
- **Wrong:**
  - Edit: pencil by the name, the "Edit profile" button, and ••• › "Edit name and bio".
  - Share: the "Share profile" button and ••• › "Share store".
  - Activity: the bell icon and ••• › "Activity".
  - The "Professional dashboard" row just jumps to the Dashboard tab.
- **Reference:** Instagram has one Edit profile, one Share profile and one menu.
- **Fix:** Keep the two buttons, cut the ••• sheet to things that aren't already on screen, and delete the Professional dashboard row for sellers.
- **Shot:** [13-seller-profile-dupes.jpg](./product-critique-2026-10-29/13-seller-profile-dupes.jpg)

## 14. Dashboard repeats itself and buries the create actions
- **Wrong:**
  - "Recent activity" and "Recent orders" list the same five orders back to back.
  - "Share store" appears 3× (header icon, traffic card, quick action), plus a copy-link icon.
  - "Next payout $4,281.22" and "Available balance $4,281.22" stack the same number.
  - New product / New post / Go live sit roughly 1,800px down.
- **Reference:** Shopify Home is one feed with no repeated list, and its primary create action stays in reach.
- **Fix:** Delete Recent activity (or limit it to non-order events). Keep one Share entry. Show one balance line. Move the quick actions under To-do.
- **Shot:** [14-dashboard-dupes.jpg](./product-critique-2026-10-29/14-dashboard-dupes.jpg)

## 15. The #1 best-seller is sold out and nothing tells the seller to restock it
- **Wrong:** Wool Overcoat is top of Top products ($19,200) and "Sold out" in Products. The dashboard only says a generic "1 item low on stock", and the products list shows no sales per item.
- **Reference:** Shopify flags "Out of stock: best seller" with a restock or reorder action. Depop shows sold counts on listings.
- **Fix:** Add a To-do line, "Your best-seller is sold out → Restock / Reorder from manufacturer", and show units sold on product rows.
- **Shot:** [15-sold-out-bestseller.jpg](./product-critique-2026-10-29/15-sold-out-bestseller.jpg)

## 16. "Store setup 0/9 · Continue setup" nags a store that already shows $10k in sales [demo path]
- **Wrong:** The top of the More menu tells an established seller they haven't set up their store. On another render the same card said 4/9.
- **Reference:** Shopify's setup guide disappears or collapses once the store is selling.
- **Fix:** Hide the setup card once the store has a first sale, or when the count is stable at ≥ N/9, and compute it from one source.
- **Shot:** [16-setup-nag.jpg](./product-critique-2026-10-29/16-setup-nag.jpg)

## 17. Thread Cash looks like money, is sent like money, then says it isn't money
- **Wrong:**
  - The screen shows green banknote art, Activity says "Noma Archive sent you Thread Cash +$5.00", and the profile header has a "$0.00" pill.
  - The fine print says "Thread Cash isn't money… Spending it at checkout is coming soon".
  - Streak and "Open Brandthread on 3 days" quests read as cheap next to $480 coats.
- **Reference:** Depop and Shopify credits are spendable at checkout from day one, or they aren't shown.
- **Fix:** Hide Thread Cash from buyers until it can be spent at checkout. Drop the dollar-banknote art and the "+$" framing.
- **Shot:** [17-thread-cash.jpg](./product-critique-2026-10-29/17-thread-cash.jpg)

## 18. Size picker says "M" three times, and the quick-buy sheet has no size guide
- **Wrong:** "Your size: M · Based on your saved outerwear size", then "Size … M", then "Recommended" under the M chip. The Size guide link exists only on the full PDP.
- **Reference:** Shopify and Depop put "Size guide" next to the size chips wherever you can add to bag.
- **Fix:** Keep the chip with "Recommended", delete the other two lines, and add "Size guide" beside the Size label in the sheet.
- **Shot:** [18-size-picker.jpg](./product-critique-2026-10-29/18-size-picker.jpg)

## 19. Discover brand cards are blank placeholders, and the same brand appears twice
- **Wrong:** Featured and "Brands you might like" cards show a generic bag icon instead of a logo or imagery. Atelier Nord appears in both rows.
- **Reference:** Instagram and Depop suggestion cards show an avatar and 3 product thumbs.
- **Fix:** Render the brand avatar plus 2–3 product images, and de-dupe "might like" against Featured.
- **Shot:** [19-discover-brand-cards.jpg](./product-critique-2026-10-29/19-discover-brand-cards.jpg)

## 20. Search reads like a thrift app
- **Wrong:**
  - The chips are Streetwear / Vintage / Y2K / Cottagecore / Gorpcore… (Depop resale vocabulary) for a brands-only marketplace.
  - The Explore grid shows likes but no prices, though Discover tiles show prices.
  - The search header has an "Add friends" icon.
- **Reference:** Shopify-style catalog search uses category and product-type chips with prices on results.
- **Fix:** Use category chips (Outerwear, Dresses, Tailoring…), show prices on every result tile, and remove the add-friends icon from product search.
- **Shot:** [20-search.jpg](./product-critique-2026-10-29/20-search.jpg)

## 21. Copy lifted from Instagram makes the app look like a clone
- **Wrong:**
  - Buyer Settings is titled "Settings and activity" and opens with "Accounts Center", Meta's product name.
  - Both inboxes, including the *seller business* inbox, show the Notes bubble "Your thoughts go here…" (`components/inbox/MessagesInbox.tsx:1852`).
  - Settings lists "Invite friends", "Muted words" and "About" twice ("About Brandthread" + "About").
- **Reference:** Depop and Shopify use their own vocabulary.
- **Fix:** Rename to "Settings" and "Account". Remove Notes from the seller inbox. De-dupe the repeated rows.
- **Shot:** [21-meta-clone-copy.jpg](./product-critique-2026-10-29/21-meta-clone-copy.jpg)

## 22. LIVE is everywhere, so it means nothing [demo path]
- **Wrong:** The buyer inbox shows four brands as LIVE at once (Atelier Noire, Maison Vela, Echelon, Astrae), with red badges in both the stories row and the conversation list.
- **Reference:** Instagram shows LIVE rarely and on the stories ring only, so it stays urgent.
- **Fix:** Show LIVE on one surface (the stories row) and cap the demo to one live brand.
- **Shot:** [22-live-inflation.jpg](./product-critique-2026-10-29/22-live-inflation.jpg)

## 23. "View as buyer" dead-ends at "Profile not found" [demo path]
- **Wrong:** A seller checking their storefront before sharing it gets an error page (`seller-profile?id=preview-seller&asVisitor=1`).
- **Reference:** Shopify's "View your store" always opens the live storefront.
- **Fix:** Resolve the preview seller id, or fall back to the store link shown on Share store.
- **Shot:** [23-view-as-buyer.jpg](./product-critique-2026-10-29/23-view-as-buyer.jpg)

## 24. The More menu is ~30 rows of misfiled features, and Settings overlaps it
- **Wrong:**
  - Six sections hold ~30 rows: Messages, Reviews and Questions sit under "Growth", and Pop-up mode (in-person sales) under "Money".
  - Seller Settings separately offers "Store details", "Store settings" and "Store website", and puts App settings above Store settings.
- **Reference:** Shopify Settings is search-first, with a short fixed set of store sections and no overlap with the main nav.
- **Fix:** Pin search at the top of More and regroup it by job (Sell, Get paid, Talk to customers, Grow). Merge the three Store rows into one.
- **Shot:** [24-more-menu-sprawl.jpg](./product-critique-2026-10-29/24-more-menu-sprawl.jpg)

## 25. Buyer demo account contradicts itself [demo path]
- **Wrong:**
  - My orders is empty while Echelon messages "It's on its way to you now".
  - Activity says "Maison Vela and 2 others liked your post" while the profile says "No posts yet" and 0 followers, even though brands "started following you".
- **Reference:** A demo has to survive someone tapping around it.
- **Fix:** Generate buyer demo orders, posts and follows from the same fixture that writes the inbox and activity.
- **Shot:** [25-demo-contradictions.jpg](./product-critique-2026-10-29/25-demo-contradictions.jpg)

---

## Fix first
1. **#1 + #2: make the seller's numbers agree and label their periods.** A brand owner who sees "15 to ship" lead to "No orders", or three different payout dates, stops trusting the money screens. That ends the subscription.
2. **#3: rebuild Add product as a brand tool.** It's the first thing every seller does, and "only worn a few times / Condition" tells them this is a resale app.
3. **#4 + #5: one PDP and one shipping message.** "Not for sale yet" on a product you can add to bag, then "spend $20 more" on a free-shipping order, both happen right before checkout.
4. **#8: put the payout balance and Withdraw first on Payouts.** Show the $4,281 the seller can withdraw, not $42 of credits.
5. **#9 + #10: put inboxes and orders one tap away.** Seller DMs are pre-sales and buyer orders are post-sales, and today both sit under menus.
