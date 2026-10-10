/**
 * SellerDashboardTrafficSources — redesign per Dev's direction (Mobbin refs:
 * YouTube Studio per-source bars, eBay headline+delta, Stripe/Linear-style
 * single segmented breakdown bar), reskinned black/white/silver.
 *
 * Reported bug this redesign fixes: the old zero state showed BOTH "No
 * store visits yet" AND a table of four "0  0%" rows — doubled up. A fresh
 * store must show exactly one clean empty state, never a zero table.
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
    StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
    View: el('View'),
    Text: el('Text'),
    TouchableOpacity: el('TouchableOpacity'),
  };
});

vi.mock('@expo/vector-icons', () => {
  const React = require('react') as typeof import('react');
  return { Feather: (props: Record<string, unknown>) => React.createElement('Feather', props) };
});

vi.mock('react-native-reanimated', () => {
  const React = require('react') as typeof import('react');
  const el = (name: string) => (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as React.ReactNode);
  return {
    default: { View: el('AnimatedView') },
    useSharedValue: (initial: unknown) => React.useRef({ value: initial }).current,
    useAnimatedStyle: (fn: () => Record<string, unknown>) => fn(),
    withTiming: (toValue: unknown) => toValue,
    Easing: { out: (fn: unknown) => fn, cubic: (t: number) => t },
  };
});

vi.mock('@/components/BrandthreadUI', () => {
  const React = require('react') as typeof import('react');
  return {
    PressableScale: ({ children, onPress, ...rest }: any) =>
      React.createElement('PressableScale', { ...rest, onPress }, children),
  };
});

import { SellerDashboardTrafficSources } from '@/components/SellerDashboardTrafficSources';
import { EMPTY_TRAFFIC_SOURCES } from '@/lib/sellerHomeAnalytics';

const theme = {
  text: '#F7F7FA',
  muted: '#C0C0C0',
  subtle: '#B0B0B0',
  borderSubtle: 'rgba(255,255,255,0.04)',
  cardElevated: '#1E1E22',
} as any;

const REAL_SOURCES = [
  { source: 'feed' as const, count: 500, sharePercent: 40 },
  { source: 'search' as const, count: 312, sharePercent: 25 },
  { source: 'profile' as const, count: 250, sharePercent: 20 },
  { source: 'external' as const, count: 188, sharePercent: 15 },
];

const noop = () => {};

describe('SellerDashboardTrafficSources', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    renderer?.unmount();
    renderer = null;
  });

  function texts() {
    return renderer!.root.findAllByType('Text' as React.ElementType).map((t) => String(t.props.children));
  }

  it('shows the real total visit count, compactly formatted, with a delta line', async () => {
    // totalVisits deliberately does NOT match the row sum here (12480 vs.
    // 12480 — see the row counts below) to prove the headline is derived
    // from trafficSources, not from the totalVisits prop, whenever rows are
    // present — this is exactly what keeps the two numbers from disagreeing.
    const rowsSummingTo12480 = [
      { source: 'feed' as const, count: 4992, sharePercent: 40 },
      { source: 'search' as const, count: 3120, sharePercent: 25 },
      { source: 'profile' as const, count: 2496, sharePercent: 20 },
      { source: 'external' as const, count: 1872, sharePercent: 15 },
    ];
    await act(async () => {
      renderer = create(
        <SellerDashboardTrafficSources
          totalVisits={999999} previousVisits={10000} periodLabel="last week"
          trafficSources={rowsSummingTo12480} theme={theme}
          onSeeAll={noop} onOpenSource={noop} onShareStore={noop}
        />,
      );
    });
    const t = texts();
    expect(t).toContain('12.5K');
    expect(t.join(' ')).toContain('store visits this period');
    expect(t.join(' ')).toContain('vs last week');
  });

  it('the headline always equals the sum of the row counts, even when totalVisits disagrees with it', async () => {
    const rows = [
      { source: 'feed' as const, count: 123, sharePercent: 40.1 },
      { source: 'search' as const, count: 75, sharePercent: 24.4 },
      { source: 'profile' as const, count: 62, sharePercent: 20.2 },
      { source: 'external' as const, count: 47, sharePercent: 15.3 },
    ];
    const rowSum = rows.reduce((sum, r) => sum + r.count, 0); // 307
    await act(async () => {
      renderer = create(
        <SellerDashboardTrafficSources
          totalVisits={300} previousVisits={250} periodLabel="this week"
          trafficSources={rows} theme={theme}
          onSeeAll={noop} onOpenSource={noop} onShareStore={noop}
        />,
      );
    });
    const t = texts();
    // The headline must read the row sum (307), never the disagreeing
    // totalVisits prop (300) — and the row percentages must be recomputed
    // from that same 307, not the stale sharePercent values passed in.
    expect(t).toContain(String(rowSum));
    expect(t).not.toContain('300');
    expect(t).toContain('40.1%');
    expect(t).toContain('24.4%');
    expect(t).toContain('20.2%');
    expect(t).toContain('15.3%');
  });

  it('a fresh store shows exactly ONE clean empty state — never both the message AND a table of zero rows', async () => {
    await act(async () => {
      renderer = create(
        <SellerDashboardTrafficSources
          totalVisits={0} previousVisits={0} periodLabel="last week"
          trafficSources={EMPTY_TRAFFIC_SOURCES} theme={theme}
          onSeeAll={noop} onOpenSource={noop} onShareStore={noop}
        />,
      );
    });
    const t = texts();
    expect(t.join(' ')).toContain('No visits yet');
    // Share store moved to the Dashboard header (Dev's share store spec).
    expect(t.join(' ')).not.toContain('Share store');
    // The doubled-up bug: a zero table (four "0" + four "0%" rows) must
    // never render alongside the empty-state message.
    expect(t.filter((x) => x === '0').length).toBe(0);
    expect(t.filter((x) => x === '0%').length).toBe(0);
    expect(t).not.toContain('store visits this period');
    // No source names/legend rows in the empty state either.
    expect(t).not.toContain('Discover feed');
  });

  it('shows a real count and share for every source once there are visits — no lock row, no dashes', async () => {
    await act(async () => {
      renderer = create(
        <SellerDashboardTrafficSources
          totalVisits={1250} previousVisits={1000} periodLabel="last week"
          trafficSources={REAL_SOURCES} theme={theme}
          onSeeAll={noop} onOpenSource={noop} onShareStore={noop}
        />,
      );
    });
    const t = texts();
    expect(t).not.toContain('—');
    expect(t.join(' ')).not.toContain("isn't tracked yet");
    expect(t).toContain('500');
    expect(t).toContain('40%');
    expect(t).toContain('312');
    expect(t).toContain('25%');
    expect(t).toContain('250');
    expect(t).toContain('20%');
    expect(t).toContain('188');
    expect(t).toContain('15%');
    expect(t).toContain('Discover feed');
    expect(t).toContain('Search');
    expect(t).toContain('Your profile');
    expect(t).toContain('External links');
  });

  it('highlights the top source with a "Most visits from" caption', async () => {
    await act(async () => {
      renderer = create(
        <SellerDashboardTrafficSources
          totalVisits={1250} previousVisits={1000} periodLabel="last week"
          trafficSources={REAL_SOURCES} theme={theme}
          onSeeAll={noop} onOpenSource={noop} onShareStore={noop}
        />,
      );
    });
    const joined = texts().join(' ');
    expect(joined).toContain('Most visits from');
    expect(joined).toContain('Discover feed');
  });

  it('no preview/demo/placeholder wording anywhere in the source', () => {
    const { readFileSync } = require('node:fs');
    const { resolve } = require('node:path');
    const source = readFileSync(resolve(__dirname, '../components/SellerDashboardTrafficSources.tsx'), 'utf8');
    expect(source).not.toMatch(/\bpreview\b|\bdemo\b|coming soon|not available yet/i);
  });
});
