# List performance: products, orders, messages, discover

Measured 2026-09-23 on `claude/release-tooling` against `dev` @ `38a73a9`.

## What changed

| Screen | File | Change |
| --- | --- | --- |
| Seller products | `app/(tabs)/products.tsx` | `FlatList` → `FlashList`. Rows are `React.memo` with stable handlers. Search waits 250 ms after typing stops instead of reloading on every keystroke. The list no longer loads twice on open (a mount effect and a focus effect both fired). Thumbnails pass `recyclingKey`. |
| Seller orders | `app/(tabs)/orders.tsx` | `SectionList` → `FlashList`. Date groups become header rows with `getItemType`, so headers and orders recycle separately. Rows are memoized and receive one stable handler object. Selection lookups use a `Set`. |
| Buyer orders | `app/(buyer)/orders.tsx` | `FlatList` → `FlashList`, memoized order cards with a stable open handler. |
| Buyer and seller messages | `app/(buyer)/inbox.tsx`, `app/seller-inbox.tsx` | `FlatList` → `FlashList`. |
| Discover | `app/(buyer)/discover.tsx` | Sections are capped at 6–10 rows, so it stays a `ScrollView` (virtualizing 30 rows costs more than it saves). The carousel separator was an inline component, which remounted every separator on each render; it is now declared once. Rows are memoized. |
| Images | `components/CachedImage.tsx` | Already expo-image with memory and disk caching. It decodes at the displayed size, so a 56 pt thumbnail never holds a full-size bitmap. Documented `recyclingKey` for list rows, so a recycled cell never flashes the previous item's image. |

The React Compiler (`experiments.reactCompiler`) already memoizes inside components. The changes above target what it can't reach: `renderItem` callbacks, inline component types and handlers created per row.

## Results (web build, 4× CPU throttle, median of 3)

400 products, 400 orders and 400 conversations. Each list is scrolled the same 20,000 px in both builds.

| Screen | Metric | Before | After | Change |
| --- | --- | ---: | ---: | ---: |
| Seller products (400) | Render (ms) | 620 | 776 | +25% |
| Seller products (400) | DOM nodes | 703 | 593 | -16% |
| Seller products (400) | DOM nodes after scroll | 3499 | 614 | -82% |
| Seller products (400) | Scrolled (px) | 20000 | 20000 | ±0% |
| Seller products (400) | Scroll JS (ms) | 4832 | 1684 | -65% |
| Seller products (400) | Frames > 100 ms | 0 | 0 |  |
| Seller products (400) | Heap (MB) | 58.1 | 26.8 | -54% |
| Seller orders (400) | Render (ms) | 964 | 1171 | +21% |
| Seller orders (400) | DOM nodes | 413 | 349 | -15% |
| Seller orders (400) | DOM nodes after scroll | 3676 | 720 | -80% |
| Seller orders (400) | Scrolled (px) | 20000 | 20000 | ±0% |
| Seller orders (400) | Scroll JS (ms) | 6376 | 1721 | -73% |
| Seller orders (400) | Frames > 100 ms | 0 | 0 |  |
| Seller orders (400) | Heap (MB) | 60 | 34.8 | -42% |
| Seller messages (400) | Render (ms) | 377 | 508 | +35% |
| Seller messages (400) | DOM nodes | 497 | 375 | -25% |
| Seller messages (400) | DOM nodes after scroll | 2089 | 383 | -82% |
| Seller messages (400) | Scrolled (px) | 20000 | 20000 | ±0% |
| Seller messages (400) | Scroll JS (ms) | 3135 | 589 | -81% |
| Seller messages (400) | Frames > 100 ms | 0 | 0 |  |
| Seller messages (400) | Heap (MB) | 38.7 | 25.6 | -34% |
| Discover | Render (ms) | 870 | 885 | +2% |
| Discover | DOM nodes | 617 | 617 | ±0% |
| Discover | DOM nodes after scroll | 617 | 617 | ±0% |
| Discover | Scrolled (px) | 1651 | 1651 | ±0% |
| Discover | Scroll JS (ms) | 115 | 116 | +1% |
| Discover | Frames > 100 ms | 0 | 0 |  |
| Discover | Heap (MB) | 18 | 19.5 | +8% |

**How to read this**

- **Scrolling is the win.** Script time while scrolling drops 65–81%. Memory drops 34–54%. About 80% fewer DOM nodes stay mounted, because FlashList recycles a fixed set of rows. The old lists kept every row they had rendered.
- **First paint is 110–210 ms slower** at 4× CPU throttle. FlashList measures its first rows before laying out the rest. We accept this for lists that are scrolled far more than they are opened.
- **Discover is unchanged, as expected.** Its sections are capped, so there is nothing long to virtualize.
- **Web numbers understate the native gain.** On iOS and Android, creating a native view costs much more than a DOM node, and FlashList's recycling avoids creating new ones. These numbers come from the web build because this environment has no iOS simulator or Android emulator. To confirm on a device, profile the preview build with Xcode Instruments (Time Profiler) or Android Studio's CPU profiler while scrolling a few hundred products or orders.

## Re-running

```bash
cd artifacts/mobile
# Build both sides with the screenshot build (preview mode, demo API):
node -e "import('./scripts/store-screenshots/harness.mjs').then(m => m.buildPreviewWeb('/tmp/after'))"
git worktree add /tmp/base origin/dev && (cd /tmp/base && pnpm install)
node -e "import('./scripts/store-screenshots/harness.mjs').then(m => m.buildPreviewWeb('/tmp/before', '/tmp/base/artifacts/mobile'))"
node scripts/store-screenshots/measure-lists.mjs --before /tmp/before --after /tmp/after
```

## Audit 2026-09-30

Scope: every `FlatList`, `SectionList` and `FlashList` and every `ScrollView` that maps server data in `app/` and `components/`, minus the areas other work owns (Design Studio and `design*`, the Following tab, the create flows, community group chats). About 100 list components were checked with a script (missing `keyExtractor`, `initialNumToRender`, `windowSize`, `maxToRenderPerBatch`, `removeClippedSubviews`, `getItemLayout`) plus a grep for `.map(` over comments, notifications, people, results, messages, saved items, orders, customers, inventory and reviews inside a `ScrollView`.

Every `FlatList` in the app already has a `keyExtractor` except a few short, bounded ones listed at the end. The gap was tuning and two lists that were not virtualized at all.

New shared helper: `lib/listTuning.ts` (`LONG_LIST_TUNING`: render 12 rows first, batches of 8, window of 9 screens, `removeClippedSubviews` on Android only). Spread it onto a `FlatList`. It changes no row visuals.

| Screen | Finding | Action |
| --- | --- | --- |
| `app/content.tsx` (seller content library) | Every post rendered at once in a `ScrollView` | Converted to `FlatList`. Header (stats, create cards, library title, filter tabs) is `ListHeaderComponent`; loading, error and empty states are `ListEmptyComponent`; rows keep the same card, 12 pt separator and 16 pt side padding. Before/after screenshots at 393x852 are byte-identical above the tab bar for 2 and 60 posts, top and scrolled. DOM nodes with 60 posts: 1248 -> 948. |
| `app/seller-reviews.tsx` | Every review rendered at once in a `ScrollView` | Converted to `FlatList`, same container padding and 12 pt gap. Screenshots identical for 3 and 60 reviews, top and scrolled. DOM nodes with 60 reviews: 1308 -> 633. |
| `app/buyer-notifications.tsx` | `FlatList`, no tuning | `LONG_LIST_TUNING` added. |
| `app/buyer-post-comments.tsx` (feed comments) | `FlatList`, no tuning | `LONG_LIST_TUNING` added. |
| `app/buyer-saved.tsx` (saved items grid) | `FlatList`, two columns, no tuning | `LONG_LIST_TUNING` added. |
| `app/product-reviews.tsx` | `FlatList`, no tuning | `LONG_LIST_TUNING` added. |
| `app/connections.tsx` (followers and following) | `FlatList`, no tuning | `LONG_LIST_TUNING` added. |
| `app/activity-people.tsx` | `FlatList`, no tuning | `LONG_LIST_TUNING` added. |
| `app/community-members.tsx` (member list only) | `FlatList`, no tuning | `LONG_LIST_TUNING` added to the members list. The banned-members list and join-request rows are short and left alone. |
| `app/buyer-recently-watched.tsx` | `FlatList`, no tuning | `LONG_LIST_TUNING` added (36-hour window, but unbounded within it). |
| `app/conversation-search.tsx` | `FlatList`, no tuning | `LONG_LIST_TUNING` added. |
| `app/(buyer)/inbox.tsx`, `app/seller-inbox.tsx`, `app/(buyer)/orders.tsx`, `app/(tabs)/orders.tsx`, `app/(tabs)/products.tsx`, `components/social/PostGrid.tsx` | Already `FlashList` (earlier audit) | Left alone. FlashList sizes and recycles itself; `getItemLayout` and `windowSize` do not apply. |
| `app/buyer-conversation.tsx`, `app/seller-conversation.tsx` (message threads) | `FlatList`, `scrollToEnd` on content size change, keyboard-driven | Left alone on purpose. There is no `getItemLayout` (rows vary in height), and a smaller render window changes where `scrollToEnd` lands in a long thread. Needs a device check with a few hundred messages before tuning. |
| `app/community-chat.tsx` | Community group chats (off limits) | Not touched. |
| `app/customers.tsx` | Customers render in one bordered card inside a `ScrollView` | Left alone. The card border and rounded corners wrap every row, so a `FlatList` would need per-row border pieces and would risk a visible change. The list is fetched in one request; moving to a paged `FlatList` should be a deliberate design decision. |
| `app/customer-orders.tsx` | One customer's orders in a bordered card, same shape as Customers | Left alone for the same reason. |
| `app/buyer-search.tsx` | Result grids are wrapped tiles with entrance animation, limited by the API page | Left alone: a wrapped grid is not a single-column list, and the result sets are page-capped. |
| `app/(buyer)/discover.tsx` | Sections capped at 6-10 rows (see above) | Left alone. |
| `app/(buyer)/friends.tsx`, `components/ThreadShareSheet.tsx`, `components/MentionPickerSheet.tsx`, `app/manufacturer-compare.tsx` | Horizontal chip/avatar rows from small server lists | Left alone: short, horizontal, and virtualizing them would clip the leading edge they scroll from. |
| `app/activity-center.tsx` | Suggested people are a capped block inside a `SectionList` that already virtualizes the feed | Left alone. |
| `app/order-detail.tsx`, `app/buyer-order-detail.tsx`, `app/(buyer)/cart.tsx`, refund and return screens | `.map` over line items of one order or cart | Left alone: bounded by the order. |
| `app/fulfill-batch.tsx` | `.map` over the orders the seller just selected | Left alone: bounded by the selection. |
| `app/buyer-live.tsx`, `app/seller-live.tsx` | Live chat comments mapped in a `ScrollView` | Left alone: the live screens are separate work, and the comment buffer is capped by the live feed. |
| Settings, analytics and onboarding screens (`.map` over static arrays) | Not server data | Left alone. |
| `app/design*.tsx`, `components/design*`, `app/(tabs)/following.tsx`, create flow | Forbidden areas | Not touched. |
| Short, bounded lists without `keyExtractor` (`ai-mockup-chat`, `ai-photography-chat`, `ai-brain`, `live.tsx` rail, `SupportChatBubble`, `DiscoverGrid` first list, `ProfileShell` first list, `buyer-conversation` and `seller-conversation` attachment strips, `community-chat`) | A handful of rows, or in a forbidden area | Left alone. React falls back to the item's `key` or index for these. |

Verified with `scripts/store-screenshots/list-parity-verify.mjs` (before = `dev`, after = this branch, both exported with `buildPreviewWeb()`): all four scenarios report top and scrolled screenshots identical and confirm the scroll moved the screen. The screenshots are in `docs/pr-assets/performance/`. The comparison clips off the floating tab bar because its animated logo glyph differs between any two captures of the same build.
