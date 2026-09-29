/**
 * SellerDashboardChart — focused tests for the scrubbable range chart.
 * Follows the mocking conventions in components/discover/__tests__/DiscoverPager.test.tsx
 * (react-test-renderer + hand-rolled react-native/reanimated mocks).
 *
 * Full finger-drag simulation isn't exercised here (react-native-gesture-handler's
 * native pan recognizer has no meaningful JS-only equivalent); instead this
 * covers what's actually decidable from the render tree: the flat, empty
 * baseline for a brand-new seller, the range pill row switching ranges, and
 * the gesture being disabled (not just visually inert) for an empty chart.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const panCalls: Array<{ enabled: boolean }> = [];

vi.mock('react-native', () => {
  const React = require('react') as typeof import('react');
  const el = (name: string) => (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as React.ReactNode);
  return {
    StyleSheet: {
      create: (s: unknown) => s,
      hairlineWidth: 1,
      absoluteFill: {},
      absoluteFillObject: {},
    },
    View: el('View'),
    Text: el('Text'),
    TouchableOpacity: el('TouchableOpacity'),
    Platform: { OS: 'ios', select: (spec: Record<string, unknown>) => spec.ios ?? spec.default },
    Animated: {
      View: el('AnimatedView'),
      Value: class { constructor(public value: number) {} },
      timing: () => ({ start: (cb?: () => void) => cb?.() }),
      spring: () => ({ start: (cb?: () => void) => cb?.() }),
      parallel: () => ({ start: (cb?: () => void) => cb?.() }),
    },
  };
});

vi.mock('react-native-gesture-handler', () => {
  function makePan() {
    const chain: any = {
      enabled: (value: boolean) => { panCalls.push({ enabled: value }); return chain; },
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

vi.mock('react-native-reanimated', () => {
  const React = require('react') as typeof import('react');
  const el = (name: string) => (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as React.ReactNode);
  return {
    default: { View: el('AnimatedView') },
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useAnimatedStyle: (fn: () => Record<string, unknown>) => fn(),
    useAnimatedReaction: () => {},
    runOnJS: (fn: (...args: any[]) => void) => fn,
    withSpring: (toValue: unknown) => toValue,
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

import { AXIS_LABEL_WIDTH, DASHBOARD_RANGES, SellerDashboardChart } from '@/components/SellerDashboardChart';

const theme = {
  accent: '#F7F7FA',
  accentDim: 'rgba(255,255,255,0.055)',
  text: '#F7F7FA',
  muted: 'rgba(247,247,250,0.58)',
  subtle: 'rgba(247,247,250,0.50)',
  border: 'rgba(255,255,255,0.07)',
  borderSubtle: 'rgba(255,255,255,0.04)',
  background: '#0A0A0B',
} as any;

function flattenStyle(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity) : [style]).filter(Boolean));
}

describe('SellerDashboardChart', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    renderer?.unmount();
    renderer = null;
    panCalls.length = 0;
  });

  // The axis row only lays out (and is scrubbable) once the chart area has
  // a real measured width — mirrors onLayout firing on a real device/browser.
  async function layoutChart(width = 350) {
    const chartArea = renderer!.root.findByProps({ testID: 'seller-dashboard-chart' });
    await act(async () => {
      chartArea.props.onLayout({ nativeEvent: { layout: { width } } });
    });
  }

  it('lists exactly the five spec ranges, in order: Today, Week, Month, Year, All', () => {
    expect(DASHBOARD_RANGES.map((r) => r.id)).toEqual(['today', 'week', 'month', 'year', 'all']);
    expect(DASHBOARD_RANGES.map((r) => r.label)).toEqual(['Today', 'Week', 'Month', 'Year', 'All']);
  });

  it('disables the scrub gesture for an empty (new-seller) chart', async () => {
    await act(async () => {
      renderer = create(
        <SellerDashboardChart
          values={[0, 0, 0, 0]}
          labels={['Sun', 'Mon', 'Tue', 'Wed']}
          theme={theme}
          range="week"
          onRangeChange={vi.fn()}
          onScrub={vi.fn()}
          isEmpty
        />,
      );
    });
    expect(panCalls[panCalls.length - 1]).toEqual({ enabled: false });
  });

  it('enables the scrub gesture once there is real, multi-point activity', async () => {
    await act(async () => {
      renderer = create(
        <SellerDashboardChart
          values={[100, 200, 150, 400]}
          labels={['Sun', 'Mon', 'Tue', 'Wed']}
          theme={theme}
          range="week"
          onRangeChange={vi.fn()}
          onScrub={vi.fn()}
          isEmpty={false}
        />,
      );
    });
    expect(panCalls[panCalls.length - 1]).toEqual({ enabled: true });
  });

  it('still shows correctly-labeled axes for the empty/fresh state — only the curve flattens, not the labels', async () => {
    await act(async () => {
      renderer = create(
        <SellerDashboardChart
          values={[0, 0, 0, 0, 0, 0, 0]}
          labels={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']}
          theme={theme}
          range="week"
          onRangeChange={vi.fn()}
          onScrub={vi.fn()}
          isEmpty
        />,
      );
    });
    await layoutChart();
    const axisRow = renderer!.root.findByProps({ testID: 'seller-dashboard-chart-axis' });
    const texts = axisRow.findAllByType('Text' as React.ElementType).map((t) => t.props.children);
    expect(texts).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  it('renders a visible (non-transparent-border) flat line color for the empty state, not an invisible one', async () => {
    await act(async () => {
      renderer = create(
        <SellerDashboardChart
          values={[0, 0, 0]}
          labels={['Mon', 'Tue', 'Wed']}
          theme={theme}
          range="week"
          onRangeChange={vi.fn()}
          onScrub={vi.fn()}
          isEmpty
        />,
      );
    });
    await layoutChart();
    const path = renderer!.root.findAllByType('Path' as React.ElementType).find((p) => p.props.fill === 'none');
    expect(path?.props.stroke).toBe(theme.muted);
    expect(path?.props.stroke).not.toBe(theme.borderSubtle);
  });

  it('calls onRangeChange with the tapped range id and marks it selected', async () => {
    const onRangeChange = vi.fn();
    await act(async () => {
      renderer = create(
        <SellerDashboardChart
          values={[10, 20]}
          labels={['A', 'B']}
          theme={theme}
          range="week"
          onRangeChange={onRangeChange}
          onScrub={vi.fn()}
          isEmpty={false}
        />,
      );
    });

    const pills = renderer!.root.findAllByProps({ accessibilityRole: 'button' });
    const weekPill = pills.find((p) => p.props.accessibilityLabel === 'Show Week')!;
    expect(weekPill.props.accessibilityState).toMatchObject({ selected: true });
    const monthPill = pills.find((p) => p.props.accessibilityLabel === 'Show Month')!;
    expect(monthPill.props.accessibilityState).toMatchObject({ selected: false });

    await act(async () => {
      monthPill.props.onPress();
    });
    expect(onRangeChange).toHaveBeenCalledWith('month');
  });

  it('renders every x-axis label for Week — a calendar week only ever has 7, and all 7 fit (item 123)', async () => {
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    await act(async () => {
      renderer = create(
        <SellerDashboardChart
          values={[10, 20, 15, 40, 30, 25, 50]}
          labels={labels}
          theme={theme}
          range="week"
          onRangeChange={vi.fn()}
          onScrub={vi.fn()}
          isEmpty={false}
        />,
      );
    });
    await layoutChart();
    const axisRow = renderer!.root.findByProps({ testID: 'seller-dashboard-chart-axis' });
    const texts = axisRow.findAllByType('Text' as React.ElementType).map((t) => t.props.children);
    expect(texts).toEqual(labels);
  });

  it('shows only 4 evenly-spaced quarter-of-day labels for Today, not all 24 hourly buckets', async () => {
    const labels = Array.from({ length: 24 }, (_, h) => `${h}h`);
    await act(async () => {
      renderer = create(
        <SellerDashboardChart
          values={labels.map(() => 10)}
          labels={labels}
          theme={theme}
          range="today"
          onRangeChange={vi.fn()}
          onScrub={vi.fn()}
          isEmpty={false}
        />,
      );
    });
    await layoutChart();
    const axisRow = renderer!.root.findByProps({ testID: 'seller-dashboard-chart-axis' });
    const texts = axisRow.findAllByType('Text' as React.ElementType).map((t) => t.props.children);
    // Quarters of the day: hour 0, 6, 12, 18 (12am/6am/12pm/6pm), matching
    // Shopify's own Today/Yesterday Analytics chart. Only these 4 render —
    // the other 20 hourly buckets get no Text node at all (not a blank one
    // squeezed into a shared flex column, which truncated longer labels).
    expect(texts).toEqual(['0h', '6h', '12h', '18h']);
  });

  it('shows a small evenly-spaced subset of labels for Month (not all ~30 daily buckets)', async () => {
    const labels = Array.from({ length: 30 }, (_, i) => `Day ${i + 1}`);
    await act(async () => {
      renderer = create(
        <SellerDashboardChart
          values={labels.map(() => 10)}
          labels={labels}
          theme={theme}
          range="month"
          onRangeChange={vi.fn()}
          onScrub={vi.fn()}
          isEmpty={false}
        />,
      );
    });
    await layoutChart();
    const axisRow = renderer!.root.findByProps({ testID: 'seller-dashboard-chart-axis' });
    const visible = axisRow.findAllByType('Text' as React.ElementType).map((t) => t.props.children);
    expect(visible.length).toBeGreaterThanOrEqual(4);
    expect(visible.length).toBeLessThanOrEqual(6);
    expect(visible[0]).toBe('Day 1');
    expect(visible[visible.length - 1]).toBe('Day 30');
  });

  it('renders visible axis labels in perfectly even pixel columns, even when the underlying bucket indices are not evenly spaced (Year: 12 buckets / 6 labels)', async () => {
    // 12 buckets into 6 labels rounds to index gaps of 2,2,3,2,2 (an
    // unavoidable integer artifact — see selectEvenlySpacedIndices) — the
    // RENDERED columns must still be exactly even regardless.
    const labels = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
    const width = 360;
    await act(async () => {
      renderer = create(
        <SellerDashboardChart
          values={labels.map((_, i) => 10 + i)}
          labels={labels}
          theme={theme}
          range="year"
          onRangeChange={vi.fn()}
          onScrub={vi.fn()}
          isEmpty={false}
        />,
      );
    });
    await layoutChart(width);
    const axisRow = renderer!.root.findByProps({ testID: 'seller-dashboard-chart-axis' });
    const texts = axisRow.findAllByType('Text' as React.ElementType);
    expect(texts.map((t) => t.props.children)).toEqual(['Oct', 'Dec', 'Feb', 'May', 'Jul', 'Sep']);
    // Each label's own anchor point: the first is left-aligned at its box's
    // left edge, the last is right-aligned at its box's right edge, and
    // every middle label is centered in its box — so the *anchor* (not the
    // raw box `left`, which differs in meaning at the edges vs the middle)
    // is what must land in perfectly even columns.
    const anchors = texts.map((t) => {
      const style = flattenStyle(t.props.style);
      const left = style.left as number;
      if (style.textAlign === 'left') return left;
      if (style.textAlign === 'right') return left + AXIS_LABEL_WIDTH;
      return left + AXIS_LABEL_WIDTH / 2;
    });
    const gaps = anchors.slice(1).map((a, i) => a - anchors[i]);
    // Every gap — including the two end gaps, previously shrunk by the
    // center-then-clamp approach — must be exactly even now.
    const first = gaps[0];
    for (const gap of gaps) expect(Math.abs(gap - first)).toBeLessThan(0.01);
  });

  it('anchors the first label to the true left edge and the last label to the true right edge (no inward clamp shrinking the end gaps)', async () => {
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const width = 355;
    await act(async () => {
      renderer = create(
        <SellerDashboardChart
          values={labels.map(() => 10)}
          labels={labels}
          theme={theme}
          range="week"
          onRangeChange={vi.fn()}
          onScrub={vi.fn()}
          isEmpty={false}
        />,
      );
    });
    await layoutChart(width);
    const axisRow = renderer!.root.findByProps({ testID: 'seller-dashboard-chart-axis' });
    const texts = axisRow.findAllByType('Text' as React.ElementType);
    const first = flattenStyle(texts[0].props.style);
    const last = flattenStyle(texts[texts.length - 1].props.style);
    expect(first.left).toBe(0);
    expect(first.textAlign).toBe('left');
    expect(last.left).toBe(width - AXIS_LABEL_WIDTH);
    expect(last.textAlign).toBe('right');
  });

  it('places the axis labels directly under the chart, ABOVE the range-selector pills (Shopify/Robinhood order)', async () => {
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
    await layoutChart();
    const root = renderer!.root.findAllByType('View' as React.ElementType);
    const axisIndex = root.findIndex((v) => v.props.testID === 'seller-dashboard-chart-axis');
    const pillsIndex = root.findIndex((v) => v.props.testID === 'seller-dashboard-range-pills');
    expect(axisIndex).toBeGreaterThan(-1);
    expect(pillsIndex).toBeGreaterThan(-1);
    expect(axisIndex).toBeLessThan(pillsIndex);
  });

  it('renders a sliding glass range indicator behind the tabs (item 124)', async () => {
    await act(async () => {
      renderer = create(
        <SellerDashboardChart
          values={[10, 20]}
          labels={['A', 'B']}
          theme={theme}
          range="week"
          onRangeChange={vi.fn()}
          onScrub={vi.fn()}
          isEmpty={false}
        />,
      );
    });
    // Flush the range row's onLayout so the indicator gets a non-zero width.
    const rangeRow = renderer!.root.findByProps({ testID: 'seller-dashboard-range-pills' });
    await act(async () => {
      rangeRow.props.onLayout({ nativeEvent: { layout: { width: 350 } } });
    });
    const indicator = renderer!.root.findByProps({ testID: 'seller-dashboard-range-indicator' });
    expect(indicator.findByType('Glass' as unknown as React.ElementType)).toBeTruthy();
  });
});
