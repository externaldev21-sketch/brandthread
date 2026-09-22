import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const layout = readFileSync(resolve(process.cwd(), 'app/(buyer)/_layout.tsx'), 'utf8');
const profile = readFileSync(resolve(process.cwd(), 'app/(buyer)/profile.tsx'), 'utf8');
const search = readFileSync(resolve(process.cwd(), 'app/(buyer)/search.tsx'), 'utf8');

describe('buyer bottom navigation layout', () => {
  it('renders the four-action capsule + separate Profile circle', () => {
    expect(layout).toContain("name=\"index\"");
    expect(layout).toContain("title: 'Home'");
    expect(layout).toContain("name=\"search\"");
    expect(layout).toContain("name=\"inbox\"");
    expect(layout).toContain("name=\"profile\"");
    expect(layout).toContain('testID="buyer-bottom-tab-bar"');
    // four nav items defined
    expect(layout).toContain("name: 'index'");
    expect(layout).toContain("name: 'discover'");
    expect(layout).toContain("name: 'inbox'");
    expect(layout).toContain("name: 'search'");
  });

  it('uses a frosted glass capsule with BlurView and theme-driven tokens', () => {
    expect(layout).toContain("BlurView");
    expect(layout).toContain("from 'expo-blur'");
    expect(layout).toContain('tabBarBackground');
    expect(layout).toContain('borderCol');
    expect(layout).toContain("from 'react-native-svg'");
    expect(layout).toContain('hairlineWidth');
  });

  it('has a standalone Profile circle button — no label inside it', () => {
    // profile button exists
    expect(layout).toContain('testID="buyer-tab-profile"');
    expect(layout).toContain('profileButton');
    // Profile circle has width/height/borderRadius 54/27
    expect(layout).toContain('width: 54');
    expect(layout).toContain('height: 54');
    expect(layout).toContain('borderRadius: 27');
    // No Profile label text node inside the circle (only NavIcon)
    // The "Profile" label lives only in tabLabel for accessibility, not rendered text
  });

  it('exposes Home tab in Search mode', () => {
    expect(layout).toContain('testID="buyer-search-home"');
    expect(layout).toContain('testID="buyer-tab-search-input"');
    expect(layout).toContain('testID="buyer-tab-search-filters"');
    expect(layout).toContain('searchMode');
    expect(layout).toContain('searchField');
    expect(layout).toContain('searchHome');
  });

  it('tracks keyboard frames with an Expo Go-safe Animated spring', () => {
    expect(layout).toContain("keyboardWillChangeFrame");
    expect(layout).toContain("keyboardDidShow");
    expect(layout).not.toContain("from 'react-native-keyboard-controller'");
    expect(layout).toContain('Animated.spring');
    expect(layout).toContain('translateY: barTranslate');
    expect(layout).toContain('damping:');
    expect(layout).toContain('stiffness:');
  });

  it('bases the search morph on the measured capsule width', () => {
    expect(layout).toContain('onLayout={measurePill}');
    expect(layout).toContain('event.nativeEvent.layout.width');
    expect(layout).toContain('Animated.multiply');
    expect(layout).toContain('searchTransition');
    expect(layout).not.toContain('translateX: 280');
  });

  it('dismisses keyboard when navigating away from search', () => {
    expect(layout).toContain('Keyboard.dismiss');
  });

  it('uses theme-driven accent for filter icon and active tint', () => {
    expect(layout).toContain('accent={theme.accent}');
    expect(layout).toContain("color={accent}");
  });

  it('passes typed queries and filter requests into the hidden Search screen', () => {
    expect(layout).toContain("router.setParams({ q: value }");
    expect(layout).toContain("router.setParams({ filters: '1' }");
    expect(search).toContain('useLocalSearchParams<{ q?: string; filters?: string }>');
    expect(search).toContain("if (typeof tabQuery === 'string') setQuery(tabQuery)");
    expect(search).toContain("if (filterRequest !== '1') return");
  });

  it('keeps every compact control at a 44-point effective touch target', () => {
    expect(layout).toContain('minWidth: 44');
    expect(layout).toContain('minHeight: 44');
    expect(layout).toContain('hitSlop={14}');
    expect(layout).toContain('hitSlop={13}');
  });

  it('has an unread badge on Inbox', () => {
    expect(layout).toContain('TabBadge');
    expect(layout).toContain('inboxBadgeCount');
    expect(layout).toContain('onAccent');
  });

  it('keeps Friends reachable from Profile menu sheet', () => {
    expect(profile).toContain("'/(buyer)/friends'");
    expect(profile).toContain('label="Friends"');
  });

  it('calls Home consistently — screen title is Home not Thread', () => {
    expect(layout).toContain("title: 'Home'");
    expect(layout).toContain("tabBarAccessibilityLabel: 'Home tab'");
    // searchHome button also uses 'Home tab' accessibility label
    expect(layout).toContain("accessibilityLabel=\"Home tab\"");
    expect(layout).not.toContain("title: 'Thread'");
  });

  it('hides Friends from the capsule tab bar', () => {
    // Friends route is present but hidden (href: null)
    expect(layout).toContain("name=\"friends\"");
    expect(layout).toContain("href: null");
    // Friends is NOT in BUYER_NAV_ITEMS
    const navItemsBlock = layout.slice(
      layout.indexOf('BUYER_NAV_ITEMS'),
      layout.indexOf('useKeyboardOffset'),
    );
    expect(navItemsBlock).not.toContain("friends");
  });
});
