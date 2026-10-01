import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const studio = readFileSync(resolve(process.cwd(), 'components/SellerStudioRadialMenu.tsx'), 'utf8');
const controlCenter = readFileSync(resolve(process.cwd(), 'lib/sellerControlCenter.ts'), 'utf8');
const routeFlag = readFileSync(resolve(process.cwd(), 'lib/sellerActivityRoute.ts'), 'utf8');

/**
 * Dev: add an Activity card to the Studio carousel, right after Analytics,
 * opening /seller-activity (built in parallel by another session). Since
 * that route doesn't exist on this branch yet and there's no runtime way to
 * ask Expo Router "does this route exist" (routes resolve from the file
 * system at build time), the card is gated behind a single boolean flag
 * (lib/sellerActivityRoute.ts) rather than shown unconditionally — flipping
 * that flag to true is the only change needed once the route lands.
 */
describe('Studio carousel: Activity card, gated behind the /seller-activity route existing', () => {
  it('defines the activity item (label, icon, route) behind SELLER_ACTIVITY_ROUTE_LIVE in sellerControlCenter.ts', () => {
    expect(controlCenter).toContain("import { SELLER_ACTIVITY_ROUTE_LIVE } from '@/lib/sellerActivityRoute';");
    expect(controlCenter).toContain("...(SELLER_ACTIVITY_ROUTE_LIVE");
    expect(controlCenter).toContain("id: 'activity'");
    expect(controlCenter).toContain("label: 'Activity'");
    expect(controlCenter).toContain("route: '/seller-activity'");
  });

  it('places activity right after analytics in CARD_ORDER, also gated behind the same flag', () => {
    expect(studio).toContain("import { SELLER_ACTIVITY_ROUTE_LIVE } from '@/lib/sellerActivityRoute';");
    const orderBlock = studio.slice(studio.indexOf('const CARD_ORDER = ['), studio.indexOf('];', studio.indexOf('const CARD_ORDER = [')));
    expect(orderBlock).toContain("'post-video', 'add-product', 'go-live', 'analytics',");
    expect(orderBlock).toContain("...(SELLER_ACTIVITY_ROUTE_LIVE ? ['activity'] : [])");
    // Still appears strictly after 'analytics' and strictly before 'payouts'
    // in source order, regardless of the flag's runtime value.
    expect(orderBlock.indexOf("'analytics'")).toBeLessThan(orderBlock.indexOf("'activity'"));
    expect(orderBlock.indexOf("'activity'")).toBeLessThan(orderBlock.indexOf("'payouts'"));
  });

  it('the flag defaults to false (route not live yet) with a doc comment explaining why and when to flip it', () => {
    expect(routeFlag).toContain('export const SELLER_ACTIVITY_ROUTE_LIVE = false;');
    expect(routeFlag).toContain('/seller-activity');
  });

  it('has its own per-card micro-animation entry, same as every other card', () => {
    expect(studio).toContain("'activity': 'pop-in'");
  });

  it('shows a small presence-only unread dot (no number) when the Activity Center has unread items, using the same hook ActivityBellButton already exposes', () => {
    expect(studio).toContain("import { useActivityUnreadCount } from '@/components/ActivityBellButton';");
    expect(studio).toContain('const unreadActivityCount = useActivityUnreadCount();');
    expect(studio).toContain("item.id === 'activity' && unreadActivityCount > 0");
    expect(studio).toContain('testID="seller-control-center-activity-unread-dot"');
    // A dot, not a number — no text node inside it.
    const dotBlock = studio.slice(studio.indexOf("item.id === 'activity' && unreadActivityCount > 0"), studio.indexOf('/>', studio.indexOf("item.id === 'activity' && unreadActivityCount > 0")));
    expect(dotBlock).not.toContain('<Text');
  });

  it('adds no new card dimensions/layout — reuses the existing card/icon/cover styles untouched', () => {
    expect(studio).toContain('<Feather name={item.icon as any} size={108} color={theme.text} style={styles.cardIconGlyph} />');
    expect(studio).toContain('<StudioCoverBackdrop />');
  });
});
