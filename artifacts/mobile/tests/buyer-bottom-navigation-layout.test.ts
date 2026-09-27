import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const layout = read('app/(buyer)/_layout.tsx');
const bar = read('components/buyer-nav/BuyerTabBar.tsx');
const parts = read('components/tab-bar/TabBarParts.tsx');
const sellerBar = read('components/SellerGlobalTabBar.tsx');
const search = read('app/buyer-search.tsx');
const profile = read('app/(buyer)/profile.tsx');
const feed = read('app/(tabs)/feed.tsx');
// The feed's top bar (LIVE / Friends / tabs / search) moved into its own
// component as part of the buyer feed presentation-layer rebuild.
const feedTopBar = read('components/buyer-feed/FeedTopBar.tsx');

const tabItemsBlock = bar.slice(bar.indexOf('export const BUYER_TAB_ITEMS'), bar.indexOf('type Slot'));

describe('buyer navigation contract', () => {
  it('renders Home · Discover · Inbox · Search in the capsule and Profile in a separate circle', () => {
    expect(layout).toContain('<BuyerTabBar {...props} inboxBadgeCount={inboxBadgeCount} />');
    // Search is no longer a Tabs.Screen — it's a standalone full-screen page
    // (app/buyer-search.tsx) pushed from the bar's Search slot, so the bar
    // never morphs into an inline text field over the tabs.
    for (const route of ['index', 'discover', 'inbox', 'profile']) {
      expect(layout).toContain(`name="${route}"`);
    }
    expect(layout).not.toContain('name="search"');
    expect(tabItemsBlock).toContain("{ route: 'index', label: 'Home', icon: 'home' }");
    expect(tabItemsBlock).toContain("{ route: 'discover', label: 'Discover', icon: 'discover' }");
    expect(tabItemsBlock).toContain("{ route: 'inbox', label: 'Inbox', icon: 'inbox' }");
    expect(tabItemsBlock).toContain("{ route: 'search', label: 'Search', icon: 'search' }");
    expect(tabItemsBlock).not.toContain('profile');
    expect(bar).toContain('testID="buyer-bottom-tab-bar"');
    expect(bar).toContain('testID="buyer-tab-profile"');
  });

  it('the Search slot pushes the standalone search page instead of navigating a tab', () => {
    expect(bar).toContain("router.push('/buyer-search'");
    expect(bar).not.toContain('MORPH_SPRING');
    expect(bar).not.toContain('useAnimatedKeyboard');
  });

  it('names the first tab Home everywhere', () => {
    expect(layout).toContain("name=\"index\" options={{ title: 'Home', tabBarAccessibilityLabel: 'Home tab' }}");
    expect(layout).not.toContain("title: 'Thread'");
    expect(bar).toContain('`${item.label} tab`');
    expect(read('app/(buyer)/cart.tsx')).not.toContain('Browse Thread');
  });

  it('keeps Friends reachable from Home and Profile without a slot of its own', () => {
    expect(layout).toContain("name=\"friends\" options={{ title: 'Friends', href: null }}");
    expect(tabItemsBlock).not.toContain('friends');
    expect(feed).toContain("router.navigate('/(buyer)/friends' as never)");
    expect(feedTopBar).toContain('testID="buyer-home-friends"');
    expect(profile).toContain("'/(buyer)/friends'");
    // Friends, Cart and Orders light up the control they were opened from.
    expect(bar).toContain("friends: 'index'");
    expect(bar).toContain("cart: 'index'");
    expect(bar).toContain("orders: 'profile'");
  });

  it('uses real frosted glass with theme tokens, a hairline border and an unclipped shadow', () => {
    expect(parts).toContain("from 'expo-blur'");
    expect(parts).toContain('<BlurView');
    expect(bar).toContain('useAppTheme');
    expect(bar).toContain('<TabBarGlass');
    expect(parts).toContain('`${theme.background}8C`');
    expect(parts).toContain('StyleSheet.hairlineWidth');
    expect(parts).toContain('boxShadow:');
    // The shadow wrapper must not clip, or iOS drops the shadow.
    const shadowBlock = parts.slice(parts.indexOf('export const TAB_BAR_SHADOW'), parts.indexOf('const styles'));
    expect(shadowBlock).not.toContain('overflow');
    expect(bar).toContain('shadow: TAB_BAR_SHADOW');
  });

  it('is icon-only: no visible labels, but every control keeps a spoken label', () => {
    // <TextInput> is the search field; no <Text> labels are rendered.
    expect(bar).not.toMatch(/<Text[\s>]/);
    expect(bar).toContain('accessibilityLabel={label}');
    expect(bar).toContain('`${item.label} tab`');
  });

  it('shows a clear active state, an unread Inbox badge, haptics and tab accessibility', () => {
    expect(bar).toContain('<TabBarIndicator');
    expect(parts).toContain('withSpring(restingX, INDICATOR_SPRING)');
    expect(bar).toContain('<TabBarBadge count={badge} theme={theme} />');
    expect(bar).toContain("unread ${badge === 1 ? 'item' : 'items'}");
    expect(bar).toContain('hapticSelection()');
    expect(parts).toContain('accessibilityRole="tab"');
    expect(parts).toContain('accessibilityState={{ selected: focused }}');
    expect(bar).toContain('accessibilityRole="tablist"');
    expect(bar).toContain("navigation.emit({ type: 'tabPress'");
  });

  it('keeps every control at a 44pt touch target', () => {
    expect(parts).toContain('minWidth: 44');
    expect(parts).toContain('minHeight: 44');
  });
});

describe('buyer search page', () => {
  it('is a standalone full-screen page, not a tab-bar morph', () => {
    expect(search).toContain('router.back()');
    expect(search).toContain("testID=\"buyer-search-field\"");
    expect(search).toContain('keyboardDismissMode="on-drag"');
    expect(bar).not.toContain('setFieldMounted');
    expect(bar).not.toContain('TextInput');
  });
});

describe('buyer and seller bars look like one app', () => {
  it('both bars are built from the same shared parts and sized by the same metrics', () => {
    for (const source of [bar, sellerBar]) {
      expect(source).toContain("from '@/components/tab-bar/TabBarParts'");
      expect(source).toContain('<TabBarGlass');
      expect(source).toContain('<TabBarIndicator');
      expect(source).toContain('<TabBarSlot');
      expect(source).toContain('<TabBarCircle');
      expect(source).toContain('width={metrics.itemWidth}');
      expect(source).toContain('height={metrics.capsuleHeight}');
      expect(source).toContain('size={metrics.circleSize}');
      expect(source).toContain('size={metrics.iconSize}');
      expect(source).toContain('bottom: metrics.bottomOffset');
    }
    expect(bar).toContain('useBuyerTabBarMetrics()');
    // The seller bar has two side circles (Studio + AI) instead of the
    // buyer's one, so its capsule gets a narrower share of the same
    // full-width bar — same shared metrics function, different circle count.
    expect(sellerBar).toContain('useTabBarMetrics(2)');
  });

  it('the seller bar is icon-only too, with spoken labels', () => {
    expect(sellerBar).not.toMatch(/<Text[\s>]/);
    expect(sellerBar).toContain('`${tabDef.label} tab`');
  });
});
