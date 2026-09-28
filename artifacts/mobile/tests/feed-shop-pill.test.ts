/**
 * Structure tests for the shop trigger (a compact dark-glass "Shop" pill
 * living inside CaptionBlock's bottom-left stack, directly above the
 * creator name, that glides out into a name/price strip on tap — see
 * components/buyer-feed/ShopSideTab.tsx) and the fix that makes its
 * price/thumbnail real: the server never sent a tagged product's price or
 * image through the feed/detail routes, so the trigger always showed $0.00
 * with a generic bag icon — this plumbs the real data through server ->
 * socialService -> feed.
 *
 * Resting-pill redesign: the old vertical rotated "SHOP" side tab (a
 * screen-edge strip with a small product-count badge) is gone — no count
 * badge anywhere on the resting state, no BlurView/shimmer, no live blur
 * (still `<Glass noBlur>` — a live blur re-sampling the playing video every
 * frame is a visible shimmer/glitch, not a decorative effect). */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const feed = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');
const social = readFileSync(resolve(__dirname, '../services/socialService.ts'), 'utf8');
const postsRoute = readFileSync(resolve(__dirname, '../../api-server/src/routes/posts.ts'), 'utf8');
const shopTab = readFileSync(resolve(__dirname, '../components/buyer-feed/ShopSideTab.tsx'), 'utf8');

describe('Shop trigger — pill in the caption stack, no count badge, no blur/shimmer', () => {
  it('is a pill inside CaptionBlock\'s stack that expands on tap — not a rotated edge tab with a count badge', () => {
    expect(feed).toContain('ShopSideTab');
    expect(shopTab).toContain('function ShopTagPill(');
    expect(shopTab).toContain('function useShopTagPill(');
    expect(shopTab).toContain('styles.thumb');
    expect(shopTab).not.toContain('<BlurView');
    expect(shopTab).not.toContain('styles.shimmer');
    // No product-count badge anywhere on the resting state.
    expect(shopTab).not.toContain('countBadge');
    expect(shopTab).not.toContain("rotate: '-90deg'");
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
