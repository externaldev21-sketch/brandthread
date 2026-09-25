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
    },
    View: el('View'),
    Text: el('Text'),
    TouchableOpacity: el('TouchableOpacity'),
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
  };
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

import { DASHBOARD_RANGES, SellerDashboardChart } from '@/components/SellerDashboardChart';

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

  it('hides axis endpoint labels for the empty state (never implies real activity)', async () => {
    await act(async () => {
      renderer = create(
        <SellerDashboardChart
          values={[0, 0]}
          labels={['Sun', 'Sat']}
          theme={theme}
          range="week"
          onRangeChange={vi.fn()}
          onScrub={vi.fn()}
          isEmpty
        />,
      );
    });
    const texts = renderer!.root.findAllByType('Text' as React.ElementType).map((t) => t.props.children);
    expect(texts).not.toContain('Sun');
    expect(texts).not.toContain('Sat');
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
});
