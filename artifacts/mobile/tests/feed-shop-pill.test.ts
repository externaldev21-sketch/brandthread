/**
 * Structure tests for the shop trigger (a collapsed side tab on the left
 * screen edge that glides out into a card on tap — see
 * components/buyer-feed/ShopSideTab.tsx) and the fix that makes its
 * price/thumbnail real: the server never sent a tagged product's price or
 * image through the feed/detail routes, so the trigger always showed $0.00
 * with a generic bag icon — this plumbs the real data through server ->
 * socialService -> feed.
 *
 * The trigger used to be an always-visible ShopAnchorPill with a
 * frosted-glass (BlurView) background and a shimmer sweep; both were
 * removed — a live blur over playing video re-samples every frame (a
 * visible shimmer/glitch, not a decorative effect), and the always-visible
 * pill made every tagged video look like an ad. It's a collapsed edge tab
 * now, fully solid, no blur/shimmer anywhere.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const feed = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');
const social = readFileSync(resolve(__dirname, '../services/socialService.ts'), 'utf8');
const postsRoute = readFileSync(resolve(__dirname, '../../api-server/src/routes/posts.ts'), 'utf8');
const shopTab = readFileSync(resolve(__dirname, '../components/buyer-feed/ShopSideTab.tsx'), 'utf8');

describe('Shop trigger — collapsed edge tab, no blur/shimmer', () => {
  it('is a collapsed side tab that expands on tap — not a blurred/shimmering always-visible pill', () => {
    expect(feed).toContain('ShopSideTab');
    expect(shopTab).toContain('function ShopSideTab(');
    expect(shopTab).toContain('styles.thumb');
    expect(shopTab).not.toContain('<BlurView');
    expect(shopTab).not.toContain('LinearGradient');
    expect(shopTab).not.toContain('styles.shimmer');
    expect(feed).not.toContain('mediaTagName');
  });

  it('shows the real product thumbnail when available, falling back to a bag icon', () => {
    expect(shopTab).toContain('tag.imageUri ? (');
    expect(shopTab).toContain('<Feather name="shopping-bag"');
  });
});

describe('Real price and image plumbed from server to the pill', () => {
  it('server computes a tagged product\'s price from its cheapest variant (products has no price column)', () => {
    expect(postsRoute).toContain('async function productMinPrices(');
    expect(postsRoute).toContain('min(${productVariants.priceCents})');
  });

  it('all three routes that return taggedProducts attach priceCents', () => {
    const matches = postsRoute.match(/priceCents: minPriceByProduct\[[^\]]+\] \?\? 0/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(postsRoute).toContain('tags.map((t) => ({ ...t, priceCents: minPriceByProduct[t.productId] ?? 0 }))');
  });

  it('the client carries the product image through to productTags', () => {
    expect(social).toContain('imageUri: Array.isArray(tag.images) ? tag.images[0] : tag.imageUri');
    expect(social).toContain('imageUri: Array.isArray(t.images) ? t.images[0] : t.imageUri');
  });
});
