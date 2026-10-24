/**
 * Discover's in-place search overlay (components/discover/search) — the
 * TikTok-style flow that replaced the pushed /buyer-search screen:
 * focused empty state → grouped live suggestions → tabbed results, with
 * recents saved on submit and Cancel collapsing back into Discover.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { apiMock, routerMock, authState, storage } = vi.hoisted(() => ({
  apiMock: {
    public: {
      search: vi.fn(), recent: vi.fn(), removeRecent: vi.fn(), clearRecent: vi.fn(),
      log: vi.fn(), hot: vi.fn(), suggested: vi.fn(),
    },
    publicDiscovery: { trendingBrands: vi.fn(), trendingProducts: vi.fn() },
    social: { search: vi.fn(), follow: vi.fn(), unfollow: vi.fn() },
    hashtags: { search: vi.fn() },
  },
  routerMock: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), setParams: vi.fn() },
  authState: { isSignedIn: true },
  storage: new Map<string, string>(),
}));

vi.mock('react-native', () => {
  const nativeComponent = (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  };
  class MockAnimatedValue { constructor(_v: number) {} setValue() {} }
  const anim = () => ({ start: (cb?: () => void) => cb?.() });
  return {
    ActivityIndicator: nativeComponent('ActivityIndicator'),
    Animated: { Value: MockAnimatedValue, timing: anim, spring: anim, View: nativeComponent('Animated.View') },
    BackHandler: { addEventListener: () => ({ remove: () => {} }) },
    Keyboard: { dismiss: vi.fn() },
    Platform: { OS: 'ios', select: (obj: any) => obj.ios },
    Pressable: nativeComponent('Pressable'),
    ScrollView: nativeComponent('ScrollView'),
    StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1, absoluteFill: {} },
    Text: nativeComponent('Text'),
    TextInput: nativeComponent('TextInput'),
    TouchableOpacity: nativeComponent('TouchableOpacity'),
    View: nativeComponent('View'),
    useWindowDimensions: () => ({ width: 393, height: 852 }),
  };
});
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) }));
vi.mock('react-native-reanimated', () => ({
  default: { View: (props: Record<string, unknown>) => React.createElement('Animated.View', props, props.children as React.ReactNode) },
  useAnimatedStyle: (fn: () => unknown) => fn(),
  useSharedValue: (v: unknown) => ({ value: v }),
  withSpring: (v: unknown, _cfg?: unknown, cb?: (finished: boolean) => void) => { cb?.(true); return v; },
  interpolate: (_v: number, _i: number[], out: number[]) => out[out.length - 1],
  runOnJS: (fn: (...args: unknown[]) => void) => fn,
  withTiming: (v: unknown) => v,
  Easing: { out: (f: unknown) => f, in: (f: unknown) => f, inOut: (f: unknown) => f, cubic: (t: number) => t, linear: (t: number) => t, bezier: () => (t: number) => t },
}));
vi.mock('react-native-gesture-handler', () => {
  const chain: any = new Proxy({}, { get: () => () => chain });
  return {
    Gesture: { Pan: () => chain },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  };
});
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => storage.get(k) ?? null,
    setItem: async (k: string, v: string) => { storage.set(k, v); },
  },
}));
vi.mock('@expo/vector-icons', () => ({ Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }) }));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: (p: Record<string, unknown>) => React.createElement('LinearGradient', p) }));
vi.mock('expo-router', () => ({ useRouter: () => routerMock, useLocalSearchParams: () => ({}) }));
vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn().mockResolvedValue(undefined), selectionAsync: vi.fn().mockResolvedValue(undefined),
  notificationAsync: vi.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' }, NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: authState.isSignedIn ? 'buyer-1' : null, isSignedIn: authState.isSignedIn }) }));
vi.mock('@/lib/api', () => ({ useApi: () => apiMock }));
vi.mock('@/lib/devPreview', () => ({ isPreviewDemoMode: () => false, isBuyerDevPreview: () => false }));
vi.mock('@/lib/previewCatalog', () => ({ getPreviewCatalog: () => [] }));
vi.mock('@/hooks/useSignInGate', () => ({
  useSignInGate: () => ({ isSignedIn: authState.isSignedIn, requireSignIn: () => authState.isSignedIn, goToSignIn: vi.fn() }),
}));
vi.mock('@/hooks/useHeaderTopInset', () => ({ useHeaderTopInset: () => 47 }));
vi.mock('@/components/buyer-nav/buyerTabBarMetrics', () => ({ useBuyerTabBarInset: () => 90 }));
vi.mock('@/contexts/ThreadPullTransitionContext', () => ({ useThreadPull: () => ({ push: routerMock.push }) }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { background: '#000', surface: '#111', card: '#181818', border: '#333', text: '#fff', muted: '#aaa', accent: '#fff', onAccent: '#000' } }),
}));
vi.mock('@/components/BrandthreadUI', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) =>
    React.createElement('EmptyState', {}, React.createElement('Text', {}, `${title} ${description ?? ''}`)),
}));
vi.mock('@/components/search/FilterSheet', () => ({ FilterSheet: () => null }));
vi.mock('@/components/SaveHeart', () => ({ SaveHeart: () => null }));
vi.mock('@/components/CachedImage', () => ({ CachedImage: (p: Record<string, unknown>) => React.createElement('CachedImage', p) }));
vi.mock('@/components/social/FollowButton', () => ({ default: (p: Record<string, unknown>) => React.createElement('FollowButton', p) }));
// PersonRow's unfollow confirm sheet (pulls in the web alert host otherwise).
vi.mock('@/components/ui/ActionSheet', () => ({ showActionSheet: vi.fn() }));

import { DiscoverSearchOverlay } from '@/components/discover/search/DiscoverSearchOverlay';

const flush = () => Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve());

function allText(r: ReactTestRenderer): string {
  const collect = (children: unknown): string => {
    if (children == null || typeof children === 'boolean') return '';
    if (Array.isArray(children)) return children.map(collect).join('');
    if (typeof children === 'object' && children && 'props' in (children as any)) return collect((children as any).props.children);
    return String(children);
  };
  return r.root.findAll((n) => (n.type as unknown) === 'Text').map((n) => collect(n.props.children)).join(' | ');
}

/** Host nodes only — findAllByProps also matches the composite that forwards the prop. */
function hosts(r: ReactTestRenderer, props: Record<string, unknown>) {
  return r.root.findAll((n) => typeof n.type === 'string' && Object.entries(props).every(([k, v]) => n.props[k] === v));
}

async function render(props: Partial<React.ComponentProps<typeof DiscoverSearchOverlay>> = {}) {
  let r!: ReactTestRenderer;
  const onClosed = vi.fn();
  await act(async () => {
    r = create(<DiscoverSearchOverlay from={{ x: 100, y: 59, width: 220, height: 36 }} onClosed={onClosed} {...props} />);
    await flush();
  });
  await act(async () => { await flush(); });
  return { r, onClosed };
}

async function type(r: ReactTestRenderer, value: string) {
  act(() => { r.root.findByProps({ testID: 'buyer-search-field' }).props.onChangeText(value); });
  await act(async () => { vi.advanceTimersByTime(150); await flush(); });
  await act(async () => { await flush(); });
}

const searchPayload = {
  results: [
    { id: 's1', kind: 'brand', name: 'Hoodlum Studio', handle: '@hoodlum', color: '#333', initials: 'HS', sellerId: 's1' },
    { id: 'pr1', kind: 'product', productId: 'pr1', brand: 'Hoodlum Studio', name: 'Boxy Hoodie', priceCents: 8800, color: '#333', initials: 'HS', imageUri: 'https://x/h.jpg' },
    { id: 'v1', kind: 'video', postId: 'v1', caption: 'fit check #hoodie', thumbnailUrl: null, videoUrl: '', authorId: 'b1', authorName: 'Casey', authorHandle: '@casey', authorAvatarUrl: null, authorAccountType: 'buyer', color: '#333', initials: 'C', likesCount: 3 },
    { id: 'v2', kind: 'video', postId: 'v2', caption: 'new drop', thumbnailUrl: null, videoUrl: '', authorId: 's1', authorName: 'Hoodlum Studio', authorHandle: '@hoodlum', authorAvatarUrl: null, authorAccountType: 'seller', color: '#333', initials: 'HS', likesCount: 9 },
  ],
  facets: null,
};

beforeEach(() => {
  vi.useFakeTimers();
  authState.isSignedIn = true;
  storage.clear();
  Object.values(routerMock).forEach((fn) => fn.mockReset());
  apiMock.public.recent.mockResolvedValue({ recent: [{ query: 'linen set', normalized: 'linen set' }, { query: 'Linen Set', normalized: 'linen set' }, { query: 'jorts', normalized: 'jorts' }] });
  apiMock.public.hot.mockResolvedValue({ windowHours: 72, queries: [
    { term: 'cargo pants', rank: 1, count: 8, tag: 'hot' },
    { term: 'baggy jorts', rank: 2, count: 3, tag: 'new' },
    { term: 'denim', rank: 3, count: 2, tag: null },
  ] });
  apiMock.publicDiscovery.trendingBrands.mockResolvedValue({ windowDays: 14, brands: [
    { id: 's1', sellerId: 's1', name: 'Hoodlum Studio', brandType: null, logoUrl: null, coverImageUrl: null, followerCount: 1200, verified: true },
  ] });
  apiMock.publicDiscovery.trendingProducts.mockResolvedValue({ windowDays: 14, products: [
    { id: 'pr1', name: 'Boxy Hoodie', sellerDisplayName: 'Hoodlum Studio', images: ['https://x/h.jpg'], variants: [{ priceCents: 8800 }] },
  ] });
  apiMock.public.suggested.mockResolvedValue({ brands: [], products: [] });
  apiMock.public.search.mockResolvedValue(searchPayload);
  apiMock.public.log.mockResolvedValue({ ok: true });
  apiMock.public.removeRecent.mockResolvedValue({ ok: true });
  apiMock.public.clearRecent.mockResolvedValue({ ok: true });
  apiMock.social.search.mockResolvedValue([
    { userId: 'b1', name: 'Hoodie Hannah', username: 'hh', handle: '@hh', initials: 'HH', color: '#333', bio: null, isFollowing: false, accountType: 'buyer' },
    { userId: 's1', name: 'Hoodlum Studio', username: 'hoodlum', handle: '@hoodlum', initials: 'HS', color: '#333', bio: null, isFollowing: false, accountType: 'seller' },
  ]);
  apiMock.hashtags.search.mockResolvedValue({ tags: [{ tag: 'hoodieseason', postCount: 12 }] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('Discover search overlay — focused empty state', () => {
  it('shows deduped recents, the ranked trending list with real tags, trending brands and products', async () => {
    const { r } = await render();
    const text = allText(r);
    expect(hosts(r, { testID: 'discover-search-recent' })).toHaveLength(1);
    expect(text.match(/linen set/gi)).toHaveLength(1); // "Linen Set" collapsed into one row
    expect(text).toContain('Clear all');
    expect(text).toContain('Trending');
    expect(text).toContain('cargo pants');
    expect(text).toContain('Hot');
    expect(text).toContain('New');
    expect(text).toContain('Trending brands');
    expect(text).toContain('1.2K followers');
    expect(text).toContain('Trending products');
    expect(text).toContain('Boxy Hoodie');
    expect(hosts(r, { testID: 'buyer-search-cancel' })).toHaveLength(1);
  });

  it('never shows an empty screen: no trending searches still leaves brands and products', async () => {
    apiMock.public.hot.mockResolvedValue({ windowHours: 72, queries: [] });
    apiMock.public.recent.mockResolvedValue({ recent: [] });
    const { r } = await render();
    expect(hosts(r, { testID: 'discover-search-trending' })).toHaveLength(0);
    expect(hosts(r, { testID: 'discover-search-brands' })).toHaveLength(1);
    expect(hosts(r, { testID: 'discover-search-products' })).toHaveLength(1);
  });

  it('falls back to suggested brands/products when trending has no signals yet', async () => {
    apiMock.publicDiscovery.trendingBrands.mockResolvedValue({ windowDays: 14, brands: [] });
    apiMock.publicDiscovery.trendingProducts.mockResolvedValue({ windowDays: 14, products: [] });
    apiMock.public.suggested.mockResolvedValue({
      brands: [{ id: 's9', sellerId: 's9', name: 'Northloom', handle: '@northloom', color: '#333', initials: 'NL', followerCount: 4 }],
      products: [{ id: 'p9', productId: 'p9', name: 'Half-Zip', brand: 'Northloom', category: 'tops', imageUri: null, color: '#333', initials: 'NL' }],
    });
    const { r } = await render();
    const text = allText(r);
    expect(text).toContain('Northloom');
    expect(text).toContain('Half-Zip');
  });

  it('removes one recent and clears all through the server', async () => {
    const { r } = await render();
    await act(async () => { r.root.findByProps({ accessibilityLabel: 'Remove jorts from recent searches' }).props.onPress(); await flush(); });
    expect(apiMock.public.removeRecent).toHaveBeenCalledWith('jorts');
    await act(async () => { r.root.findByProps({ testID: 'discover-search-clear-recent' }).props.onPress(); await flush(); });
    expect(apiMock.public.clearRecent).toHaveBeenCalled();
    expect(hosts(r, { testID: 'discover-search-recent' })).toHaveLength(0);
  });
});

describe('Discover search overlay — typing and results', () => {
  it('debounces typing and shows suggestions grouped Brands / People / Products / Hashtags with the match bolded', async () => {
    const { r } = await render();
    act(() => { r.root.findByProps({ testID: 'buyer-search-field' }).props.onChangeText('hood'); });
    expect(apiMock.public.search).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(150); await flush(); });
    await act(async () => { await flush(); });
    expect(apiMock.public.search).toHaveBeenCalledWith(expect.objectContaining({ q: 'hood' }));
    const text = allText(r);
    for (const section of ['Brands', 'People', 'Products', 'Hashtags']) expect(text).toContain(section);
    expect(text).toContain('Hoodie Hannah');
    expect(text).toContain('#hoodieseason');
    // The seller already listed under Brands is not repeated under People.
    expect(hosts(r, { accessibilityLabel: 'Hoodlum Studio, @hoodlum' })).toHaveLength(1);
    const bolded = r.root.findAll((n) => (n.type as unknown) === 'Text' && n.props.style?.fontFamily && n.props.children === 'Hood');
    expect(bolded.length).toBeGreaterThan(0);
  });

  it('submits into tabbed results, keeps the query in the bar and saves it to recents', async () => {
    const { r } = await render();
    await type(r, 'hoodie');
    await act(async () => { r.root.findByProps({ testID: 'buyer-search-field' }).props.onSubmitEditing(); await flush(); });
    expect(hosts(r, { testID: 'buyer-search-results-state' })).toHaveLength(1);
    expect(r.root.findByProps({ testID: 'buyer-search-field' }).props.value).toBe('hoodie');
    expect(apiMock.public.log).toHaveBeenCalledWith('hoodie');
    for (const tab of ['top', 'brands', 'people', 'products', 'fits']) {
      expect(hosts(r, { testID: `discover-search-tab-${tab}` })).toHaveLength(1);
    }
  });

  it('Fits only shows buyer posts', async () => {
    const { r } = await render();
    await type(r, 'hoodie');
    await act(async () => { r.root.findByProps({ testID: 'buyer-search-field' }).props.onSubmitEditing(); await flush(); });
    await act(async () => { r.root.findByProps({ testID: 'discover-search-tab-fits' }).props.onPress(); await flush(); });
    const text = allText(r);
    expect(text).toContain('fit check');
    expect(text).not.toContain('new drop');
  });

  it('a deep-linked query submits straight away and is saved', async () => {
    const { r } = await render({ from: null, initialQuery: 'cargo pants' });
    await act(async () => { vi.advanceTimersByTime(150); await flush(); });
    expect(hosts(r, { testID: 'buyer-search-results-state' })).toHaveLength(1);
    expect(apiMock.public.log).toHaveBeenCalledWith('cargo pants');
  });

  it('Cancel collapses back and hands control to Discover', async () => {
    const { r, onClosed } = await render();
    await act(async () => { r.root.findByProps({ testID: 'buyer-search-cancel' }).props.onPress(); await flush(); });
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(routerMock.back).not.toHaveBeenCalled();
  });
});

describe('Discover search overlay — signed out', () => {
  it('never calls protected endpoints and keeps recents on the device', async () => {
    authState.isSignedIn = false;
    const { r } = await render();
    expect(apiMock.public.recent).not.toHaveBeenCalled();
    await type(r, 'denim');
    expect(apiMock.social.search).not.toHaveBeenCalled();
    await act(async () => { r.root.findByProps({ testID: 'buyer-search-field' }).props.onSubmitEditing(); await flush(); });
    expect(JSON.parse(storage.get('bt.discoverSearch.recent.v1') ?? '[]')).toEqual(['denim']);
    expect(apiMock.public.removeRecent).not.toHaveBeenCalled();
  });
});
