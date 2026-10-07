import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { apiMock, routerMock } = vi.hoisted(() => {
  const apiMock = {
    public: {
      search: vi.fn(),
      recent: vi.fn(),
      removeRecent: vi.fn(),
      clearRecent: vi.fn(),
      log: vi.fn(),
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
}));

vi.mock('@/lib/discoverFeed', () => ({
  composeDiscoverPosts: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/components/discover/DiscoverGrid', () => ({
  DiscoverGrid: () => React.createElement('DiscoverGrid'),
}));
vi.mock('@/components/discover/DiscoverPostViewer', () => ({
  DiscoverPostViewer: () => React.createElement('DiscoverPostViewer'),
}));
vi.mock('@/components/discover/DiscoverSafetyMenu', () => ({
  DiscoverSafetyMenu: () => React.createElement('DiscoverSafetyMenu'),
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
    apiMock.public.search.mockReset().mockResolvedValue({ results: [] });
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

  it('unfocused + empty query shows the browse grid and an add-person icon, no Cancel', async () => {
    renderer = await renderScreen();
    expect(renderer.root.findAllByProps({ testID: 'buyer-search-add-person' }, { deep: false })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ testID: 'buyer-search-cancel' }, { deep: false })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ testID: 'buyer-search-recent' }, { deep: false })).toHaveLength(0);
  });

  it('tapping the add-person icon navigates to Friends', async () => {
    renderer = await renderScreen();
    act(() => {
      renderer!.root.findByProps({ testID: 'buyer-search-add-person' }).props.onPress();
    });
    expect(routerMock.push).toHaveBeenCalledWith('/(buyer)/friends');
  });

  it('focusing an empty field shows Cancel + the Recent section (server-backed) instead of the grid', async () => {
    renderer = await renderScreen();
    act(() => {
      renderer!.root.findByProps({ testID: 'buyer-search-field' }).props.onFocus();
    });
    await act(async () => { await flushPromises(); });

    expect(renderer.root.findAllByProps({ testID: 'buyer-search-cancel' }, { deep: false })).toHaveLength(1);
    const content = textContent(renderer);
    expect(content).toContain('Recent');
    expect(content).toContain('sneakers');
    expect(content).toContain('denim');
    expect(apiMock.public.recent).toHaveBeenCalled();
  });

  it('removes a single recent search via the row\'s x button', async () => {
    renderer = await renderScreen();
    act(() => { renderer!.root.findByProps({ testID: 'buyer-search-field' }).props.onFocus(); });
    await act(async () => { await flushPromises(); });

    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'Remove sneakers from recent searches' }).props.onPress();
      await flushPromises();
    });
    expect(apiMock.public.removeRecent).toHaveBeenCalledWith('sneakers');
  });

  it('Cancel clears the query and returns to the unfocused browse grid', async () => {
    renderer = await renderScreen();
    setField(renderer, 'hoodie');
    act(() => {
      renderer!.root.findByProps({ testID: 'buyer-search-cancel' }).props.onPress();
    });
    expect(renderer.root.findAllByProps({ testID: 'buyer-search-add-person' }, { deep: false })).toHaveLength(1);
  });

  it('shows live suggestions (query row first, then matching accounts) while typing, before submit', async () => {
    apiMock.public.search.mockResolvedValue({ results: [] });
    apiMock.social.search.mockResolvedValue([person()]);
    renderer = await renderScreen();

    vi.useFakeTimers();
    setField(renderer, 'jor');
    await act(async () => {
      vi.advanceTimersByTime(150);
      vi.useRealTimers();
      await flushPromises();
    });

    expect(renderer.root.findAllByProps({ testID: 'buyer-search-suggestions' }, { deep: false })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ testID: 'buyer-search-results-state' }, { deep: false })).toHaveLength(0);
    // The name is bold-highlighted (split across nested Text nodes), so
    // assert on the plain, unsplit handle string instead.
    expect(textContent(renderer)).toContain('@jordanlee');
  });

  it('debounces typing (150ms), submits to the tabbed results view, and logs the submitted term', async () => {
    apiMock.public.search.mockResolvedValue({ results: [product()] });
    apiMock.social.search.mockResolvedValue([person()]);

    renderer = await renderScreen();

    vi.useFakeTimers();
    setField(renderer, 'vault');
    expect(apiMock.public.search).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(150);
      vi.useRealTimers();
      await flushPromises();
    });

    expect(apiMock.public.search).toHaveBeenCalledWith({ q: 'vault', limit: 30 });
    expect(apiMock.social.search).toHaveBeenCalledWith('vault', 20);

    await act(async () => {
      submitField(renderer!);
      await flushPromises();
    });

    expect(apiMock.public.log).toHaveBeenCalledWith('vault');
    expect(renderer.root.findAllByProps({ testID: 'buyer-search-results-state' }, { deep: false })).toHaveLength(1);
    // Default tab on submit is "For you" — an Accounts section, not the
    // product grid (that's the dedicated Products tab).
    expect(textContent(renderer)).toContain('Jordan Lee');

    await act(async () => {
      renderer!.root.findByProps({ testID: 'search-tab-products' }).props.onPress();
      await flushPromises();
    });
    expect(textContent(renderer)).toContain('Canvas Cargo Jacket');

    await act(async () => {
      renderer!.root.findByProps({ testID: 'search-tab-accounts' }).props.onPress();
      await flushPromises();
    });
    expect(textContent(renderer)).toContain('Jordan Lee');
    expect(renderer.root.findAllByProps({ testID: 'search-follow-p1' }, { deep: false })).toHaveLength(1);
  });

  it('shows a friendly no-results state on the Products tab', async () => {
    apiMock.public.search.mockResolvedValue({ results: [] });
    apiMock.social.search.mockResolvedValue([]);

    renderer = await renderScreen();
    vi.useFakeTimers();
    setField(renderer, 'zzznomatch');
    await act(async () => {
      vi.advanceTimersByTime(150);
      vi.useRealTimers();
      await flushPromises();
    });

    await act(async () => {
      submitField(renderer!);
      await flushPromises();
    });

    await act(async () => {
      renderer!.root.findByProps({ testID: 'search-tab-products' }).props.onPress();
      await flushPromises();
    });

    expect(renderer.root.findAllByProps({ testID: 'buyer-search-no-results' }, { deep: false })).toHaveLength(1);
  });

  it('follows and unfollows a person from the Accounts tab', async () => {
    apiMock.public.search.mockResolvedValue({ results: [] });
    apiMock.social.search.mockResolvedValue([person({ userId: 'p2', name: 'Sam Rivera', isFollowing: false })]);

    renderer = await renderScreen();
    vi.useFakeTimers();
    setField(renderer, 'sam');
    await act(async () => {
      vi.advanceTimersByTime(150);
      vi.useRealTimers();
      await flushPromises();
    });

    await act(async () => {
      submitField(renderer!);
      await flushPromises();
    });

    await act(async () => {
      renderer!.root.findByProps({ testID: 'search-tab-accounts' }).props.onPress();
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
  });
});
