/**
 * SellerDashboardActionNeeded — item 125: real counts (unfulfilled orders,
 * low stock, pending payouts) each render as a tappable row, and
 * pendingPayouts never blocks the "all caught up" collapse (it's
 * informational, not something the seller needs to act on).
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
    StyleSheet: {
      create: (s: unknown) => s,
      hairlineWidth: 1,
      flatten: (style: unknown) => Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity) : [style]).filter(Boolean)),
    },
    View: el('View'),
    Text: el('Text'),
  };
});

vi.mock('@/components/BrandthreadUI', () => {
  const React = require('react') as typeof import('react');
  return {
    PressableScale: (props: Record<string, unknown>) =>
      React.createElement('PressableScale', props, props.children as React.ReactNode),
  };
});

vi.mock('@expo/vector-icons', () => {
  const React = require('react') as typeof import('react');
  return {
    Feather: (props: Record<string, unknown>) => React.createElement('Feather', props),
  };
});

import { SellerDashboardActionNeeded } from '@/components/SellerDashboardActionNeeded';
import type { DashboardActionCounts } from '@/lib/sellerDashboardStats';

const theme = {
  text: '#F7F7FA',
  muted: 'rgba(247,247,250,0.58)',
  subtle: 'rgba(247,247,250,0.50)',
  borderSubtle: 'rgba(255,255,255,0.04)',
  cardElevated: '#1E1E22',
  success: '#10B981',
} as any;

function flattenStyle(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity) : [style]).filter(Boolean));
}

describe('SellerDashboardActionNeeded', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    renderer?.unmount();
    renderer = null;
  });

  it('renders every nonzero count as its own real, tappable row', async () => {
    const counts: DashboardActionCounts = { toShip: 3, toAnswer: 0, lowStock: 2, returns: 0, pendingPayouts: 1 };
    const onNavigate = vi.fn();
    await act(async () => {
      renderer = create(<SellerDashboardActionNeeded counts={counts} theme={theme} onNavigate={onNavigate} />);
    });
    const labels = renderer!.root
      .findAllByType('PressableScale' as unknown as React.ElementType)
      .map((row) => row.props.accessibilityLabel);
    expect(labels).toEqual([
      '3 orders to ship',
      '2 items low on stock',
      '1 payout on the way',
    ]);
  });

  it('navigates to the real route for the tapped row', async () => {
    const counts: DashboardActionCounts = { toShip: 1, toAnswer: 0, lowStock: 0, returns: 0, pendingPayouts: 0 };
    const onNavigate = vi.fn();
    await act(async () => {
      renderer = create(<SellerDashboardActionNeeded counts={counts} theme={theme} onNavigate={onNavigate} />);
    });
    const row = renderer!.root.findByProps({ accessibilityLabel: '1 order to ship' });
    await act(async () => { row.props.onPress(); });
    expect(onNavigate).toHaveBeenCalledWith('/(tabs)/orders?filter=unfulfilled');
  });

  it('shows "all caught up" when nothing is actionable and there is no pending payout', async () => {
    const counts: DashboardActionCounts = { toShip: 0, toAnswer: 0, lowStock: 0, returns: 0, pendingPayouts: 0 };
    await act(async () => {
      renderer = create(<SellerDashboardActionNeeded counts={counts} theme={theme} onNavigate={vi.fn()} />);
    });
    expect(renderer!.root.findByProps({ testID: 'seller-dashboard-all-caught-up' })).toBeTruthy();
    expect(renderer!.root.findAllByType('PressableScale' as unknown as React.ElementType)).toHaveLength(0);
  });

  it('a pending payout never blocks "all caught up" — both render together (item 125)', async () => {
    const counts: DashboardActionCounts = { toShip: 0, toAnswer: 0, lowStock: 0, returns: 0, pendingPayouts: 2 };
    await act(async () => {
      renderer = create(<SellerDashboardActionNeeded counts={counts} theme={theme} onNavigate={vi.fn()} />);
    });
    expect(renderer!.root.findByProps({ testID: 'seller-dashboard-all-caught-up' })).toBeTruthy();
    const row = renderer!.root.findByProps({ accessibilityLabel: '2 payouts on the way' });
    expect(row).toBeTruthy();
  });

  it('checkmark is monochrome (theme.text), never theme.success', async () => {
    const counts: DashboardActionCounts = { toShip: 0, toAnswer: 0, lowStock: 0, returns: 0, pendingPayouts: 0 };
    await act(async () => {
      renderer = create(<SellerDashboardActionNeeded counts={counts} theme={theme} onNavigate={vi.fn()} />);
    });
    const check = renderer!.root.findByProps({ name: 'check-circle' });
    expect(check.props.color).toBe(theme.text);
    expect(check.props.color).not.toBe(theme.success);
  });
});
