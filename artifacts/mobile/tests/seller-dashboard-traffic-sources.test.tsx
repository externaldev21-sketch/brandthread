/**
 * SellerDashboardTrafficSources — real per-source breakdown (item 126,
 * finished). Backed by the `store_visits` table (migration 108) and the
 * `trafficSources` field GET /api/analytics/home now returns for the same
 * range as the rest of the dashboard. No lock row, no dashes — a fresh
 * store with no visits yet shows a real 0 for every source.
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
  };
});

vi.mock('@expo/vector-icons', () => {
  const React = require('react') as typeof import('react');
  return { Feather: (props: Record<string, unknown>) => React.createElement('Feather', props) };
});

import { SellerDashboardTrafficSources } from '@/components/SellerDashboardTrafficSources';
import { EMPTY_TRAFFIC_SOURCES } from '@/lib/sellerHomeAnalytics';

const theme = {
  text: '#F7F7FA',
  muted: 'rgba(247,247,250,0.58)',
  subtle: 'rgba(247,247,250,0.50)',
  borderSubtle: 'rgba(255,255,255,0.04)',
  cardElevated: '#1E1E22',
} as any;

const REAL_SOURCES = [
  { source: 'feed' as const, count: 500, sharePercent: 40 },
  { source: 'search' as const, count: 312, sharePercent: 25 },
  { source: 'profile' as const, count: 250, sharePercent: 20 },
  { source: 'external' as const, count: 188, sharePercent: 15 },
];

describe('SellerDashboardTrafficSources', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    renderer?.unmount();
    renderer = null;
  });

  it('shows the real total visit count, compactly formatted', async () => {
    await act(async () => {
      renderer = create(
        <SellerDashboardTrafficSources totalVisits={12480} trafficSources={REAL_SOURCES} theme={theme} />,
      );
    });
    const texts = renderer!.root.findAllByType('Text' as React.ElementType).map((t) => t.props.children);
    expect(texts).toContain('12.5K');
    expect(texts).toContain('store visits this period');
  });

  it('shows a plain "No store visits yet" line for the zero/fresh state — never a bold "0"', async () => {
    await act(async () => {
      renderer = create(
        <SellerDashboardTrafficSources totalVisits={0} trafficSources={EMPTY_TRAFFIC_SOURCES} theme={theme} />,
      );
    });
    const texts = renderer!.root.findAllByType('Text' as React.ElementType).map((t) => t.props.children);
    expect(texts).toContain('No store visits yet');
    expect(texts).not.toContain('store visits this period');
  });

  it('shows a real count and share for every source — no lock row, no dashes', async () => {
    await act(async () => {
      renderer = create(
        <SellerDashboardTrafficSources totalVisits={1250} trafficSources={REAL_SOURCES} theme={theme} />,
      );
    });
    const texts = renderer!.root.findAllByType('Text' as React.ElementType).map((t) => String(t.props.children));
    expect(texts).not.toContain('—');
    expect(texts.join(' ')).not.toContain("isn't tracked yet");
    expect(texts).toContain('500');
    expect(texts).toContain('40%');
    expect(texts).toContain('312');
    expect(texts).toContain('25%');
    expect(texts).toContain('250');
    expect(texts).toContain('20%');
    expect(texts).toContain('188');
    expect(texts).toContain('15%');
  });

  it('a fresh store with no visits yet shows a real 0 (not a dash) for every source', async () => {
    await act(async () => {
      renderer = create(
        <SellerDashboardTrafficSources totalVisits={0} trafficSources={EMPTY_TRAFFIC_SOURCES} theme={theme} />,
      );
    });
    const texts = renderer!.root.findAllByType('Text' as React.ElementType).map((t) => String(t.props.children));
    expect(texts).not.toContain('—');
    const zeroCount = texts.filter((t) => t === '0').length;
    expect(zeroCount).toBe(4);
    const zeroPercentCount = texts.filter((t) => t === '0%').length;
    expect(zeroPercentCount).toBe(4);
  });

  it('lists all four real source categories by name', async () => {
    await act(async () => {
      renderer = create(
        <SellerDashboardTrafficSources totalVisits={0} trafficSources={EMPTY_TRAFFIC_SOURCES} theme={theme} />,
      );
    });
    const texts = renderer!.root.findAllByType('Text' as React.ElementType).map((t) => t.props.children);
    expect(texts).toContain('Discover feed');
    expect(texts).toContain('Search');
    expect(texts).toContain('Your profile');
    expect(texts).toContain('External links');
  });
});
