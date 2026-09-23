import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const feed = readFileSync(resolve(process.cwd(), 'app/(tabs)/feed.tsx'), 'utf8');
const bar = readFileSync(resolve(process.cwd(), 'components/buyer-nav/BuyerTabBar.tsx'), 'utf8');
const metrics = readFileSync(resolve(process.cwd(), 'components/buyer-nav/buyerTabBarMetrics.ts'), 'utf8');

describe('buyer Thread chrome', () => {
  it('uses the cart as the final header action instead of create post', () => {
    const topBar = feed.slice(feed.indexOf('{/* ─ Top bar overlay ─ */}'), feed.indexOf('{/* ─ Feed tab switcher'));
    expect(topBar).toContain('name="shopping-cart"');
    expect(topBar).toContain("router.push('/(buyer)/cart'");
    expect(topBar).not.toContain('name="plus-square"');
    expect(topBar).not.toContain('name="user-plus"');
  });

  it('gives the Profile circle enough room for its icon and full label', () => {
    // The circle is exactly as tall as the capsule (58–64pt) and keeps an
    // 11pt minimum label, per the readable-text floor.
    expect(metrics).toContain('const circleSize = capsuleHeight;');
    expect(bar).toContain('width: metrics.circleSize');
    expect(bar).toContain('height: metrics.circleSize');
    expect(bar).toContain('borderRadius: metrics.circleSize / 2');
    expect(metrics).toContain('labelSize: isTablet ? 12 : 11');
  });

  it('fits every Thread page to the measured tab scene and never crops photos', () => {
    expect(feed).toContain('const [viewportSize, setViewportSize]');
    expect(feed).toContain('const viewportReady = viewportSize.width > 0 && viewportSize.height > 0');
    expect(feed).toContain('{viewportReady && <FlatList');
    expect(feed).toContain('width: pageWidth, height: pageHeight');
    expect(feed).toContain('length: pageHeight, offset: pageHeight * index');
    expect(feed).not.toContain('snapToInterval={pageHeight}');
    expect(feed).not.toContain("Dimensions.get('window')");
    expect(feed).toContain('contentFit="contain"');
  });
});