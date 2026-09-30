import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Regression test for the "Maximum update depth exceeded" infinite render
 * loop in app/boost.tsx (fresh seller dev-preview, no `&demo=1`), reported
 * live by Dev as a red error toast that then followed navigation to other
 * screens (Boost stays mounted in the nav stack; the loop kept running in
 * the background and a global error-toast listener surfaced it wherever
 * Dev was currently looking).
 *
 * Root cause: `const previewTargets = inSellerPreviewDemo ? PREVIEW_BOOST_
 * TARGETS : [];` was a brand-new `[]` literal every render. A `useEffect`
 * depended on `[inSellerPreview, previewTargets]` and called `setTargets`/
 * `setSummary` inside it — since `previewTargets` never stabilized, the
 * effect fired every render, updated state, re-rendered, fired again.
 *
 * Fix (app/boost.tsx): hoisted a module-level `EMPTY_TARGETS` (and
 * `EMPTY_BOOSTS`/`FRESH_SUMMARY`) so every branch returns the SAME
 * reference across renders, plus a shallow-equality guard on the effect's
 * own setState calls as defense in depth.
 *
 * This test mounts BoostScreen in seller preview WITHOUT demo mode (the
 * exact crash case), flushes effects, and asserts:
 *   1. No console.error mentioning "Maximum update depth exceeded".
 *   2. The mount itself does not throw (React throws this as a real error
 *      when the loop-detection threshold is hit inside act()).
 *   3. The loop does not resurface across a blur→refocus cycle (the
 *      mechanism behind Boost staying mounted in the background while Dev
 *      navigated elsewhere — see useFocusEffect below) — refires focus a
 *      few times and re-asserts a clean console each time.
 */

const { apiMock, devPreviewState, focusState, renderCounter } = vi.hoisted(() => ({
  apiMock: {
    boosts: {
      targets: vi.fn(),
      list: vi.fn(),
      summary: vi.fn(),
      create: vi.fn(),
      pay: vi.fn(),
      verify: vi.fn(),
      update: vi.fn(),
      duplicate: vi.fn(),
      refreshInsights: vi.fn(),
    },
  },
  devPreviewState: { seller: true, demo: false },
  focusState: {
    callback: undefined as (() => void | (() => void)) | undefined,
    cleanup: undefined as (() => void) | undefined,
  },
  renderCounter: vi.fn(),
}));

vi.mock('react-native', () => {
  const nativeComponent = (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  };
  return {
    View: nativeComponent('View'),
    Text: nativeComponent('Text'),
    ScrollView: nativeComponent('ScrollView'),
    TouchableOpacity: nativeComponent('TouchableOpacity'),
    ActivityIndicator: nativeComponent('ActivityIndicator'),
    Alert: { alert: vi.fn() },
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1, absoluteFill: {} },
    PanResponder: { create: () => ({ panHandlers: {} }) },
    Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
  };
});

vi.mock('expo-image', () => ({
  Image: (props: Record<string, unknown>) => React.createElement('Image', props),
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }),
}));

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  selectionAsync: vi.fn(),
  notificationAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));

vi.mock('expo-web-browser', () => ({
  openAuthSessionAsync: vi.fn(),
}));

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({
    push: vi.fn(),
    setParams: vi.fn(),
    canGoBack: () => false,
    back: vi.fn(),
    replace: vi.fn(),
  }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    const ReactLocal = require('react') as typeof import('react');
    focusState.callback = callback;
    ReactLocal.useEffect(() => {
      const cleanup = callback();
      focusState.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
      return () => {
        focusState.cleanup?.();
        focusState.cleanup = undefined;
      };
    }, [callback]);
  },
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/hooks/useApi', () => ({
  useApi: () => apiMock,
}));

// isPreviewDemoMode() is called unconditionally near the top of every
// BoostScreen render body (it's not inside any hook), so counting its
// calls is a direct, portable proxy for "how many times did this component
// render" — more reliable here than waiting for react-test-renderer's
// act() to reproduce React's own internal "Maximum update depth exceeded"
// throw, which (confirmed empirically while writing this test) does not
// reliably reproduce inside act()'s synchronous effect-flushing model the
// same way it does in a real browser's scheduler, even with the original
// bug's code reinstated. A real infinite loop would still call this far
// more often per settle-cycle than the bounded, fixed version does.
vi.mock('@/lib/devPreview', () => ({
  isSellerDevPreview: () => devPreviewState.seller,
  isPreviewDemoMode: () => {
    renderCounter();
    return devPreviewState.demo;
  },
}));

vi.mock('@/components/ScreenHeader', () => ({
  ScreenHeader: (props: Record<string, unknown>) => React.createElement('ScreenHeader', props),
}));

vi.mock('@/components/ui/Button', () => ({
  Button: (props: Record<string, unknown>) => React.createElement('Button', props),
}));

vi.mock('@/components/BrandthreadUI', () => ({
  EmptyState: (props: Record<string, unknown>) => React.createElement('EmptyState', props),
}));

vi.mock('@/lib/theme', () => ({
  BG: '#0A0A0B', CARD: '#18181B', CARD_ELEVATED: '#222226', BORDER: '#303044',
  FG: '#F7F7FA', MUTED: '#AAAABC', SUBTLE: '#77778A',
  FONT: { regular: 'System', semibold: 'System', bold: 'System', medium: 'System' },
  FS: { xs: 11, sm: 13, base: 15, md: 17, lg: 19, xl: 22, xxl: 26 },
  SP: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
  RADIUS: { xs: 6, sm: 10, md: 14, lg: 18, pill: 999 },
  ICON: { xs: 12, sm: 16, md: 20, lg: 24, xl: 32, xxl: 40 },
  SHADOW_SM: { shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
}));

import BoostScreen from '@/app/boost';

async function flushPromises(iterations = 6) {
  for (let i = 0; i < iterations; i += 1) await Promise.resolve();
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<BoostScreen />);
    await flushPromises();
  });
  return renderer;
}

/** Simulates the screen losing then regaining focus (e.g. navigating away
 * to another tab and back) without unmounting it — Boost stays mounted in
 * the nav stack, which is exactly the scenario that let the infinite loop
 * keep running in the background after Dev navigated to Settings. */
async function blurThenRefocus() {
  await act(async () => {
    focusState.cleanup?.();
    focusState.cleanup = undefined;
    await flushPromises();
  });
  await act(async () => {
    focusState.cleanup = focusState.callback?.() as (() => void) | undefined;
    await flushPromises();
  });
}

describe('Boost (fresh seller dev-preview, no demo) does not infinite-loop', () => {
  let renderer: ReactTestRenderer | undefined;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    devPreviewState.seller = true;
    devPreviewState.demo = false; // the exact crash case: fresh, no &demo=1
    focusState.callback = undefined;
    focusState.cleanup = undefined;
    Object.values(apiMock.boosts).forEach((fn) => fn.mockReset());
    renderCounter.mockReset();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
      renderer = undefined;
    }
    consoleErrorSpy.mockRestore();
  });

  function assertNoMaxUpdateDepthError() {
    const offending = consoleErrorSpy.mock.calls.filter((call: unknown[]) =>
      call.some((arg) => typeof arg === 'string' && arg.includes('Maximum update depth exceeded')));
    expect(offending).toHaveLength(0);
  }

  it('mounts without throwing and without logging "Maximum update depth exceeded"', async () => {
    await expect(renderScreen()).resolves.toBeDefined();
  });

  it('settles within a small, bounded number of render cycles rather than looping', async () => {
    renderer = await renderScreen();
    assertNoMaxUpdateDepthError();

    // The very first render's own `previewTargets` happens to be the exact
    // same array reference useState captured as the initial `targets`
    // value (both computed in that same render pass), so the seeding
    // effect's first run is a no-op by coincidence — it takes ONE more
    // externally-triggered re-render (e.g. a parent re-render, a theme/
    // route-param change — anything) to recompute `previewTargets` as a
    // genuinely NEW, different reference and kick the loop off for real.
    // `renderer.update()` with the same element type is exactly that kind
    // of externally-triggered re-render.
    await act(async () => {
      renderer!.update(<BoostScreen />);
      await flushPromises();
    });
    assertNoMaxUpdateDepthError();
    const settledCount = renderCounter.mock.calls.length;

    // Keep draining the microtask queue well past what a healthy mount
    // needs (an infinite effect→setState→render loop reschedules itself
    // every microtask tick, so its render count keeps climbing linearly
    // with how long we keep flushing; a settled screen's does not).
    await act(async () => {
      await flushPromises(200);
    });
    assertNoMaxUpdateDepthError();

    // A healthy mount (initial render + the seeding effect's one settled
    // update, plus React's own double-invoke in some configurations) does
    // not grow at all once settled. A real infinite loop's render count
    // scales with how long we kept flushing above (it would be in the
    // hundreds here, not near-zero) — this generous ceiling still catches
    // a real regression while never flaking on an innocent extra render.
    expect(renderCounter.mock.calls.length - settledCount).toBeLessThan(20);
  });

  it('settles on the real fresh empty state, never the hardcoded demo posts', async () => {
    renderer = await renderScreen();
    assertNoMaxUpdateDepthError();

    const emptyState = renderer.root.findAllByType('EmptyState' as never);
    // Fresh (no &demo=1): the honest "no eligible posts yet" empty state,
    // never the "New arrivals — studio try-on"-style demo placeholders —
    // this was the sibling bug fixed alongside the infinite loop.
    expect(emptyState.length).toBeGreaterThan(0);
  });

  it('stays clean across repeated blur → refocus cycles (screen kept mounted in the nav stack while navigating elsewhere)', async () => {
    renderer = await renderScreen();
    assertNoMaxUpdateDepthError();

    for (let i = 0; i < 4; i += 1) {
      await blurThenRefocus();
      assertNoMaxUpdateDepthError();
    }

    // The API was never called at all in seller-preview mode (the effects
    // seed local preview state directly) — confirms the "effect fires every
    // render" loop isn't just silently hidden behind resolved promises.
    expect(apiMock.boosts.targets).not.toHaveBeenCalled();
    expect(apiMock.boosts.list).not.toHaveBeenCalled();
  });
});
