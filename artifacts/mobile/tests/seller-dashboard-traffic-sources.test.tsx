/**
 * SellerDashboardTrafficSources — item 126 (traffic sources half). The
 * backend's storefront_visits table has no source/referrer column, so this
 * card must show the one real number that exists (total visits) and never
 * fabricate a per-source split.
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

const theme = {
  text: '#F7F7FA',
  muted: 'rgba(247,247,250,0.58)',
  subtle: 'rgba(247,247,250,0.50)',
  borderSubtle: 'rgba(255,255,255,0.04)',
  cardElevated: '#1E1E22',
} as any;

describe('SellerDashboardTrafficSources', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    renderer?.unmount();
    renderer = null;
  });

  it('shows the real total visit count, compactly formatted', async () => {
    await act(async () => {
      renderer = create(<SellerDashboardTrafficSources totalVisits={12480} theme={theme} />);
    });
    const texts = renderer!.root.findAllByType('Text' as React.ElementType).map((t) => t.props.children);
    expect(texts).toContain('12.5K');
    expect(texts).toContain('store visits this period');
  });

  it('never fabricates a per-source number: every source category reads em-dash, not a number', async () => {
    await act(async () => {
      renderer = create(<SellerDashboardTrafficSources totalVisits={500} theme={theme} />);
    });
    const texts = renderer!.root.findAllByType('Text' as React.ElementType).map((t) => t.props.children);
    const dashCount = texts.filter((t) => t === '—').length;
    expect(dashCount).toBe(4); // Discover, Search, Profile, External — one row each
    expect(texts.join(' ')).toContain("isn't tracked yet");
  });

  it('lists all four real source categories by name', async () => {
    await act(async () => {
      renderer = create(<SellerDashboardTrafficSources totalVisits={0} theme={theme} />);
    });
    const texts = renderer!.root.findAllByType('Text' as React.ElementType).map((t) => t.props.children);
    expect(texts).toContain('Discover feed');
    expect(texts).toContain('Search');
    expect(texts).toContain('Your profile');
    expect(texts).toContain('External links');
  });
});
