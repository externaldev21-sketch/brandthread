import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const layout = read('app/(buyer)/_layout.tsx');
const bar = read('components/buyer-nav/BuyerTabBar.tsx');
const parts = read('components/tab-bar/TabBarParts.tsx');
const sellerBar = read('components/SellerGlobalTabBar.tsx');
const searchContext = read('contexts/BuyerSearchContext.tsx');
const search = read('app/(buyer)/search.tsx');
const profile = read('app/(buyer)/profile.tsx');
const feed = read('app/(tabs)/feed.tsx');

const tabItemsBlock = bar.slice(bar.indexOf('export const BUYER_TAB_ITEMS'), bar.indexOf('type Slot'));

describe('buyer navigation contract', () => {
  it('renders Home · Discover · Inbox · Search in the capsule and Profile in a separate circle', () => {
    expect(layout).toContain('<BuyerTabBar {...props} inboxBadgeCount={inboxBadgeCount} />');
    for (const route of ['index', 'discover', 'inbox', 'search', 'profile']) {
      expect(layout).toContain(`name="${route}"`);
    }
    expect(tabItemsBlock).toContain("{ route: 'index', label: 'Home', icon: 'home' }");
    expect(tabItemsBlock).toContain("{ route: 'discover', label: 'Discover', icon: 'discover' }");
    expect(tabItemsBlock).toContain("{ route: 'inbox', label: 'Inbox', icon: 'inbox' }");
    expect(tabItemsBlock).toContain("{ route: 'search', label: 'Search', icon: 'search' }");
    expect(tabItemsBlock).not.toContain('profile');
    expect(bar).toContain('testID="buyer-bottom-tab-bar"');
    expect(bar).toContain("testID={searchActive ? 'buyer-search-close' : 'buyer-tab-profile'}");
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
    expect(feed).toContain('testID="buyer-home-friends"');
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
    // 36pt field buttons + 4pt hitSlop on every side = 44pt.
    expect(bar).toContain('width: 36');
    expect(bar).toContain('hitSlop={4}');
  });
});

describe('buyer search morph', () => {
  it('keeps Home in the capsule while search is open', () => {
    expect(bar).toContain("testID={isHome && searchActive ? 'buyer-search-home' : `buyer-tab-${item.route}`}");
    expect(bar).toContain("const coveredBySearch = !isHome && searchActive;");
    // Home is never wrapped in an animated style that could hide it.
    expect(bar).toContain('if (isHome) return <View key={item.route}>{slot}</View>;');
  });

  it('slides the field out of the Search slot using measured widths, not fixed pixels', () => {
    expect(bar).toContain('onLayout={onSlotRowLayout}');
    expect(bar).toContain('event.nativeEvent.layout.width');
    expect(bar).toContain('const slot = slotRowWidth.value / BUYER_TAB_SLOT_COUNT;');
    expect(bar).toContain('const collapsedLeft = pad + slot * 3.5 - FIELD_GLYPH_CENTER;');
    expect(bar).toContain('const expandedLeft = pad + slot + 2;');
    expect(bar).not.toMatch(/translateX: \d{3}/);
  });

  it('cannot bounce: the spring is critically damped and clamped', () => {
    expect(bar).toContain('overshootClamping: true');
    expect(bar).toContain('withSpring(target, MORPH_SPRING, onDone)');
    expect(bar).toContain('useReducedMotion()');
  });

  it('rides the keyboard on the UI thread only while search is open', () => {
    expect(bar).toContain('useAnimatedKeyboard({');
    expect(bar).toContain('isStatusBarTranslucentAndroid: true');
    expect(bar).toContain('isNavigationBarTranslucentAndroid: true');
    expect(bar).toContain('searchActive && <NativeKeyboardFollower target={keyboardHeight} />');
    expect(bar).toContain('keyboardHeight.value + metrics.keyboardGap - metrics.bottomOffset');
    expect(bar).not.toContain("from 'react-native-keyboard-controller'");
  });

  it('always offers clear, filters and close, and closing reverses the morph and the keyboard', () => {
    expect(bar).toContain('testID="buyer-tab-search-input"');
    expect(bar).toContain('accessibilityLabel="Search Brandthread"');
    expect(bar).toContain('testID="buyer-tab-search-clear"');
    expect(bar).toContain('testID="buyer-tab-search-filters"');
    expect(bar).toContain("accessibilityLabel={searchActive ? 'Close search' : 'Profile tab'}");
    const close = bar.slice(bar.indexOf('const closeSearch'), bar.indexOf('const openFilters'));
    expect(close).toContain('dismissKeyboard()');
    expect(close).toContain('returnRouteRef.current');
    expect(bar).toContain('Keyboard.dismiss()');
    // The field leaves the tree once the reverse animation finishes.
    expect(bar).toContain('runOnJS(setFieldMounted)(false)');
  });

  it('routes the typed query through context instead of navigation params', () => {
    expect(bar).not.toContain('setParams');
    expect(search).not.toContain('router.setParams');
    expect(bar).toContain('onChangeText={setQuery}');
    expect(search).toContain('useBuyerSearch()');
    expect(search).toContain('handledFiltersRequest');
    expect(searchContext).toContain('keyboardHeight: SharedValue<number>');
    expect(layout).toContain('<BuyerSearchProvider>');
  });

  it('keeps search results clear of the bar and the keyboard', () => {
    expect(search).toContain('height: barInset + keyboardHeight.value + 16');
    expect(search).toContain('keyboardDismissMode="on-drag"');
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
    expect(sellerBar).toContain('useTabBarMetrics()');
  });

  it('the seller bar is icon-only too, with spoken labels', () => {
    expect(sellerBar).not.toMatch(/<Text[\s>]/);
    expect(sellerBar).toContain('`${tabDef.label} tab`');
  });
});
