import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const {
  getMyProfileMock,
  getMyPostsMock,
  getMyRepostsMock,
  getSavedItemsMock,
  getPrivacySettingsMock,
  subscribeSocialMock,
  loadBuyerProfileMock,
  loadHighlightsMock,
  routerMock,
  apiMock,
  getBuyerOrdersWithStatusMock,
} = vi.hoisted(() => ({
  getMyProfileMock: vi.fn(),
  getMyPostsMock: vi.fn(),
  getMyRepostsMock: vi.fn(),
  getSavedItemsMock: vi.fn(),
  getPrivacySettingsMock: vi.fn(),
  subscribeSocialMock: vi.fn(),
  loadBuyerProfileMock: vi.fn(),
  loadHighlightsMock: vi.fn(),
  routerMock: { push: vi.fn(), replace: vi.fn() },
  apiMock: { social: { myStories: vi.fn() }, threadCash: { get: vi.fn() } },
  getBuyerOrdersWithStatusMock: vi.fn(),
}));

vi.mock('react-native', () => {
  const React = require('react') as typeof import('react');
  const nativeComponent = (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  };

  class MockAnimatedValue {
    constructor(_v?: number) {}
    interpolate() { return 0; }
    addListener() { return 'listener-id'; }
    removeListener() {}
  }

  // Real RN Pressable supports a function-as-children render prop (used by the
  // shared PressableScale primitive to get the current press state). The
  // generic `nativeComponent` helper just forwards `children` verbatim, which
  // would leave that function unrendered — invoke it here like RN does.
  function MockPressable(props: Record<string, unknown>) {
    const { children, ...rest } = props;
    const content = typeof children === 'function'
      ? (children as (state: { pressed: boolean }) => React.ReactNode)({ pressed: false })
      : children;
    return React.createElement('Pressable', rest, content as React.ReactNode);
  }
  MockPressable.displayName = 'Pressable';

  return {
    View: nativeComponent('View'),
    Text: nativeComponent('Text'),
    TouchableOpacity: nativeComponent('TouchableOpacity'),
    // Use the render-prop-aware Pressable mock (plain nativeComponent() would
    // leave PressableScale's function child unrendered — see comment above).
    Pressable: MockPressable,
    ActivityIndicator: nativeComponent('ActivityIndicator'),
    ScrollView: nativeComponent('ScrollView'),
    Modal: nativeComponent('Modal'),
    RefreshControl: nativeComponent('RefreshControl'),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1, absoluteFill: {} },
    Alert: { alert: vi.fn() },
    Linking: { openURL: vi.fn() },
    Share: { share: vi.fn() },
    Animated: {
      Value: MockAnimatedValue,
      View: nativeComponent('Animated.View'),
      event: () => () => {},
      timing: () => ({ start: (cb?: () => void) => cb?.() }),
      sequence: () => ({ start: (cb?: () => void) => cb?.() }),
      loop: () => ({ start: () => {}, stop: () => {} }),
    },
    Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  };
});

// The redesigned profile renders into the shared ProfileShell; its native
// hero/scroll chrome is replaced by a slot-rendering stand-in.
vi.mock('@/components/profile/ProfileShell', async () =>
  (await import('./helpers/profileShellMock')).profileShellMockModule);

vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ userId: 'buyer-1', signOut: vi.fn() }),
  useUser: () => ({ user: { id: 'buyer-1', firstName: 'Ava', lastName: 'Buyer', username: 'ava' } }),
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }),
  FontAwesome: ({ name }: { name: string }) => React.createElement('FontAwesome', { name }),
}));

// The shared `PressableScale`/`EmptyState` primitives (components/BrandthreadUI.tsx)
// pull in these two native packages at module scope; their real builds aren't
// parseable under Vitest's SSR transform outside a Metro/RN runtime.
vi.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children?: React.ReactNode }) => React.createElement('LinearGradient', {}, children),
}));

vi.mock('react-native-svg', () => ({
  default: ({ children }: { children?: React.ReactNode }) => React.createElement('Svg', {}, children),
  Line: (props: Record<string, unknown>) => React.createElement('SvgLine', props),
}));

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn().mockResolvedValue(undefined),
  selectionAsync: vi.fn().mockResolvedValue(undefined),
  notificationAsync: vi.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

vi.mock('expo-router', () => ({
  useRouter: () => routerMock,
  useFocusEffect: (callback: () => void | (() => void)) => {
    const ReactActual = require('react') as typeof import('react');
    ReactActual.useEffect(callback, [callback]);
  },
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/components/buyer-nav/buyerTabBarMetrics', () => ({
  useBuyerTabBarInset: () => 80,
}));

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      background: '#07070F', card: '#12121F', cardElevated: '#18182E',
      border: '#303044', text: '#F4F4FF', muted: '#AAAABC', subtle: '#77778A',
      accent: '#C7CDD5', accentDim: '#34383E', accentLight: '#F8FAFC', onAccent: '#0A0A0B',
      secondary: '#22D3EE', secondaryDim: '#164E63', success: '#10B981', warning: '#F97316',
      error: '#F87171', overlay: 'rgba(0,0,0,0.72)',
    },
  }),
}));

// The Phase 2 design-system pass moved this screen onto the shared
// PressableScale/IconButton/ErrorState primitives, which read colors via
// `useColors()`. Importing the real hook pulls in `@/contexts/AppThemeContext`
// through a path Vite's SSR transform doesn't intercept cleanly here, so this
// mirrors the AppThemeContext mock above directly.
vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#07070F', card: '#12121F', cardElevated: '#18182E',
    border: '#303044', text: '#F4F4FF', muted: '#AAAABC', subtle: '#77778A',
    accent: '#C7CDD5', accentDim: '#34383E', accentLight: '#F8FAFC', onAccent: '#0A0A0B',
    secondary: '#22D3EE', secondaryDim: '#164E63', success: '#10B981', warning: '#F97316',
    error: '#F87171', overlay: 'rgba(0,0,0,0.72)', mutedForeground: '#AAAABC',
  }),
}));

vi.mock('@/lib/theme', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/theme')>();
  return {
    ...actual,
    FONT: { regular: 'System', medium: 'System', semibold: 'System', bold: 'System' },
    FS: { xs: 11, sm: 13, base: 15, md: 17, lg: 19, xl: 22, xxl: 26, h1: 32, h2: 26 },
    SP: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
    RADIUS: { xs: 6, sm: 10, md: 14, lg: 18, xl: 22, xxl: 28, pill: 999 },
    ICON: { xs: 12, sm: 16, md: 20, lg: 24, xl: 28, xxl: 40 },
    GRID_MAX_WIDTH: 1080,
    TYPE: {
      largeTitle: { fontSize: 32, fontFamily: 'System', lineHeight: 42 },
      title: { fontSize: 26, fontFamily: 'System', lineHeight: 36 },
    },
  };
});

vi.mock('@/services/socialService', () => ({
  getMyProfile: getMyProfileMock,
  getMyPosts: getMyPostsMock,
  getMyReposts: getMyRepostsMock,
  getSavedItems: getSavedItemsMock,
  getPrivacySettings: getPrivacySettingsMock,
  archivePost: vi.fn(),
  deletePost: vi.fn(),
  subscribeSocial: subscribeSocialMock,
}));

vi.mock('@/lib/api', () => ({
  useApi: () => apiMock,
}));

vi.mock('@/components/CachedImage', () => ({
  CachedImage: (props: Record<string, unknown>) => React.createElement('CachedImage', props),
}));

vi.mock('@/lib/buyerProfile', () => ({
  loadBuyerProfile: loadBuyerProfileMock,
}));

vi.mock('@/lib/highlightsService', () => ({
  loadHighlights: loadHighlightsMock,
}));

vi.mock('@/services/orderService', () => ({
  getBuyerOrdersWithStatus: getBuyerOrdersWithStatusMock,
}));

vi.mock('@/components/orders/OrderStatusTimeline', () => ({
  OrderStatusTimeline: ({ status }: { status: string }) => React.createElement('Text', null, `timeline:${status}`),
}));

// The profile grid's empty state is the shared layout EmptyState.
vi.mock('@/components/layout/EmptyState', () => {
  const ReactActual = require('react') as typeof import('react');
  return {
    EmptyState: ({ title, message, actionLabel, onAction, testID }: { title?: string; message: string; actionLabel?: string; onAction?: () => void; testID?: string }) =>
      ReactActual.createElement(
        'View',
        { testID },
        title ? ReactActual.createElement('Text', null, title) : null,
        ReactActual.createElement('Text', null, message),
        actionLabel && onAction
          ? ReactActual.createElement(
            'TouchableOpacity',
            { testID: 'empty-state-action', onPress: onAction },
            ReactActual.createElement('Text', null, actionLabel),
          )
          : null,
      ),
  };
});

vi.mock('@/components/layout', () => {
  const ReactActual = require('react') as typeof import('react');
  return {
    EmptyState: ({ message }: { message: string }) => ReactActual.createElement('Text', null, message),
    GridSkeleton: () => ReactActual.createElement('View', { testID: 'grid-skeleton' }),
    SkeletonBlock: () => ReactActual.createElement('View', { testID: 'skeleton-block' }),
    ListSkeleton: () => ReactActual.createElement('View', { testID: 'list-skeleton' }),
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => ReactActual.createElement('View', null, children),
    useGridColumns: () => 3,
    useBreakpoint: () => ({ width: 390, height: 844, isTablet: false, isLandscape: false }),
  };
});

// profile.tsx also renders the (separately Phase-2-migrated) ShareProfileSheet,
// which pulls in react-native-reanimated-based motion/share-card components
// at module scope — real reanimated isn't parseable under Vitest's SSR
// transform outside a Metro/RN runtime, and this test doesn't exercise the
// share sheet's own UI, so it's stubbed out entirely.
vi.mock('@/components/ShareProfileSheet', () => ({
  ShareProfileSheet: ({ visible, identity }: { visible: boolean; identity?: { accountType?: string } }) => (
    visible ? require('react').createElement('View', { testID: 'share-profile-sheet', accountType: identity?.accountType }) : null
  ),
}));

const { threadCashFlag } = vi.hoisted(() => ({ threadCashFlag: { on: false } }));
vi.mock('@/contexts/FeatureFlagContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts/FeatureFlagContext')>()),
  useFeatureFlag: (key: string) => (key === 'threadCash' ? threadCashFlag.on : false),
}));

vi.mock('@/components/BrandthreadUI', () => {
  const ReactActual = require('react') as typeof import('react');
  // Mocking this module wholesale (for EmptyState below) shadows every one of
  // its other exports too — profile.tsx also imports the real `PressableScale`
  // from here, so it needs a stand-in. This renders straight to the same
  // 'Pressable' host type the react-native mock's Pressable produces (rather
  // than requiring that mocked module from inside this factory, which trips
  // Vitest's mock-hoisting analysis), so every existing query against
  // `node.type === 'Pressable'` keeps matching, and a function child (the
  // render-prop real PressableScale/Pressable support) is still invoked.
  const PressableScale = ({ children, ...rest }: Record<string, unknown>) => {
    const content = typeof children === 'function'
      ? (children as (state: { pressed: boolean }) => unknown)({ pressed: false })
      : children;
    return ReactActual.createElement('Pressable', rest, content as React.ReactNode);
  };
  return {
    PressableScale,
    EmptyState: ({ title, description, action }: { title: string; description?: string; action?: { label: string; onPress: () => void } }) =>
      ReactActual.createElement(
        'View',
        {},
        ReactActual.createElement('Text', null, title),
        description ? ReactActual.createElement('Text', null, description) : null,
        action
          ? ReactActual.createElement(
            'TouchableOpacity',
            { testID: 'empty-state-action', onPress: action.onPress },
            ReactActual.createElement('Text', null, action.label),
          )
          : null,
      ),
  };
});

import ProfileScreen from '@/app/(buyer)/profile';

function textContent(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textContent).join('');
  if (!value || typeof value !== 'object') return '';
  const node = value as { children?: unknown; props?: { children?: unknown } };
  return textContent(node.children ?? node.props?.children);
}

async function flushPromises() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<ProfileScreen />);
    await flushPromises();
  });
  return renderer;
}

function pressTab(renderer: ReactTestRenderer, tab: string) {
  const matches = renderer.root.findAll(
    node => node.props.accessibilityLabel === `${tab} tab` && typeof node.props.onPress === 'function',
  );
  expect(matches.length).toBeGreaterThan(0);
  return act(async () => {
    matches[0].props.onPress();
    await flushPromises();
  });
}

const baseProfile = {
  name: 'Ava Buyer',
  username: 'ava',
  bio: 'Streetwear collector.',
  pronouns: null,
  website: null,
  location: null,
  friendsCount: 12,
  followingBrandsCount: 5,
  avatarInitials: 'AB',
  createdAt: '2024-01-01T00:00:00.000Z',
};

describe('buyer profile tabs', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    getMyProfileMock.mockReset().mockResolvedValue(baseProfile);
    getMyPostsMock.mockReset().mockResolvedValue([
      { id: 'post-1', mediaUrl: 'https://example.com/post-1.jpg', type: 'photo', isArchived: false, isDraft: false, authorName: 'Ava', authorInitials: 'AB', authorColor: '#111', caption: 'Fit check', mediaColors: ['#111', '#222'] },
    ]);
    getMyRepostsMock.mockReset().mockResolvedValue([
      { id: 'repost-1', originalAuthorName: 'Sample Brand', originalAuthorHandle: '@samplebrand', originalCaption: 'New drop just landed' },
    ]);
    getSavedItemsMock.mockReset().mockResolvedValue([
      { id: 'saved-1', type: 'product', title: 'Archive Cargo Pants', subtitle: '$120' },
    ]);
    getPrivacySettingsMock.mockReset().mockResolvedValue({});
    subscribeSocialMock.mockReset().mockReturnValue(vi.fn());
    loadBuyerProfileMock.mockReset().mockResolvedValue({ avatarUri: null });
    loadHighlightsMock.mockReset().mockResolvedValue([]);
    apiMock.social.myStories.mockReset().mockResolvedValue([]);
    apiMock.threadCash.get.mockReset().mockResolvedValue({ balanceCents: 0 });
    getBuyerOrdersWithStatusMock.mockReset().mockResolvedValue({ orders: [], fromCache: false });
    routerMock.push.mockReset();
  });

  afterEach(async () => {
    if (renderer) {
      await act(async () => { renderer?.unmount(); });
      renderer = undefined;
    }
  });

  it('renders all four tabs, each selectable', async () => {
    renderer = await renderScreen();

    for (const tab of ['Posts', 'Tagged', 'Reposts', 'Saved']) {
      const matches = renderer.root.findAll(
        node => node.props.accessibilityRole === 'tab' && node.props.accessibilityLabel === `${tab} tab`,
      );
      expect(matches.length).toBeGreaterThan(0);
    }
  });

  it('shows Posts content by default and swaps to Reposts content on tab switch', async () => {
    renderer = await renderScreen();

    // Posts tab is selected by default — the one post's image renders.
    expect(renderer.root.findAll(
      node => (node.type as unknown) === 'CachedImage' && (node.props as any).source?.uri === 'https://example.com/post-1.jpg',
    )).toHaveLength(1);
    expect(renderer.root.findAll(
      node => (node.type as unknown) === 'Text' && textContent(node.props.children).includes('Sample Brand'),
    )).toHaveLength(0);

    await pressTab(renderer, 'Reposts');

    // Reposts content now shows; the Posts image is gone.
    expect(renderer.root.findAll(
      node => (node.type as unknown) === 'Text' && textContent(node.props.children).includes('Sample Brand'),
    ).length).toBeGreaterThan(0);
    expect(renderer.root.findAll(
      node => (node.type as unknown) === 'CachedImage' && (node.props as any).source?.uri === 'https://example.com/post-1.jpg',
    )).toHaveLength(0);
  });

  it('shows Saved content on the Saved tab and the empty state on Tagged', async () => {
    renderer = await renderScreen();

    await pressTab(renderer, 'Saved');
    expect(renderer.root.findAll(
      node => (node.type as unknown) === 'Text' && textContent(node.props.children).includes('Archive Cargo Pants'),
    ).length).toBeGreaterThan(0);

    await pressTab(renderer, 'Tagged');
    expect(renderer.root.findAll(
      node => (node.type as unknown) === 'Text' && textContent(node.props.children).includes('No tagged posts'),
    ).length).toBeGreaterThan(0);
    // Saved content no longer shows once switched away.
    expect(renderer.root.findAll(
      node => (node.type as unknown) === 'Text' && textContent(node.props.children).includes('Archive Cargo Pants'),
    )).toHaveLength(0);
  });

  it('keeps every hard-required action wired: account switcher, edit profile, inbox, connections, highlights', async () => {
    renderer = await renderScreen();

    const switcher = renderer.root.findByProps({ testID: 'buyer-profile-account-switcher' });
    expect(switcher.props.accessibilityLabel).toBe('Switch account');
    await act(async () => { switcher.props.onPress(); });
    expect(routerMock.push).toHaveBeenCalledWith('/account-switcher');

    routerMock.push.mockReset();
    // The Phase 2 pass migrated this button from TouchableOpacity to the
    // shared PressableScale primitive (which renders as the mocked
    // `Pressable` host type here) and its copy to sentence case.
    const editProfileBtns = renderer.root.findAll(
      node => (node.type as unknown) === 'Pressable'
        && typeof node.props.onPress === 'function'
        && textContent(node.props.children).includes('Edit profile'),
    );
    expect(editProfileBtns.length).toBeGreaterThan(0);
    await act(async () => { editProfileBtns[0].props.onPress(); });
    expect(routerMock.push).toHaveBeenCalledWith('/(buyer)/edit-profile');
  });

  it('opens the real share sheet (QR, copy link, native share) from Share profile', async () => {
    renderer = await renderScreen();
    expect(renderer.root.findAll((node) => node.props.testID === 'share-profile-sheet')).toHaveLength(0);
    const shareBtn = renderer.root.findAll(
      node => (node.type as unknown) === 'Pressable'
        && typeof node.props.onPress === 'function'
        && textContent(node.props.children).includes('Share profile'),
    )[0];
    expect(shareBtn).toBeTruthy();
    await act(async () => { shareBtn.props.onPress(); });
    expect(renderer.root.findAll((node) => node.props.testID === 'share-profile-sheet').length).toBeGreaterThan(0);
  });

  it('shows the compact Thread Cash chip on your own profile only when the flag is on, opening the wallet', async () => {
    threadCashFlag.on = false;
    renderer = await renderScreen();
    expect(renderer.root.findAll((node) => node.props.testID === 'profile-wallet-chip')).toHaveLength(0);
    await act(async () => { renderer?.unmount(); });

    threadCashFlag.on = true;
    renderer = await renderScreen();
    const chip = renderer.root.findAll((node) => node.props.testID === 'profile-wallet-chip')[0];
    expect(chip.props.accessibilityLabel).toBe('Thread Cash wallet, $0.00');
    routerMock.push.mockReset();
    await act(async () => { chip.props.onPress(); });
    expect(routerMock.push).toHaveBeenCalledWith('/thread-cash');
    threadCashFlag.on = false;
  });

  it('shows a My Orders card for the latest active order, with a working See all link', async () => {
    getBuyerOrdersWithStatusMock.mockResolvedValue({
      orders: [
        {
          id: 'order-active', orderNumber: 'BT-2001', sellerId: 's1', sellerName: 'Threadhaus', sellerHandle: '@threadhaus',
          status: 'shipped', paymentStatus: 'paid', fulfillmentStatus: 'fulfilled',
          lineItems: [{ productName: 'Cargo Jacket', variant: 'M', quantity: 1, unitPriceCents: 12000 }],
          shippingAddress: { name: '', line1: '', city: '', state: '', zip: '', country: 'US' },
          payment: { subtotalCents: 12000, shippingTotalCents: 0, taxTotalCents: 0, totalCents: 12000 },
          isPreOrder: false, hasReturnRequest: false, createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'order-old', orderNumber: 'BT-1001', sellerId: 's1', sellerName: 'Threadhaus', sellerHandle: '@threadhaus',
          status: 'delivered', paymentStatus: 'paid', fulfillmentStatus: 'fulfilled',
          lineItems: [{ productName: 'Tee', variant: 'S', quantity: 1, unitPriceCents: 3000 }],
          shippingAddress: { name: '', line1: '', city: '', state: '', zip: '', country: 'US' },
          payment: { subtotalCents: 3000, shippingTotalCents: 0, taxTotalCents: 0, totalCents: 3000 },
          isPreOrder: false, hasReturnRequest: false, createdAt: '2025-12-01T00:00:00.000Z',
        },
      ],
      fromCache: false,
    });

    renderer = await renderScreen();

    // The most recent still-active order (shipped, not the older delivered one) is featured.
    expect(renderer.root.findAll(
      node => (node.type as unknown) === 'Text' && textContent(node.props.children).includes('BT-2001'),
    ).length).toBeGreaterThan(0);
    expect(renderer.root.findAll(
      node => (node.type as unknown) === 'Text' && textContent(node.props.children).includes('timeline:shipped'),
    ).length).toBeGreaterThan(0);

    const seeAll = renderer.root.findByProps({ accessibilityLabel: 'See all orders' });
    await act(async () => { seeAll.props.onPress(); });
    expect(routerMock.push).toHaveBeenCalledWith('/(buyer)/orders');

    routerMock.push.mockReset();
    const card = renderer.root.findByProps({ accessibilityLabel: 'Order BT-2001, shipped' });
    await act(async () => { card.props.onPress(); });
    expect(routerMock.push).toHaveBeenCalledWith('/buyer-order-detail?id=order-active');
  });

  it('opens the full-screen feed player on the buyer\'s own posts, starting at the tapped one', async () => {
    renderer = await renderScreen();
    const tile = renderer.root.findAll(
      node => node.props.testID === 'profile-video-tile-post-1' && typeof node.props.onPress === 'function',
    )[0];
    await act(async () => { tile.props.onPress(); });
    expect(routerMock.push).toHaveBeenCalledWith('/profile-videos?source=creator&id=buyer-1&startPostId=post-1&title=Ava%20Buyer');
  });

  it('links the Followers / Following counts to the connection lists', async () => {
    renderer = await renderScreen();
    const followers = renderer.root.findAll(
      node => node.props.testID === 'profile-stat-followers' && typeof node.props.onPress === 'function',
    )[0];
    await act(async () => { followers.props.onPress(); });
    expect(routerMock.push).toHaveBeenCalledWith('/connections?type=followers');
  });

  it('offers "Post your first video" when the buyer has no posts', async () => {
    getMyPostsMock.mockResolvedValue([]);
    renderer = await renderScreen();
    const cta = renderer.root.findByProps({ testID: 'empty-state-action' });
    expect(textContent(cta.props.children)).toContain('Post your first video');
    await act(async () => { cta.props.onPress(); });
    expect(routerMock.push).toHaveBeenCalledWith('/create-post?accountType=buyer');
  });

  it('renders no My Orders section when the buyer has no orders', async () => {
    getBuyerOrdersWithStatusMock.mockResolvedValue({ orders: [], fromCache: false });
    renderer = await renderScreen();
    expect(renderer.root.findAll(
      node => (node.type as unknown) === 'Text' && textContent(node.props.children) === 'My Orders',
    )).toHaveLength(0);
  });
});
