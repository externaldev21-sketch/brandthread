/**
 * Cross-screen wiring for the profile redesign's connection fixes — the pieces
 * that live in shared screens (feed player, product detail, checkout, orders,
 * DMs) and can't render under Vitest are pinned at the source level, next to
 * the pure helpers they call (tested in lib/__tests__/profileNavigation.test.ts).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { BUYER_PROTECTION_STATUS, BUYER_PROTECTION_TITLE, buyerProtectionLines } from '@/content/buyerProtection';
import { LEGAL_DOCUMENTS } from '@/content/legal';
import { computeProfileLayout, PROFILE_WEB_COLUMN } from '@/components/profile/profileGeometry';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('buyer protection shown wherever a buyer commits money', () => {
  it('quotes the Terms verbatim (no new copy) and never shows a drafting placeholder', () => {
    const buying = LEGAL_DOCUMENTS.terms.sections.find((section) => section.title === 'Buying on Brandthread')!;
    const [line] = buyerProtectionLines();
    expect(buying.bullets).toContain(line);
    const preorderLines = buyerProtectionLines({ preorder: true });
    expect(preorderLines).toHaveLength(2);
    for (const text of preorderLines) expect(text).not.toContain('[');
    // Heading reuses the existing buyer-settings purchase protection label.
    expect(read('app/buyer-settings-detail.tsx')).toContain(`label: '${BUYER_PROTECTION_TITLE}'`);
    expect(read('app/buyer-settings-detail.tsx')).toContain(`value: '${BUYER_PROTECTION_STATUS}'`);
  });

  it('renders the same note on product detail, checkout, and order detail', () => {
    for (const file of ['app/buyer-product-detail.tsx', 'app/buyer-checkout.tsx', 'app/buyer-order-detail.tsx']) {
      const source = read(file);
      expect(source, file).toContain("import { BuyerProtectionNote } from '@/components/BuyerProtectionNote';");
      expect(source, file).toContain('<BuyerProtectionNote');
    }
  });
});

describe('feed player reuse from profiles', () => {
  const feed = read('app/(tabs)/feed.tsx');
  const route = read('app/profile-videos.tsx');

  it('the profile video route renders the main feed player scoped to a creator/product', () => {
    expect(route).toContain("import FeedScreen from './(tabs)/feed';");
    expect(route).toContain('creatorFeed={{');
    expect(feed).toContain('creatorFeed?: CreatorFeedConfig;');
    expect(feed).toContain('loadVideoFeedThrough(creatorSource, creatorId');
    // Opens at the tapped video.
    expect(feed).toContain('initialScrollIndex={isCreatorFeed && creatorStartIndex > 0');
  });

  it('opens the right profile from the rail / name, and returns to the profile inside its own player', () => {
    expect(feed).toContain('onOpenCreator(item);');
    expect(feed).toContain("accountType: item.authorAccountType ?? 'seller'");
    expect(feed).toContain("creatorSource === 'creator' && creatorId && item.sellerId === creatorId && router.canGoBack()");
    // The friend-repost link used to pass `id`, which buyer-other-profile ignores.
    expect(feed).not.toContain("'/buyer-other-profile?id='");
    expect(feed).toContain("profileHref({ userId: friend.userId, accountType: 'buyer'");
  });
});

describe('product detail → seller, DM, and featured videos', () => {
  const pdp = read('app/buyer-product-detail.tsx');
  const dm = read('app/buyer-conversation.tsx');

  it('links product detail to the seller profile, a product DM, and the videos featuring it', () => {
    expect(pdp).toContain("profileHref({ userId: product.sellerId, accountType: 'seller' })");
    expect(pdp).toContain('messageSellerAboutProductHref({');
    expect(pdp).toContain("profileVideosHref({ source: 'product', id: productId, startPostId: video.id");
  });

  it('carries the product into the DM: passes contextProductId and stages the product card', () => {
    expect(dm).toContain('contextProductId:   params.contextProductId,');
    expect(dm).toContain("type: 'product',");
    expect(dm).toContain('meta: { productId },');
    expect(dm).toContain("'/buyer-product-detail?productId=' + encodeURIComponent(conv.contextProductId)");
  });
});

describe('orders link to the counterparty and the product', () => {
  it('buyer order detail links items to product detail and the seller to their profile', () => {
    const source = read('app/buyer-order-detail.tsx');
    expect(source).toContain('router.push(productDetailHref(productId) as never);');
    expect(source).toContain("router.push(profileHref({ userId: order.sellerId, accountType: 'seller' }) as never);");
    expect(source).toContain("productId:      typeof item.productId === 'string' ? item.productId : null,");
  });

  it('seller order detail links items to the seller product screen and the buyer to their profile', () => {
    const source = read('app/order-detail.tsx');
    expect(source).toContain('productDetailHref(li.productId, { isOwner: true })');
    expect(source).toContain("profileHref({ userId: c.buyerUserId!, accountType: 'buyer'");
    expect(source).not.toContain('productId:        item.variantId ?? item.id,');
  });
});

describe('profile layout geometry', () => {
  it('uses a 3-column 9:16 grid on phones at every target size', () => {
    for (const [width, height] of [[375, 667], [390, 844], [430, 932]]) {
      const layout = computeProfileLayout(width, height, 'ios');
      expect(layout.columnWidth).toBe(width);
      expect(layout.gridColumns).toBe(3);
      expect(layout.tileWidth * 3 + 2 * 2).toBeLessThanOrEqual(width);
      expect(Math.abs(layout.tileHeight / layout.tileWidth - 16 / 9)).toBeLessThan(0.02);
      // The hero leaves room for the identity block above the fold.
      expect(layout.heroHeight).toBeLessThan(height * 0.5);
      expect(layout.heroHeight).toBeGreaterThanOrEqual(280);
    }
  });

  it('centers a fixed app column on desktop web instead of stretching', () => {
    const layout = computeProfileLayout(1440, 900, 'web');
    expect(layout.isDesktopWeb).toBe(true);
    expect(layout.columnWidth).toBe(PROFILE_WEB_COLUMN);
    expect(layout.gridColumns).toBe(3);
    // Tiles keep phone proportions (no stretched images).
    expect(Math.abs(layout.tileHeight / layout.tileWidth - 16 / 9)).toBeLessThan(0.02);
  });
});
