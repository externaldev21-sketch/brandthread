import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { apiMock, routerMock, storageMock, buyerSearchStore } = vi.hoisted(() => {
  const apiMock = {
    public: {
      search: vi.fn(),
      trending: vi.fn(),
      suggested: vi.fn(),
      categories: vi.fn(),
    },
    social: {
      search: vi.fn(),
      follow: vi.fn(),
      unfollow: vi.fn(),
    },
  };

  const routerMock = {
    push: vi.fn(),
    navigate: vi.fn(),
    back: vi.fn(),
  };

  const storageMock = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  };

  // The query field lives in the tab bar, outside this screen. A tiny shared
  // store lets tests drive it the same way, notifying every mounted consumer
  // of `useBuyerSearch()` (only this screen, in practice) on change.
  let listeners: Array<() => void> = [];
  const state = { query: '', submitRequest: 0 };
  const buyerSearchStore = {
    reset() {
      state.query = '';
      state.submitRequest = 0;
      listeners = [];
    },
    getQuery: () => state.query,
    getSubmitRequest: () => state.submitRequest,
    setQuery(next: string) {
      state.query = next;
      listeners.slice().forEach((fn) => fn());
    },
    submit() {
      state.submitRequest += 1;
      listeners.slice().forEach((fn) => fn());
    },
    subscribe(fn: () => void) {
      listeners.push(fn);
      return () => {
        listeners = listeners.filter((l) => l !== fn);
      };
    },
  };

  return { apiMock, routerMock, storageMock, buyerSearchStore };
});

vi.mock('react-native', () => {
  const nativeComponent = (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  };

  // A minimal Animated stand-in: values with a plain numeric handle and
  // timing/spring calls that resolve their `start` callback synchronously,
  // matching how the real API is used by Chip/ListRow/Button-style press
  // feedback (no native driver needed in this jsdom-free renderer).
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
    RefreshControl: nativeComponent('RefreshControl'),
    ScrollView: nativeComponent('ScrollView'),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1, absoluteFill: {} },
    Text: nativeComponent('Text'),
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

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => routerMock,
}));

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn().mockResolvedValue(undefined),
  selectionAsync: vi.fn().mockResolvedValue(undefined),
  notificationAsync: vi.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success' },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: storageMock,
}));

vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ userId: 'buyer-1' }),
}));

vi.mock('@/lib/api', () => ({
  useApi: () => apiMock,
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
  EmptyState: ({ title, description }: { title: string; description: string }) =>
    React.createElement('EmptyState', {}, React.createElement('Text', {}, `${title} ${description}`)),
  // Entrance animation is a real spring against `Animated.Value` in the real
  // component — irrelevant to what these tests assert — so it renders its
  // children immediately with no animation wrapper.
  AnimatedEntrance: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/contexts/ThreadPullTransitionContext', () => ({
  useThreadPull: () => ({ push: vi.fn() }),
}));

vi.mock('@/components/CachedImage', () => ({
  CachedImage: (props: Record<string, unknown>) => React.createElement('CachedImage', props),
}));

vi.mock('@/components/search/FilterSheet', () => {
  const ReactLocal = require('react') as typeof import('react');
  // The real component pulls in BottomSheet -> react-native-reanimated ->
  // WebAppShell -> expo-linear-gradient, which this suite's plain
  // react-native mock doesn't support (no test here exercises the filter
  // sheet's own content) — stub it to render nothing when hidden, matching
  // the established pattern for other BottomSheet-based sheets (see
  // tests/add-product.test.tsx's SuccessSheet stub). `countActiveFilters` is
  // re-implemented simply since `app/(buyer)/search.tsx` imports it as a
  // value from this same module.
  return {
    FilterSheet: ({ visible }: { visible: boolean }) => {
      if (!visible) return null;
      return ReactLocal.createElement('View', { testID: 'search-filter-sheet' });
    },
    countActiveFilters: (f: Record<string, unknown>) =>
      Object.values(f).filter((v) => v !== undefined).length,
  };
});

vi.mock('react-native-reanimated', () => ({
  default: { View: (props: Record<string, unknown>) => React.createElement('Animated.View', props, props.children as React.ReactNode) },
  useAnimatedStyle: (fn: () => unknown) => fn(),
}));

// The trending-brands row's trailing fade uses LinearGradient, which calls
// react-native's processColor internally — not present on this suite's
// plain react-native mock. Stub it like the other native-only components above.
vi.mock('expo-linear-gradient', () => ({
  LinearGradient: (props: Record<string, unknown>) => React.createElement('LinearGradient', props, props.children as React.ReactNode),
}));

vi.mock('@/components/buyer-nav/buyerTabBarMetrics', () => ({
  useBuyerTabBarInset: () => 64,
}));

vi.mock('@/components/layout', () => ({
  GridSkeleton: () => React.createElement('GridSkeleton', {}),
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => React.createElement('View', {}, children),
  useGridColumns: () => 2,
  Header: ({ title, subtitle }: any) => React.createElement(
    'View',
    { testID: 'search-header' },
    React.createElement('Text', {}, title),
    subtitle ? React.createElement('Text', {}, subtitle) : null,
  ),
}));

vi.mock('@/contexts/BuyerSearchContext', () => ({
  useBuyerSearch: () => {
    const [, force] = React.useState(0);
    React.useEffect(() => buyerSearchStore.subscribe(() => force((n) => n + 1)), []);
    return {
      query: buyerSearchStore.getQuery(),
      setQuery: buyerSearchStore.setQuery,
      filtersRequest: 0,
      requestFilters: () => {},
      submitRequest: buyerSearchStore.getSubmitRequest(),
      submit: buyerSearchStore.submit,
      activeFilterCount: 0,
      setActiveFilterCount: () => {},
      keyboardHeight: { value: 0 },
    };
  },
}));

import SearchScreen from '@/app/(buyer)/search';

type Person = {
  userId: string; name: string; username: string | null; handle: string;
  initials: string; color: string; bio: string | null; isFollowing: boolean;
};

function person(overrides: Partial<Person> = {}): Person {
  return {
    userId: 'p1', name: 'Jordan Lee', username: 'jordanlee', handle: '@jordanlee',
    initials: 'JL', color: '#5B5CFF', bio: null, isFollowing: false,
    ...overrides,
  };
}

function brand(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1', kind: 'brand', name: 'Vault Studio', handle: '@vaultstudio',
    color: '#00C853', initials: 'VS', sellerId: 'seller-1',
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

// The screen's mocked host components (View, Text, ...) are plain functions
// that pass their props straight through to an underlying host element with
// the same name, so `findAllByProps` on a testID matches both the composite
// and host instances. Count only the host node.
function countByTestId(renderer: ReactTestRenderer, testID: string): number {
  return renderer.root.findAll(
    (node) => typeof node.type === 'string' && node.props?.testID === testID,
  ).length;
}

function flushPromises() {
  return Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve());
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<SearchScreen />);
    await flushPromises();
  });
  return renderer;
}

describe('buyer search redesign', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    buyerSearchStore.reset();
    apiMock.public.search.mockReset().mockResolvedValue({ results: [] });
    apiMock.public.trending.mockReset().mockResolvedValue({
      trending: [{ term: 'Denim', type: 'category' }, { term: 'Vault Studio', type: 'brand' }],
    });
    apiMock.public.suggested.mockReset().mockResolvedValue({
      brands: [{ id: 'b1', sellerId: 'seller-1', name: 'Vault Studio', handle: '@vaultstudio', color: '#00C853', initials: 'VS', followerCount: 120 }],
      products: [{ id: 'sp1', productId: 'sp1', name: 'Fleece Zip Jacket', brand: 'Vault Studio', category: 'outerwear', imageUri: null, color: '#00C853', initials: 'VS' }],
    });
    apiMock.public.categories.mockReset().mockResolvedValue({ categories: [] });
    apiMock.social.search.mockReset().mockResolvedValue([]);
    apiMock.social.follow.mockReset().mockResolvedValue({ ok: true });
    apiMock.social.unfollow.mockReset().mockResolvedValue({ ok: true });
    storageMock.getItem.mockReset().mockResolvedValue(JSON.stringify(['sneakers', 'denim']));
    storageMock.setItem.mockReset().mockResolvedValue(undefined);
    storageMock.removeItem.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    renderer?.unmount();
    renderer = undefined;
  });

  it('renders recent searches, trending terms and suggested brands/products in the empty state', async () => {
    renderer = await renderScreen();

    const content = textContent(renderer);
    expect(content).toContain('sneakers');
    expect(content).toContain('denim');
    expect(content).toContain('Denim');
    expect(content).toContain('Vault Studio');
    expect(content).toContain('Fleece Zip Jacket');
    expect(renderer.root.findAllByProps({ testID: 'buyer-search-empty-state' }, { deep: false })).toHaveLength(1);
  });

  it('clears an individual recent search and all recent searches', async () => {
    renderer = await renderScreen();

    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'Remove sneakers from recent searches' }).props.onPress();
      await flushPromises();
    });
    expect(storageMock.setItem).toHaveBeenCalledWith(
      'bt:buyer-search-recent:buyer-1',
      JSON.stringify(['denim']),
    );
    expect(textContent(renderer)).not.toContain('sneakers');

    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'Clear recent searches' }).props.onPress();
      await flushPromises();
    });
    expect(storageMock.removeItem).toHaveBeenCalledWith('bt:buyer-search-recent:buyer-1');
    expect(textContent(renderer)).not.toContain('denim');
  });

  it('debounces typing before calling the search and social APIs, then renders tabs', async () => {
    apiMock.public.search.mockResolvedValue({
      results: [brand(), product()],
    });
    apiMock.social.search.mockResolvedValue([person()]);

    renderer = await renderScreen();

    vi.useFakeTimers();
    act(() => {
      buyerSearchStore.setQuery('vault');
    });
    expect(apiMock.public.search).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(350);
      vi.useRealTimers();
      await flushPromises();
    });

    expect(apiMock.public.search).toHaveBeenCalledWith({
      q: 'vault', limit: 30,
      sort: undefined, category: undefined, size: undefined, brand: undefined,
      minPriceCents: undefined, maxPriceCents: undefined,
    });
    expect(apiMock.social.search).toHaveBeenCalledWith('vault', 10);

    // Top tab shows a mixed short list by default.
    expect(textContent(renderer)).toContain('Vault Studio');
    expect(textContent(renderer)).toContain('Jordan Lee');

    // Switch to the Products tab.
    await act(async () => {
      renderer!.root.findByProps({ testID: 'search-tab-products' }).props.onPress();
      await flushPromises();
    });
    expect(textContent(renderer)).toContain('Canvas Cargo Jacket');

    // Switch to the People tab.
    await act(async () => {
      renderer!.root.findByProps({ testID: 'search-tab-people' }).props.onPress();
      await flushPromises();
    });
    expect(textContent(renderer)).toContain('Jordan Lee');
    expect(renderer.root.findAllByProps({ testID: 'search-follow-p1' }, { deep: false })).toHaveLength(1);
  });

  it('shows a friendly no-results state with fallback suggestions', async () => {
    apiMock.public.search.mockResolvedValue({ results: [] });
    apiMock.social.search.mockResolvedValue([]);

    renderer = await renderScreen();

    vi.useFakeTimers();
    act(() => {
      buyerSearchStore.setQuery('zzznomatch');
    });
    await act(async () => {
      vi.advanceTimersByTime(350);
      vi.useRealTimers();
      await flushPromises();
    });

    expect(renderer.root.findAllByProps({ testID: 'buyer-search-no-results' }, { deep: false })).toHaveLength(1);
    expect(textContent(renderer)).toContain('zzznomatch');
    // Fallback suggestions reuse the trending/suggested data already loaded.
    expect(textContent(renderer)).toContain('Denim');
  });

  it('follows and unfollows a person from the People tab', async () => {
    apiMock.public.search.mockResolvedValue({ results: [] });
    apiMock.social.search.mockResolvedValue([person({ userId: 'p2', name: 'Sam Rivera', isFollowing: false })]);

    renderer = await renderScreen();

    vi.useFakeTimers();
    act(() => {
      buyerSearchStore.setQuery('sam');
    });
    await act(async () => {
      vi.advanceTimersByTime(350);
      vi.useRealTimers();
      await flushPromises();
    });

    await act(async () => {
      renderer!.root.findByProps({ testID: 'search-tab-people' }).props.onPress();
      await flushPromises();
    });

    const followButton = () => renderer!.root.findByProps({ testID: 'search-follow-p2' });
    expect(textContent(followButton())).toContain('Follow');

    await act(async () => {
      followButton().props.onPress();
      await flushPromises();
    });
    expect(apiMock.social.follow).toHaveBeenCalledWith('p2');
    expect(textContent(followButton())).toContain('Following');

    await act(async () => {
      followButton().props.onPress();
      await flushPromises();
    });
    expect(apiMock.social.unfollow).toHaveBeenCalledWith('p2');
    expect(textContent(followButton())).not.toContain('Following');
  });
});
