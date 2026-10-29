import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findItem } from '@/lib/sellerControlCenter';
import { keepShopping, shopperRoutesFor } from '@/lib/navigation/shopperRoutes';
import { activityHref, type ActivityItem } from '@/lib/activity';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('Watch Threads: the seller Studio menu card', () => {
  it('is a real card that opens the root-stack Watch Threads screen', () => {
    expect(findItem('watch-threads')).toMatchObject({ label: 'Watch Threads', icon: 'play-circle', route: '/watch-threads' });
  });

  it('renders the buyer Home feed (same FeedScreen props) with a Back control, not the buyer tab shell', () => {
    const screen = read('app/watch-threads.tsx');
    expect(screen).toContain('<FeedScreen showFashionPreview onBack={handleBack} />');
    expect(read('app/(buyer)/index.tsx')).toContain('<FeedScreen showFashionPreview />');
    expect(screen).not.toMatch(/'\/\(buyer\)/);
  });

  it('hides the seller tab bar over the full-bleed feed and its Bag', () => {
    const layout = read('app/_layout.tsx');
    const denyList = layout.slice(layout.indexOf('const SELLER_TAB_BAR_FULL_SCREEN_SEGMENTS'), layout.indexOf(']);', layout.indexOf('const SELLER_TAB_BAR_FULL_SCREEN_SEGMENTS')));
    expect(denyList).toContain("'watch-threads'");
    expect(denyList).toContain("'bag'");
  });
});

describe('shopperRoutes: a seller shopping never lands in the buyer tab shell', () => {
  it('maps a seller to root-stack Bag / Watch Threads / purchases and a buyer to their tabs', () => {
    expect(shopperRoutesFor('seller')).toEqual({ isSeller: true, bag: '/bag', shopping: '/watch-threads', purchases: '/purchases' });
    expect(shopperRoutesFor('buyer')).toEqual({ isSeller: false, bag: '/(buyer)/cart', shopping: '/(buyer)/discover', purchases: '/(buyer)/orders' });
    expect(shopperRoutesFor(null).isSeller).toBe(false);
  });

  it('keepShopping pops a seller back to Watch Threads and replaces a buyer to Discover', () => {
    const calls: string[] = [];
    const router = { replace: (h: unknown) => calls.push(`replace ${h}`), dismissTo: (h: unknown) => calls.push(`dismissTo ${h}`) };
    keepShopping(router, shopperRoutesFor('seller'));
    keepShopping(router, shopperRoutesFor('buyer'));
    expect(calls).toEqual(['dismissTo /watch-threads', 'replace /(buyer)/discover']);
  });

  it('the seller Bag and purchases screens are the buyer screens re-exported on the root stack', () => {
    expect(read('app/bag.tsx')).toContain("export { default } from './(buyer)/cart';");
    expect(read('app/purchases.tsx')).toContain("export { default } from './(buyer)/orders';");
  });

  it('no purchase-flow screen hardcodes the buyer Bag any more', () => {
    for (const file of ['app/(tabs)/feed.tsx', 'app/buyer-product-detail.tsx', 'components/ShopProductSheet.tsx', 'app/buyer-checkout.tsx']) {
      expect(read(file), file).not.toContain("'/(buyer)/cart'");
    }
  });

  it('a buyer-order activity row without an id opens the account’s own purchases', () => {
    const row = { targetType: 'buyer_order', targetId: null, type: 'order_shipped' } as unknown as ActivityItem;
    expect(activityHref(row, 'seller')).toBe('/purchases');
    expect(activityHref(row, 'buyer')).toBe('/(buyer)/orders');
  });
});
