/**
 * Structure tests for the redesigned shop pill (compact glass pill with
 * product thumbnail + price + shimmer, above the creator name) and the
 * fix that makes its price/thumbnail real: the server never sent a tagged
 * product's price or image through the feed/detail routes, so the pill
 * always showed $0.00 with a generic bag icon — this plumbs the real data
 * through server -> socialService -> feed.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const feed = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');
const social = readFileSync(resolve(__dirname, '../services/socialService.ts'), 'utf8');
const postsRoute = readFileSync(resolve(__dirname, '../../api-server/src/routes/posts.ts'), 'utf8');

describe('Shop pill — compact glass trigger', () => {
  it('is a small pill with a thumbnail, price, and shimmer — not the old wide row', () => {
    expect(feed).toContain('function ShopPill(');
    expect(feed).toContain('styles.shopPillThumb');
    expect(feed).toContain('styles.shopPillShimmer');
    expect(feed).toContain('<BlurView');
    expect(feed).not.toContain('mediaTagName');
  });

  it('shows the real product thumbnail when available, falling back to a bag icon', () => {
    expect(feed).toContain('tag.imageUri ? (');
    expect(feed).toContain('<Feather name="shopping-bag"');
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
