/**
 * Structure tests for the shop trigger (a frosted dark product chip —
 * thumbnail, name, price or "Sold out", chevron — living inside
 * CaptionBlock's bottom-left stack, directly above the creator name; see
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
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const feed = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');
const social = readFileSync(resolve(__dirname, '../services/socialService.ts'), 'utf8');
const postsRoute = readFileSync(resolve(__dirname, '../../api-server/src/routes/posts.ts'), 'utf8');
const shopTab = readFileSync(resolve(__dirname, '../components/buyer-feed/ShopSideTab.tsx'), 'utf8');
const previewCatalog = readFileSync(resolve(__dirname, '../lib/previewCatalog.ts'), 'utf8');

describe('Product tag chip — in the caption stack, product shown directly (less-AI pass V4/V10)', () => {
  it('is a static chip inside CaptionBlock\'s stack — thumbnail, name, price (or Sold out), chevron; no expand step, no count badge', () => {
    expect(feed).toContain('ShopSideTab');
    expect(shopTab).toContain('function ShopTagPill(');
    expect(shopTab).not.toContain('function useShopTagPill(');
    expect(shopTab).not.toContain('withTiming');
    expect(shopTab).toContain('styles.thumb');
    expect(shopTab).toContain('const THUMB_SIZE = 24;');
    expect(shopTab).toContain('tagPriceLabel(tag.priceCents, soldOut)');
    expect(shopTab).not.toContain('<BlurView');
    expect(shopTab).toContain('noBlur');
    expect(shopTab).not.toContain('styles.shimmer');
    expect(shopTab).not.toContain('countBadge');
    expect(shopTab).not.toContain("rotate: '-90deg'");
    expect(feed).not.toContain('mediaTagName');
  });

  it('sold-out state comes from the real public stock-info endpoint, not from fixture data', () => {
    expect(feed).toContain('useProductSoldOut(item.productTags?.[0]?.productId, isActive || preload)');
    expect(feed).toContain('soldOut={tagSoldOut}');
  });

  it('shows the real product thumbnail when available, falling back to a bag icon', () => {
    expect(shopTab).toContain('tag.imageUri ? (');
    expect(shopTab).toContain('<Feather name="shopping-bag"');
  });
});

describe('Chip tap target — the whole chip opens the sheet, no stray clipboard write', () => {
  it('the thumbnail, name, price and chevron share ONE TouchableOpacity that opens the sheet', () => {
    const touchableOpens = (shopTab.match(/<TouchableOpacity\b/g) ?? []).length;
    expect(touchableOpens).toBe(1);
    expect(shopTab).toContain('onPress={onPress}');
    expect(shopTab).not.toMatch(/<Text style=\{styles\.name\}[^>]*onPress/);
    expect(shopTab).not.toMatch(/<View style=\{styles\.thumb\}[^>]*onPress/);
    expect(shopTab).toContain('<Feather name="chevron-right" size={14} color={ON_DARK} pointerEvents="none" />');
  });

  it('never reads or writes the clipboard — no legitimate reason for a copy action on this pill', () => {
    expect(shopTab).not.toMatch(/Clipboard/);
    expect(shopTab).not.toMatch(/setStringAsync/);
    expect(shopTab).not.toMatch(/navigator\.clipboard/);
    expect(shopTab).not.toMatch(/execCommand\(['"]copy['"]\)/);
  });
});

describe('"Leather Ankle Boots" has a real, always-loading bundled photo (no placeholder icon)', () => {
  it('previewCatalog.ts bundles a local boots image file and points the row at it', () => {
    expect(previewCatalog).toContain("require('../assets/images/products/leather-ankle-boots.jpg')");
    expect(previewCatalog).toContain('ownImage: true');
    expect(previewCatalog).toContain('bootsImageUri()');
    // No more falling back to `images: []` (the old no-photo placeholder
    // path) for this row.
    expect(previewCatalog).not.toMatch(/name: 'Leather Ankle Boots'[^}]*images:\s*\[\]/);
  });

  it('the bundled boots image file actually exists on disk', () => {
    const imgPath = resolve(__dirname, '../assets/images/products/leather-ankle-boots.jpg');
    expect(existsSync(imgPath)).toBe(true);
  });

  it("the feed's own boots product tag also carries a real imageUri (not undefined) so the sheet's tag-switcher never shows a placeholder for it either", () => {
    expect(feed).toContain("require('../../assets/images/products/leather-ankle-boots.jpg')");
    expect(feed).toContain("productId: 'preview-product-11', productName: 'Leather Ankle Boots', priceCents: 21000, imageUri: BOOTS_TAG_IMAGE_URI");
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
