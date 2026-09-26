/**
 * Regression test for the universal "scroll to top on focus" fix
 * (hooks/useScrollReset.ts): every screen's page-level list must render
 * scrolled to the top whenever its route gains focus — first mount, a stack
 * push into it, navigating back to it, or a tab switch into it — never
 * mid-scroll.
 *
 * Two levels are covered:
 *  1. The primitive itself (`useScrollReset`), driven directly against a
 *     fake scrollable ref, so the core contract is pinned independent of
 *     any one screen's markup.
 *  2. A real migrated screen — the seller/buyer "Following" screen
 *     (app/(tabs)/following.tsx, re-exported as app/(buyer)/following.tsx)
 *     — mounted with its FlatList's data populated, scrolled away from the
 *     top, then re-focused, asserting the list is reset to offset 0.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// ── expo-router mock with a controllable focus/blur simulator ──────────────
// Real `useFocusEffect` re-runs its callback's cleanup then the callback
// again every time the screen re-gains focus. This mock keeps a live list of
// registered { callback, cleanup } pairs per test so a test can simulate a
// blur+refocus cycle (e.g. "user pushed a detail screen, then came back")
// on demand via `simulateRefocus()`.
const focusRegistry: { callback: () => void | (() => void); cleanup?: () => void }[] = [];

function simulateRefocus() {
  for (const entry of focusRegistry) {
    entry.cleanup?.();
    const cleanup = entry.callback();
    entry.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
  }
}

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    const ReactActual = require('react') as typeof import('react');
    ReactActual.useEffect(() => {
      const entry: { callback: () => void | (() => void); cleanup?: () => void } = { callback };
      const cleanup = callback();
      entry.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
      focusRegistry.push(entry);
      return () => {
        entry.cleanup?.();
        const idx = focusRegistry.indexOf(entry);
        if (idx >= 0) focusRegistry.splice(idx, 1);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [callback]);
  },
  useScrollToTop: () => {},
}));

describe('useScrollReset primitive', () => {
  beforeEach(() => {
    focusRegistry.length = 0;
  });

  it('scrolls the attached list to offset 0 every time the route re-gains focus', async () => {
    const { useScrollReset } = await import('@/hooks/useScrollReset');

    const scrollToOffset = vi.fn();
    function Harness() {
      const ref = useScrollReset<{ scrollToOffset: typeof scrollToOffset }>();
      // Assign synchronously during render, the way a host ScrollView/
      // FlatList attaches its instance during the commit phase — i.e.
      // before any passive effect (including useFocusEffect's) runs.
      (ref as React.MutableRefObject<any>).current = { scrollToOffset };
      return null;
    }

    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<Harness />); });

    // Initial mount focus already reset it once.
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: false });
    scrollToOffset.mockClear();

    // Simulate the user scrolling away from the top, then navigating away
    // and back (a stack push + pop, or a tab switch away and back).
    await act(async () => { simulateRefocus(); });

    expect(scrollToOffset).toHaveBeenCalledTimes(1);
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: false });

    await act(async () => { renderer.unmount(); });
  });

  it('does nothing when disabled', async () => {
    const { useScrollReset } = await import('@/hooks/useScrollReset');
    const scrollToOffset = vi.fn();
    function Harness() {
      const ref = useScrollReset<{ scrollToOffset: typeof scrollToOffset }>(false);
      (ref as React.MutableRefObject<any>).current = { scrollToOffset };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<Harness />); });
    await act(async () => { simulateRefocus(); });
    expect(scrollToOffset).not.toHaveBeenCalled();
    await act(async () => { renderer.unmount(); });
  });
});

// ── Real screen: app/(tabs)/following.tsx ───────────────────────────────────

const { apiMock, scrollToOffsetSpy } = vi.hoisted(() => ({
  apiMock: { publicDrops: { list: vi.fn() } },
  scrollToOffsetSpy: vi.fn(),
}));

vi.mock('react-native', () => {
  const ReactActual = require('react') as typeof import('react');
  const nativeComponent = (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return ReactActual.createElement(name, props, props.children as React.ReactNode);
    }
    return MockNativeComponent;
  };
  const MockFlatList = ReactActual.forwardRef((props: any, ref: any) => {
    ReactActual.useImperativeHandle(ref, () => ({
      scrollToOffset: scrollToOffsetSpy,
    }));
    const data = props.data ?? [];
    return ReactActual.createElement(
      'FlatList',
      { testID: props.testID },
      data.map((item: any, index: number) =>
        ReactActual.createElement(
          ReactActual.Fragment,
          { key: props.keyExtractor ? props.keyExtractor(item) : index },
          props.renderItem({ item, index }),
        )),
    );
  });
  class MockAnimatedValue {
    _value: number;
    constructor(value: number) { this._value = value; }
    interpolate() { return this._value; }
    setValue(value: number) { this._value = value; }
  }
  const AnimatedComponent = (Component: unknown) => Component;
  return {
    View: nativeComponent('View'),
    Text: nativeComponent('Text'),
    ScrollView: nativeComponent('ScrollView'),
    TouchableOpacity: nativeComponent('TouchableOpacity'),
    FlatList: MockFlatList,
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {}, hairlineWidth: 1 },
    Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
    Animated: {
      Value: MockAnimatedValue,
      View: nativeComponent('Animated.View'),
      Text: nativeComponent('Animated.Text'),
      createAnimatedComponent: AnimatedComponent,
      timing: () => ({ start: (cb?: () => void) => cb?.() }),
    },
  };
});

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }),
}));
vi.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children?: React.ReactNode }) => React.createElement('LinearGradient', {}, children),
}));
vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn().mockResolvedValue(undefined),
  selectionAsync: vi.fn().mockResolvedValue(undefined),
  notificationAsync: vi.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('@/components/buyer-nav/buyerTabBarMetrics', () => ({ useBuyerTabBarInset: () => 80 }));
vi.mock('@/lib/api', () => ({ useApi: () => apiMock }));
vi.mock('@/components/BrandthreadUI', () => {
  const ReactActual = require('react') as typeof import('react');
  return {
    PressableScale: ({ children, ...rest }: any) => ReactActual.createElement(
      'Pressable', rest, typeof children === 'function' ? children({ pressed: false }) : children,
    ),
  };
});
vi.mock('@/components/ui', () => {
  const ReactActual = require('react') as typeof import('react');
  return {
    SkeletonBlock: () => ReactActual.createElement('View', { testID: 'skeleton-block' }),
    SkeletonLine: () => ReactActual.createElement('View', { testID: 'skeleton-line' }),
  };
});
vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#000', foreground: '#fff', mutedForeground: '#888', success: '#0f0',
  }),
}));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      background: '#000', text: '#fff', muted: '#888', accent: '#C7CDD5', accentDim: '#333',
      onAccent: '#000', border: '#333', card: '#111', cardElevated: '#222',
      primaryGradient: ['#111111', '#222222'],
    },
  }),
}));

import FollowingScreen from '@/app/(tabs)/following';

async function flush() { for (let i = 0; i < 6; i += 1) await Promise.resolve(); }

describe('FollowingScreen — page-level list resets scroll on refocus', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    focusRegistry.length = 0;
    scrollToOffsetSpy.mockReset();
    apiMock.publicDrops.list.mockReset().mockResolvedValue({
      drops: [
        { id: 'drop-1', name: 'Drop One', type: 'pre-made', status: 'live', createdAt: new Date().toISOString(), orderCount: 3, seller: { brandName: 'Brand A' } },
        { id: 'drop-2', name: 'Drop Two', type: 'pre-made', status: 'live', createdAt: new Date().toISOString(), orderCount: 1, seller: { brandName: 'Brand B' } },
      ],
    });
  });

  afterEach(async () => {
    if (renderer) await act(async () => { renderer?.unmount(); });
    renderer = undefined;
  });

  it('scrolls the drops FlatList back to the top when the screen regains focus', async () => {
    await act(async () => {
      renderer = create(React.createElement(FollowingScreen));
      await flush();
    });

    // Mount already triggers one reset (offset already 0) — clear it so we
    // can assert specifically on the refocus-triggered reset below.
    scrollToOffsetSpy.mockClear();

    // Simulate navigating away (e.g. into a drop detail screen) and back.
    await act(async () => { simulateRefocus(); });

    expect(scrollToOffsetSpy).toHaveBeenCalledWith({ offset: 0, animated: false });
  });
});
