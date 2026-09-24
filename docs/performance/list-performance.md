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
