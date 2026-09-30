/**
 * SellerDashboardChart's sliding range-indicator pill — regression test for
 * the reported "period pill shows Today selected, then jumps to Week ~4s
 * later" bug.
 *
 * Root cause: the indicator only mounts once its row has a real measured
 * width (via onLayout), which — on a screen that waits on real data before
 * the chart even renders — can land seconds after first paint. The old code
 * always reached that first position via `withSpring`, whose shared value
 * defaults to x=0 (the "Today" tab's position): the indicator would appear
 * for the first time already mid-flight, animating from "Today" over to
 * whatever range was actually selected — reading as the period switching
 * itself right after load, even though `range` never changed.
 *
 * Fix: snap directly to the correct position (no animation) the first time
 * a width becomes known; only animate real, user-driven range changes.
 * Same mocking approach as tests/seller-dashboard-chart.test.tsx, with
 * `withSpring` spied on (not a plain identity function) so this can tell
 * "snapped directly" apart from "animated to the same end value".
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => {
  const React = require('react') as typeof import('react');
  const el = (name: string) => (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as React.ReactNode);
  return {
    StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1, absoluteFill: {}, absoluteFillObject: {} },
    View: el('View'),
    Text: el('Text'),
    TouchableOpacity: el('TouchableOpacity'),
    Platform: { OS: 'ios', select: (spec: Record<string, unknown>) => spec.ios ?? spec.default },
  };
});

vi.mock('react-native-gesture-handler', () => {
  function makePan() {
    const chain: any = {
      enabled: () => chain,
      onBegin: () => chain,
      onUpdate: () => chain,
      onFinalize: () => chain,
    };
    return chain;
  }
  const React = require('react') as typeof import('react');
  return {
    Gesture: { Pan: makePan },
    GestureDetector: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  };
});

const { withSpringSpy } = vi.hoisted(() => ({
  withSpringSpy: vi.fn((toValue: unknown) => ({ __spring: true, toValue })),
}));

vi.mock('react-native-reanimated', () => {
  const React = require('react') as typeof import('react');
  const el = (name: string) => (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as React.ReactNode);
  return {
    default: { View: el('AnimatedView') },
    // Persists the same object identity across re-renders (via useRef), the
    // way the real hook does — a fresh {value} object per render would lose
    // the effect's mutation on the very next render, masking exactly the
    // kind of snap-vs-animate bug this file exists to catch.
    useSharedValue: (initial: unknown) => React.useRef({ value: initial }).current,
    useAnimatedStyle: (fn: () => Record<string, unknown>) => fn(),
    useAnimatedReaction: () => {},
    runOnJS: (fn: (...args: any[]) => void) => fn,
    withSpring: withSpringSpy,
    withTiming: (toValue: unknown) => toValue,
    Easing: { bezier: () => (t: number) => t },
  };
});

vi.mock('expo-linear-gradient', () => {
  const React = require('react') as typeof import('react');
  return { LinearGradient: (props: Record<string, unknown>) => React.createElement('LinearGradient', props, props.children as React.ReactNode) };
});

vi.mock('@/components/ui/Glass', () => {
  const React = require('react') as typeof import('react');
  return { Glass: (props: Record<string, unknown>) => React.createElement('Glass', props, props.children as React.ReactNode) };
});

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light' },
}));

vi.mock('react-native-svg', () => {
  const React = require('react') as typeof import('react');
  const el = (name: string) => (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as React.ReactNode);
  return { default: el('Svg'), Svg: el('Svg'), Defs: el('Defs'), LinearGradient: el('LinearGradient'), Stop: el('Stop'), Path: el('Path') };
});

import { SellerDashboardChart } from '@/components/SellerDashboardChart';

const theme = {
  accent: '#F7F7FA', accentDim: 'rgba(255,255,255,0.055)', text: '#F7F7FA',
  muted: 'rgba(247,247,250,0.58)', subtle: 'rgba(247,247,250,0.50)',
  border: 'rgba(255,255,255,0.07)', borderSubtle: 'rgba(255,255,255,0.04)', background: '#0A0A0B',
} as any;

describe('SellerDashboardChart range indicator — no post-load jump', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    renderer?.unmount();
    renderer = null;
    withSpringSpy.mockClear();
  });

  it('snaps directly to the already-selected range on its first layout — never springs from "Today"', async () => {
    // Mounts already on "week", simulating the real scenario: the chart
    // only mounts once data has loaded, well after `range` state (always
    // 'week' by default) was set — there is no earlier frame where "today"
    // was the live selection.
    await act(async () => {
      renderer = create(
        <SellerDashboardChart
          values={[10, 20, 15, 40, 30, 25, 50]}
          labels={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']}
          theme={theme}
          range="week"
          onRangeChange={vi.fn()}
          onScrub={vi.fn()}
          isEmpty={false}
        />,
      );
    });

    const rangeRow = renderer!.root.findByProps({ testID: 'seller-dashboard-range-pills' });
    await act(async () => {
      rangeRow.props.onLayout({ nativeEvent: { layout: { width: 350 } } });
    });

    // The very first positioning must not go through withSpring at all —
    // that's what made the indicator appear mid-flight from "Today".
    expect(withSpringSpy).not.toHaveBeenCalled();

    // The mocked shared value mutates a plain object outside React's render
    // cycle (real reanimated does too — it updates the UI thread directly),
    // so an extra render is needed here, purely as a test mechanic, to read
    // useAnimatedStyle's freshly recomputed style off of it.
    await act(async () => {
      renderer!.update(
        <SellerDashboardChart
          values={[10, 20, 15, 40, 30, 25, 50]}
          labels={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']}
          theme={theme}
          range="week"
          onRangeChange={vi.fn()}
          onScrub={vi.fn()}
          isEmpty={false}
        />,
      );
    });

    const indicator = renderer!.root.findByProps({ testID: 'seller-dashboard-range-indicator' });
    const style = indicator.props.style;
    const translateX = (Array.isArray(style) ? style : [style])
      .flat(Infinity)
      .find((s: any) => s && typeof s === 'object' && 'transform' in s)?.transform?.[0]?.translateX;
    // "week" is DASHBOARD_RANGES index 1 — its x is strictly greater than 0
    // (index 0, "today"'s position), and it must be the immediate, un-sprung
    // shared-value assignment, not an animation descriptor.
    expect(translateX).toBeGreaterThan(0);
    expect(typeof translateX).toBe('number');
  });

  it('does animate via withSpring on a real, user-driven range change', async () => {
    await act(async () => {
      renderer = create(
        <SellerDashboardChart
          values={[10, 20, 15, 40, 30, 25, 50]}
          labels={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']}
          theme={theme}
          range="week"
          onRangeChange={vi.fn()}
          onScrub={vi.fn()}
          isEmpty={false}
        />,
      );
    });
    const rangeRow = renderer!.root.findByProps({ testID: 'seller-dashboard-range-pills' });
    await act(async () => {
      rangeRow.props.onLayout({ nativeEvent: { layout: { width: 350 } } });
    });
    expect(withSpringSpy).not.toHaveBeenCalled(); // first positioning: still a snap

    // Simulate the parent re-rendering with a new `range` after the user
    // taps a different pill (onRangeChange itself is owned by the parent —
    // SellerHomeCommerceDashboard — so this test drives it via props).
    await act(async () => {
      renderer!.update(
        <SellerDashboardChart
          values={[5, 10, 8, 20, 15, 12, 25]}
          labels={['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul']}
          theme={theme}
          range="month"
          onRangeChange={vi.fn()}
          onScrub={vi.fn()}
          isEmpty={false}
        />,
      );
    });
    expect(withSpringSpy).toHaveBeenCalledTimes(1);
  });
});
