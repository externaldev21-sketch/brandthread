import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { apiMock, routerMock, storageMock } = vi.hoisted(() => {
  const apiMock = {
    public: {
      search: vi.fn(),
      trending: vi.fn(),
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

  return { apiMock, routerMock, storageMock };
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

vi.mock('expo-router', () => ({
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

vi.mock('@/lib/devPreview', () => ({
  isBuyerDevPreview: () => false,
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
  // `constants/motion.ts` (pulled in transitively via components/ui/Button)
  // calls `Easing.bezier(...)` at module scope.
  Easing: {
    out: (fn: unknown) => fn,
    in: (fn: unknown) => fn,
    inOut: (fn: unknown) => fn,
    cubic: (t: number) => t,
    linear: (t: number) => t,
    bezier: (..._points: number[]) => (t: number) => t,
  },
}));

vi.mock('@/components/ui', () => ({
  // The real barrel eagerly imports SegmentedControl -> expo-blur, which
  // isn't available in this plain react-native mock — stub just the pieces
  // this screen uses.
  Chip: ({ label, onPress, onRemove, removeAccessibilityLabel }: any) =>
    React.createElement('View', {}, [
      React.createElement('Pressable', { key: 'main', onPress, accessibilityLabel: label }, React.createElement('Text', {}, label)),
      onRemove ? React.createElement('Pressable', { key: 'remove', onPress: onRemove, accessibilityLabel: removeAccessibilityLabel }) : null,
    ]),
  Button: ({ label, onPress, accessibilityLabel, testID, loading }: any) =>
    React.createElement('Pressable', { onPress, accessibilityLabel, testID }, React.createElement('Text', {}, loading ? '…' : label)),
}));

vi.mock('@/components/layout', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => React.createElement('View', {}, children),
  useGridColumns: () => 2,
}));

import BuyerSearchScreen from '@/app/buyer-search';

type Person = {
  userId: string; name: string; username: string | null; handle: string;
  initials: string; color: string; bio: string | null; isFollowing: boolean;
  accountType?: string; verified?: boolean; roleTag?: string;
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

describe('buyer full-screen search', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    apiMock.public.search.mockReset().mockResolvedValue({ results: [] });
    apiMock.public.trending.mockReset().mockResolvedValue({ trending: [{ term: 'Denim', type: 'category' }] });
    apiMock.social.search.mockReset().mockResolvedValue([]);
    apiMock.social.follow.mockReset().mockResolvedValue({ ok: true });
    apiMock.social.unfollow.mockReset().mockResolvedValue({ ok: true });
    storageMock.getItem.mockReset().mockResolvedValue(JSON.stringify(['sneakers', 'denim']));
    storageMock.setItem.mockReset().mockResolvedValue(undefined);
    storageMock.removeItem.mockReset().mockResolvedValue(undefined);
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

  it('renders recent searches and "You may like" trending in the empty state, with no results/product fetch yet', async () => {
    renderer = await renderScreen();
    const content = textContent(renderer);
    expect(content).toContain('sneakers');
    expect(content).toContain('denim');
    expect(content).toContain('Denim');
    expect(renderer.root.findAllByProps({ testID: 'buyer-search-empty-state' }, { deep: false })).toHaveLength(1);
    expect(apiMock.public.search).not.toHaveBeenCalled();
  });

  it('falls back to the fixed "you may like" terms when trending is empty', async () => {
    apiMock.public.trending.mockResolvedValue({ trending: [] });
    renderer = await renderScreen();
    expect(textContent(renderer)).toContain('black wool coat');
  });

  it('clears an individual recent search and all recent searches', async () => {
    renderer = await renderScreen();
    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'Remove sneakers from recent searches' }).props.onPress();
      await flushPromises();
    });
    expect(storageMock.setItem).toHaveBeenCalledWith('bt:buyer-search-recent:buyer-1', JSON.stringify(['denim']));

    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'Clear recent searches' }).props.onPress();
      await flushPromises();
    });
    expect(storageMock.removeItem).toHaveBeenCalledWith('bt:buyer-search-recent:buyer-1');
  });

  it('debounces typing (150ms) before calling the search and social APIs, then renders tabs', async () => {
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

    expect(textContent(renderer)).toContain('Jordan Lee');
    expect(textContent(renderer)).toContain('Canvas Cargo Jacket');

    await act(async () => {
      renderer!.root.findByProps({ testID: 'search-tab-users' }).props.onPress();
      await flushPromises();
    });
    expect(textContent(renderer)).toContain('Jordan Lee');
    expect(renderer.root.findAllByProps({ testID: 'search-follow-p1' }, { deep: false })).toHaveLength(1);
  });

  it('shows a friendly no-results state', async () => {
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

    expect(renderer.root.findAllByProps({ testID: 'buyer-search-no-results' }, { deep: false })).toHaveLength(1);
  });

  it('follows and unfollows a person from the Users tab', async () => {
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
      renderer!.root.findByProps({ testID: 'search-tab-users' }).props.onPress();
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
