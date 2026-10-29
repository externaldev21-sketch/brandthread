import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const feed = readFileSync(resolve(process.cwd(), 'app/(tabs)/feed.tsx'), 'utf8');
const bar = readFileSync(resolve(process.cwd(), 'components/buyer-nav/BuyerTabBar.tsx'), 'utf8');
const metrics = readFileSync(resolve(process.cwd(), 'components/buyer-nav/buyerTabBarMetrics.ts'), 'utf8');
const parts = readFileSync(resolve(process.cwd(), 'components/tab-bar/TabBarParts.tsx'), 'utf8');

describe('buyer Thread chrome', () => {
  it('uses the cart as the final header action instead of create post', () => {
    const topBar = feed.slice(feed.indexOf('{/* ─ Top bar overlay ─ */}'), feed.indexOf('{/* ─ Feed tab switcher'));
    expect(topBar).toContain('name="shopping-cart"');
    // The buyer Bag, or a seller's root-stack Bag from Watch Threads (lib/navigation/shopperRoutes.ts).
    expect(topBar).toContain('router.push(shopperRoutes.bag as never)');
    expect(topBar).not.toContain('name="plus-square"');
    expect(topBar).not.toContain('name="user-plus"');
  });

  it('draws the Profile circle exactly as tall as the capsule', () => {
    expect(metrics).toContain('const circleSize = capsuleHeight;');
    expect(bar).toContain('size={metrics.circleSize}');
    expect(parts).toContain('width: size, height: size, borderRadius: radius.bar');
  });

  it('fits every Thread page to the measured tab scene, full-bleed with no bands', () => {
    expect(feed).toContain('const [viewportSize, setViewportSize]');
    expect(feed).toContain('const viewportReady = viewportSize.width > 0 && viewportSize.height > 0');
    expect(feed).toContain('{viewportReady && <ParentScrollGestureScope><FlatList');
    expect(feed).toContain('width: pageWidth, height: pageHeight');
    // Uniform page layout lives in the shared pager config the feed spreads.
    expect(feed).toContain('{...verticalPagerListProps(pageHeight, displayItems.length)}');
    expect(readFileSync(resolve(process.cwd(), 'lib/feedPager.ts'), 'utf8'))
      .toContain('length: pageHeight, offset: pageHeight * index');
    expect(feed).not.toContain('snapToInterval={pageHeight}');
    expect(feed).not.toContain("Dimensions.get('window')");
    // Photo slides (carousel and single photo) are full-bleed like video
    // Threads: cover-cropped behind the header and tab bar, never letterboxed
    // into black bands at the top/bottom.
    expect(feed).toContain('<PhotoCarousel');
    const carousel = readFileSync(resolve(process.cwd(), 'components/buyer-feed/PhotoCarousel.tsx'), 'utf8');
    expect(carousel).toContain('ZoomablePhotoPager');
    // Full-bleed blurred backdrop (cover) behind an uncropped contain foreground.
    const slide = readFileSync(resolve(process.cwd(), 'components/media/PhotoSlide.tsx'), 'utf8');
    expect(slide).toContain('contentFit="cover"');
    expect(slide).toContain('contentFit="contain"');
    // Loading is a full-page shimmer, not a card with screen-colored bands.
    expect(feed).toContain('<ThreadPageSkeleton');
    expect(feed).not.toContain('<FeedSkeleton');
  });
});