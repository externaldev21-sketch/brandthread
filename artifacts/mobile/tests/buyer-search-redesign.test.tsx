import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { apiMock, routerMock } = vi.hoisted(() => {
  const apiMock = {
    public: {
      search: vi.fn(),
      searchAll: vi.fn(),
      suggested: vi.fn(),
      recent: vi.fn(),
      removeRecent: vi.fn(),
      clearRecent: vi.fn(),
      log: vi.fn(),
    },
    publicDiscovery: {
      trendingBrands: vi.fn(),
    },
    hashtags: {
      search: vi.fn(),
      trending: vi.fn(),
    },
    social: {
      search: vi.fn(),
      follow: vi.fn(),
      unfollow: vi.fn(),
    },
    reports: {
      submit: vi.fn(),
    },
  };

  const routerMock = {
    push: vi.fn(),
    replace: vi.fn(),
    navigate: vi.fn(),
    back: vi.fn(),
    canGoBack: vi.fn(() => true),
  };

  return { apiMock, routerMock };
});

vi.mock('react-native', () => {
  const nativeComponent = (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  };

  class MockAnimatedValue {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_value: number) {}
    setValue() {}
  }
  const animatedTransition = () => ({ start: (cb?: () => void) => cb?.() });
  const MockAnimated = {
    Value: MockAnimatedValue,
    timing: animatedTransition,
    spring: animatedTransition,
    loop: () => ({ start: () => {}, stop: () => {} }),
    sequence: () => ({ start: () => {} }),
    View: nativeComponent('Animated.View'),
  };

  return {
    ActivityIndicator: nativeComponent('ActivityIndicator'),
    Animated: MockAnimated,
    Platform: { OS: 'ios', select: (obj: any) => obj.ios },
    Pressable: nativeComponent('Pressable'),
    ScrollView: nativeComponent('ScrollView'),
    FlatList: nativeComponent('FlatList'),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1, absoluteFill: {} },
    Text: nativeComponent('Text'),
    TextInput: nativeComponent('TextInput'),
    TouchableOpacity: nativeComponent('TouchableOpacity'),
    View: nativeComponent('View'),
    useWindowDimensions: () => ({ width: 375, height: 812 }),
  };
});

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }),
}));


// The save heart has its own coverage (saved-products-store.test.ts); this suite only exercises search flow.
vi.mock('@/components/SaveHeart', () => ({ SaveHeart: () => null }));
vi.mock('expo-linear-gradient', () => ({
  LinearGradient: (props: Record<string, unknown>) => React.createElement('LinearGradient', props, props.children as React.ReactNode),
}));

vi.mock('expo-router', () => ({
  useRouter: () => routerMock,
  useLocalSearchParams: () => ({}),
}));

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn().mockResolvedValue(undefined),
  selectionAsync: vi.fn().mockResolvedValue(undefined),
  notificationAsync: vi.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success' },
}));

vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ userId: 'buyer-1', isSignedIn: true }),
}));

vi.mock('@/lib/api', () => ({
  useApi: () => apiMock,
}));

vi.mock('@/lib/devPreview', () => ({
  isBuyerDevPreview: () => false,
  isPreviewDemoMode: () => false,
}));

const { storage } = vi.hoisted(() => ({ storage: new Map<string, string>() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => storage.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { storage.set(k, v); }),
    removeItem: vi.fn(async (k: string) => { storage.delete(k); }),
  },
}));

vi.mock('@/hooks/useDiscoveryShelves', () => ({
  useDiscoveryShelves: () => ({ categories: [], trendingProducts: [], trendingBrands: [], reload: vi.fn() }),
}));
vi.mock('@/components/discover/DiscoverShopRails', () => ({
  ShopByCategoryRail: () => null,
}));

vi.mock('@/lib/discoverFeed', () => ({
  composeDiscoverPosts: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/components/discover/DiscoverGrid', () => ({
  DiscoverGrid: ({ ListHeaderComponent }: { ListHeaderComponent?: React.ReactElement }) =>
    React.createElement('DiscoverGrid', {}, ListHeaderComponent ?? null),
}));
vi.mock('@/components/discover/DiscoverPostViewer', () => ({
  DiscoverPostViewer: () => React.createElement('DiscoverPostViewer'),
}));
vi.mock('@/components/discover/DiscoverSafetyMenu', () => ({
  DiscoverSafetyMenu: () => React.createElement('DiscoverSafetyMenu'),
}));
vi.mock('@/components/safety/ReportSheet', () => ({
  useReportSheet: () => ({ openReport: vi.fn() }),
}));
vi.mock('@/components/ShopProductSheet', () => ({
  ShopProductSheet: () => React.createElement('ShopProductSheet'),
}));

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      background: '#0A0A0B',
      surface: '#111113',
      card: '#18181B',
      border: '#303044',
      text: '#F7F7FA',
      muted: '#AAAABC',
      accent: '#5B5CFF',
      accentDim: '#232346',
      onAccent: '#FFFFFF',
    },
  }),
}));

vi.mock('@/components/BrandthreadUI', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) =>
    React.createElement('EmptyState', {}, React.createElement('Text', {}, `${title} ${description ?? ''}`)),
  AnimatedEntrance: ({ children }: { children: React.ReactNode }) => children,
}));

// The filter sheet is covered by its own logic tests; it needs the full RN + reanimated surface.
vi.mock('@/components/search/FilterSheet', () => ({ FilterSheet: () => null }));

vi.mock('@/contexts/ThreadPullTransitionContext', () => ({
  useThreadPull: () => ({ push: vi.fn() }),
}));

vi.mock('@/components/CachedImage', () => ({
  CachedImage: (props: Record<string, unknown>) => React.createElement('CachedImage', props),
}));

vi.mock('@/app/(tabs)/feed', () => ({
  FASHION_PREVIEW_POSTS: [],
}));

vi.mock('react-native-reanimated', () => ({
  default: { View: (props: Record<string, unknown>) => React.createElement('Animated.View', props, props.children as React.ReactNode) },
  useAnimatedStyle: (fn: () => unknown) => fn(),
  useSharedValue: (v: unknown) => ({ value: v, get: () => v, set: () => undefined }),
  withTiming: (v: unknown) => v,
  withSpring: (v: unknown) => v,
  runOnJS: (fn: (...args: unknown[]) => void) => fn,
  Easing: {
    out: (fn: unknown) => fn,
    in: (fn: unknown) => fn,
    inOut: (fn: unknown) => fn,
    cubic: (t: number) => t,
    linear: (t: number) => t,
    bezier: (..._points: number[]) => (t: number) => t,
  },
}));

vi.mock('@/components/layout', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => React.createElement('View', {}, children),
  useGridColumns: () => 2,
}));

import BuyerSearchScreen from '@/app/buyer-search';

type Person = {
  userId: string; name: string; username: string | null; handle: string;
  initials: string; color: string; bio: string | null; isFollowing: boolean;
  accountType?: string; verified?: boolean; roleTag?: string; avatarUrl?: string | null;
};

function person(overrides: Partial<Person> = {}): Person {
  return {
    userId: 'p1', name: 'Jordan Lee', username: 'jordanlee', handle: '@jordanlee',
    initials: 'JL', color: '#5B5CFF', bio: null, isFollowing: false,
    accountType: 'buyer', verified: false, roleTag: 'Buyer',
    ...overrides,
  };
}

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pr1', kind: 'product', productId: 'pr1', brand: 'Vault Studio',
    name: 'Canvas Cargo Jacket', priceCents: 18900, color: '#00C853', initials: 'VS',
    imageUri: null,
    ...overrides,
  };
}

function brand(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1', kind: 'brand', sellerId: 'b1', name: 'Vault Studio', handle: '@vaultstudio',
    color: '#111', initials: 'VS', verified: false, followerCount: 3, productCount: 4,
    ...overrides,
  };
}

/** A /search/all response; `sections` keys present only when they have items. */
function allResponse(sections: Record<string, { items: unknown[]; hasMore?: boolean; nextOffset?: number | null }>, order?: string[]) {
  const shaped = Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, { hasMore: false, nextOffset: null, ...v }]));
  return { query: '', type: 'top', style: null, sections: shaped, order: order ?? Object.keys(sections).filter((k) => sections[k].items.length > 0) };
}

/** Route searchAll mocks by `type` so the Top call and per-tab calls can differ. */
function routeSearchAll(byType: Record<string, unknown>) {
  apiMock.public.searchAll.mockImplementation(async (opts: { type?: string }) => byType[opts.type ?? 'top'] ?? allResponse({}));
}

function textOf(instance: { findAll: (predicate: (node: any) => boolean) => any[] }): string {
  return instance
    .findAll((node) => (node.type as unknown) === 'Text')
    .map((node) => {
      const children = node.props.children;
      return Array.isArray(children) ? children.join('') : String(children ?? '');
    })
    .join(' ');
}

function textContent(target: ReactTestRenderer | ReactTestInstance): string {
  return textOf('root' in target ? target.root : target);
}

function flushPromises() {
  return Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve());
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<BuyerSearchScreen />);
    await flushPromises();
  });
  return renderer;
}

function setField(renderer: ReactTestRenderer, value: string) {
  act(() => {
    renderer.root.findByProps({ testID: 'buyer-search-field' }).props.onChangeText(value);
  });
}

function submitField(renderer: ReactTestRenderer) {
  renderer.root.findByProps({ testID: 'buyer-search-field' }).props.onSubmitEditing();
}

describe('buyer full-screen search — Instagram-mimicking rebuild', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    storage.clear();
    apiMock.public.search.mockReset().mockResolvedValue({ results: [] });
    apiMock.public.searchAll.mockReset().mockResolvedValue(allResponse({}));
    apiMock.public.suggested.mockReset().mockResolvedValue({ brands: [], products: [] });
    apiMock.publicDiscovery.trendingBrands.mockReset().mockResolvedValue({ windowDays: 7, brands: [] });
    apiMock.hashtags.search.mockReset().mockResolvedValue({ tags: [] });
    apiMock.hashtags.trending.mockReset().mockResolvedValue({ tags: [] });
    apiMock.public.recent.mockReset().mockResolvedValue({ recent: [{ query: 'sneakers', normalized: 'sneakers' }, { query: 'denim', normalized: 'denim' }] });
    apiMock.public.removeRecent.mockReset().mockResolvedValue({ ok: true });
    apiMock.public.clearRecent.mockReset().mockResolvedValue({ ok: true });
    apiMock.public.log.mockReset().mockResolvedValue({ ok: true });
    apiMock.social.search.mockReset().mockResolvedValue([]);
    apiMock.social.follow.mockReset().mockResolvedValue({ ok: true });
    apiMock.social.unfollow.mockReset().mockResolvedValue({ ok: true });
    apiMock.reports.submit.mockReset().mockResolvedValue({ ok: true });
    routerMock.push.mockReset();
    routerMock.back.mockReset();
  });

  afterEach(() => {
    renderer?.unmount();
    renderer = undefined;
  });

  it('pops the screen when Back is pressed', async () => {
    renderer = await renderScreen();
    act(() => {
      renderer!.root.findByProps({ testID: 'buyer-search-back' }).props.onPress();
    });
    expect(routerMock.back).toHaveBeenCalled();
  });

  it('unfocused + empty query shows the browse grid (with recent + trending brands above it) and an add-person icon, no Cancel', async () => {
    apiMock.publicDiscovery.trendingBrands.mockResolvedValue({ windowDays: 7, brands: [{ id: 's1', sellerId: 's1', name: 'Northline', verified: true, followerCount: 12 }] });
    apiMock.public.suggested.mockResolvedValue({ brands: [{ id: 's2', sellerId: 's2', name: 'Atlas Goods', handle: '@atlasgoods', color: '#222', initials: 'AG', followerCount: 0 }], products: [] });
    renderer = await renderScreen();
    await act(async () => { await flushPromises(); });
    expect(renderer.root.findAllByProps({ testID: 'buyer-search-add-person' }, { deep: false })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ testID: 'buyer-search-cancel' }, { deep: false })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ testID: 'buyer-search-browse-header' }, { deep: false })).toHaveLength(1);
    const content = textContent(renderer);
    expect(content).toContain('Trending brands');
    // Trending (signal-ranked) first, topped up by suggested brands.
    expect(content.indexOf('Northline')).toBeLessThan(content.indexOf('Atlas Goods'));
    expect(content).toContain('sneakers');
  });

  it('shows the category chips under the search bar, Streetwear/Vintage/Y2K/Accessories first', async () => {
    renderer = await renderScreen();
    const chips = renderer.root.findAll((n) => typeof n.props.testID === 'string' && n.props.testID.startsWith('search-chip-') && (n.type as unknown) === 'TouchableOpacity');
    expect(chips.slice(0, 4).map((c) => c.props.testID)).toEqual([
      'search-chip-streetwear', 'search-chip-vintage', 'search-chip-y2k', 'search-chip-accessories',
    ]);
  });

  it('tapping the add-person icon navigates to Friends', async () => {
    renderer = await renderScreen();
    act(() => {
      renderer!.root.findByProps({ testID: 'buyer-search-add-person' }).props.onPress();
    });
    expect(routerMock.push).toHaveBeenCalledWith('/(buyer)/friends');
  });

  it('focusing an empty field shows Cancel + the Recent section (local + server history) instead of the grid', async () => {
    storage.set('bt.search.recent.v1', JSON.stringify(['cargo pants']));
    renderer = await renderScreen();
    act(() => {
      renderer!.root.findByProps({ testID: 'buyer-search-field' }).props.onFocus();
    });
    await act(async () => { await flushPromises(); });

    expect(renderer.root.findAllByProps({ testID: 'buyer-search-cancel' }, { deep: false })).toHaveLength(1);
    const content = textContent(renderer);
    expect(content).toContain('RECENT');
    expect(content).toContain('cargo pants');
    expect(content).toContain('sneakers');
    expect(content).toContain('denim');
    // On-device entries lead.
    expect(content.indexOf('cargo pants')).toBeLessThan(content.indexOf('sneakers'));
    expect(apiMock.public.recent).toHaveBeenCalled();
  });

  it('removes a single recent search via the row\'s x button (device + server)', async () => {
    storage.set('bt.search.recent.v1', JSON.stringify(['sneakers']));
    renderer = await renderScreen();
    act(() => { renderer!.root.findByProps({ testID: 'buyer-search-field' }).props.onFocus(); });
    await act(async () => { await flushPromises(); });

    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'Remove sneakers from recent searches' }).props.onPress();
      await flushPromises();
    });
    expect(apiMock.public.removeRecent).toHaveBeenCalledWith('sneakers');
    expect(JSON.parse(storage.get('bt.search.recent.v1') ?? '[]')).toEqual([]);
  });

  it('Cancel clears the query and returns to the unfocused browse grid', async () => {
    renderer = await renderScreen();
    setField(renderer, 'hoodie');
    act(() => {
      renderer!.root.findByProps({ testID: 'buyer-search-cancel' }).props.onPress();
    });
    expect(renderer.root.findAllByProps({ testID: 'buyer-search-add-person' }, { deep: false })).toHaveLength(1);
  });

  async function typeAndDebounce(r: ReactTestRenderer, value: string) {
    vi.useFakeTimers();
    setField(r, value);
    await act(async () => {
      vi.advanceTimersByTime(150);
      vi.useRealTimers();
      await flushPromises();
    });
  }

  it('shows live suggestions (query row first, then matching brands and people) while typing, before submit', async () => {
    routeSearchAll({ top: allResponse({ brands: { items: [brand()] }, people: { items: [{ ...person(), id: 'p1' }] } }) });
    renderer = await renderScreen();
    await typeAndDebounce(renderer, 'jor');

    expect(renderer.root.findAllByProps({ testID: 'buyer-search-suggestions' }, { deep: false })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ testID: 'buyer-search-results-state' }, { deep: false })).toHaveLength(0);
    const content = textContent(renderer);
    expect(content).toContain('@vaultstudio');
    expect(content).toContain('@jordanlee');
    expect(content.indexOf('@vaultstudio')).toBeLessThan(content.indexOf('@jordanlee'));
  });

  it('debounces typing (150ms), runs one unified search, submits to the Top tab with every section, and saves the term', async () => {
    routeSearchAll({
      top: allResponse({
        products: { items: [product()], hasMore: true },
        brands: { items: [brand()] },
        people: { items: [{ ...person(), id: 'p1' }] },
      }, ['brands', 'products', 'people']),
    });

    renderer = await renderScreen();

    vi.useFakeTimers();
    setField(renderer, 'vault');
    expect(apiMock.public.searchAll).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(150);
      vi.useRealTimers();
      await flushPromises();
    });

    expect(apiMock.public.searchAll).toHaveBeenCalledWith(expect.objectContaining({ q: 'vault', type: 'top', style: null }));
    expect(apiMock.social.search).not.toHaveBeenCalled();

    await act(async () => {
      submitField(renderer!);
      await flushPromises();
    });

    expect(apiMock.public.log).toHaveBeenCalledWith('vault');
    expect(JSON.parse(storage.get('bt.search.recent.v1') ?? '[]')).toEqual(['vault']);
    expect(renderer.root.findAllByProps({ testID: 'buyer-search-results-state' }, { deep: false })).toHaveLength(1);
    const content = textContent(renderer);
    // Sections render in the server's best-match order.
    expect(content.indexOf('BRANDS')).toBeLessThan(content.indexOf('PRODUCTS'));
    expect(content.indexOf('PRODUCTS')).toBeLessThan(content.indexOf('PEOPLE'));
    expect(content).toContain('Canvas Cargo Jacket');
    expect(content).toContain('Jordan Lee');
    expect(content).toContain('Vault Studio');
  });

  it('per-type tabs page through results (first page on open, next page on Show more)', async () => {
    const page1 = Array.from({ length: 2 }, (_, i) => product({ id: `pr${i}`, productId: `pr${i}`, name: `Jacket ${i}` }));
    const page2 = [product({ id: 'pr9', productId: 'pr9', name: 'Jacket 9' })];
    apiMock.public.searchAll.mockImplementation(async (opts: { type?: string; offset?: number }) => {
      if (opts.type === 'products') {
        return opts.offset
          ? allResponse({ products: { items: page2, hasMore: false, nextOffset: null } })
          : allResponse({ products: { items: page1, hasMore: true, nextOffset: 2 } });
      }
      return allResponse({ products: { items: page1, hasMore: true } });
    });

    renderer = await renderScreen();
    await typeAndDebounce(renderer, 'jacket');
    await act(async () => { submitField(renderer!); await flushPromises(); });
    await act(async () => {
      renderer!.root.findByProps({ testID: 'search-tab-products' }).props.onPress();
      await flushPromises();
    });
    expect(apiMock.public.searchAll).toHaveBeenCalledWith(expect.objectContaining({ q: 'jacket', type: 'products', offset: 0, limit: 20 }));
    expect(textContent(renderer)).toContain('Jacket 1');

    await act(async () => {
      renderer!.root.findByProps({ testID: 'buyer-search-load-more' }).props.onPress();
      await flushPromises();
    });
    expect(apiMock.public.searchAll).toHaveBeenCalledWith(expect.objectContaining({ type: 'products', offset: 2 }));
    const content = textContent(renderer);
    expect(content).toContain('Jacket 0');
    expect(content).toContain('Jacket 9');
    expect(renderer.root.findAllByProps({ testID: 'buyer-search-load-more' }, { deep: false })).toHaveLength(0);
  });

  it('a category chip filters the product search, and with no query browses that category', async () => {
    routeSearchAll({ products: allResponse({ products: { items: [product({ name: 'Archive Tee' })] } }) });
    renderer = await renderScreen();
    await act(async () => {
      renderer!.root.findByProps({ testID: 'search-chip-vintage' }).props.onPress();
      await flushPromises();
    });
    await act(async () => {
      vi.useFakeTimers();
      vi.advanceTimersByTime(150);
      vi.useRealTimers();
      await flushPromises();
    });
    await act(async () => { await flushPromises(); });

    expect(apiMock.public.searchAll).toHaveBeenCalledWith(expect.objectContaining({ q: '', type: 'products', style: 'vintage' }));
    expect(renderer.root.findAllByProps({ testID: 'buyer-search-results-state' }, { deep: false })).toHaveLength(1);
    const content = textContent(renderer);
    expect(content).toContain('VINTAGE');
    expect(content).toContain('Archive Tee');

    // Typing a query keeps the chip applied to the unified search.
    await typeAndDebounce(renderer, 'tee');
    expect(apiMock.public.searchAll).toHaveBeenCalledWith(expect.objectContaining({ q: 'tee', type: 'top', style: 'vintage' }));
  });

  it('shows a friendly no-results state on the Products tab', async () => {
    renderer = await renderScreen();
    await typeAndDebounce(renderer, 'zzznomatch');
    await act(async () => { submitField(renderer!); await flushPromises(); });
    await act(async () => {
      renderer!.root.findByProps({ testID: 'search-tab-products' }).props.onPress();
      await flushPromises();
    });
    await act(async () => { await flushPromises(); });

    expect(renderer.root.findAllByProps({ testID: 'buyer-search-no-results' }, { deep: false })).toHaveLength(1);
  });

  it('follows and unfollows a person from the People tab', async () => {
    const sam = { ...person({ userId: 'p2', name: 'Sam Rivera', isFollowing: false }), id: 'p2' };
    routeSearchAll({ people: allResponse({ people: { items: [sam] } }), top: allResponse({ people: { items: [sam] } }) });

    renderer = await renderScreen();
    await typeAndDebounce(renderer, 'sam');
    await act(async () => { submitField(renderer!); await flushPromises(); });
    await act(async () => {
      renderer!.root.findByProps({ testID: 'search-tab-people' }).props.onPress();
      await flushPromises();
    });
    await act(async () => { await flushPromises(); });

    const followButton = () => renderer!.root.findByProps({ testID: 'search-follow-p2' });
    expect(textContent(followButton())).toContain('Follow');

    await act(async () => {
      followButton().props.onPress();
      await flushPromises();
    });
    expect(apiMock.social.follow).toHaveBeenCalledWith('p2');
    expect(textContent(followButton())).toContain('Following');
  });
});
