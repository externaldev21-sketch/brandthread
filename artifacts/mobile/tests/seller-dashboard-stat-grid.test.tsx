import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { nativeComponent } = vi.hoisted(() => ({
  nativeComponent: (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  },
}));

vi.mock('react-native', () => ({
  StyleSheet: {
    create: (styles: unknown) => styles,
    flatten: (style: unknown) => Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity) : [style]).filter(Boolean)),
    hairlineWidth: 1,
  },
  Text: nativeComponent('Text'),
  TouchableOpacity: nativeComponent('TouchableOpacity'),
  View: nativeComponent('View'),
}));

import { SellerDashboardStatGrid, type SellerDashboardStatTileData } from '@/components/SellerDashboardStatGrid';

const theme = {
  text: '#F7F7FA',
  muted: 'rgba(247,247,250,0.58)',
  accent: '#F7F7FA',
  success: '#10B981',
  error: '#F87171',
  card: '#18181B',
  borderSubtle: 'rgba(255,255,255,0.04)',
} as any;

const tiles: SellerDashboardStatTileData[] = [
  { key: 'orders', label: 'Orders', value: '128', deltaLabel: '+12%', deltaDirection: 'up' },
  { key: 'visitors', label: 'Visitors', value: '4.9K', deltaLabel: '-3%', deltaDirection: 'down' },
  { key: 'conversion', label: 'Conversion rate', value: '2.6%', deltaLabel: '—', deltaDirection: 'flat' },
  { key: 'aov', label: 'Avg order value', value: '$34.20', deltaLabel: 'New', deltaDirection: 'up' },
];

function flattenStyle(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity) : [style]).filter(Boolean));
}

describe('seller dashboard stat grid', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    renderer?.unmount();
    renderer = null;
  });

  it('renders a two-column grid with one tile per real metric', async () => {
    await act(async () => {
      renderer = create(
        <SellerDashboardStatGrid tiles={tiles} activeKey="orders" onSelect={vi.fn()} theme={theme} />,
      );
    });

    const grid = renderer!.root.findByProps({ testID: 'seller-dashboard-stat-grid' });
    expect(flattenStyle(grid.props.style)).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' });

    for (const tile of tiles) {
      const node = renderer!.root.findByProps({ testID: `seller-dashboard-stat-tile-${tile.key}` });
      expect(flattenStyle(node.props.style)).toMatchObject({ flexBasis: '48%' });
    }
  });

  it('never truncates a big number — values auto-shrink instead', async () => {
    await act(async () => {
      renderer = create(
        <SellerDashboardStatGrid tiles={tiles} activeKey="orders" onSelect={vi.fn()} theme={theme} />,
      );
    });

    for (const tile of tiles) {
      const node = renderer!.root.findByProps({ testID: `seller-dashboard-stat-tile-${tile.key}` });
      const valueText = node.findAllByType('Text' as React.ElementType).find((t) => t.props.children === tile.value)!;
      expect(valueText.props.numberOfLines).toBe(1);
      expect(valueText.props.adjustsFontSizeToFit).toBe(true);
      expect(valueText.props.minimumFontScale).toBeGreaterThan(0);
    }
  });

  it('marks the active tile as selected and calls onSelect with its key when tapped', async () => {
    const onSelect = vi.fn();
    await act(async () => {
      renderer = create(
        <SellerDashboardStatGrid tiles={tiles} activeKey="orders" onSelect={onSelect} theme={theme} />,
      );
    });

    const activeTile = renderer!.root.findByProps({ testID: 'seller-dashboard-stat-tile-orders' });
    expect(activeTile.props.accessibilityState).toMatchObject({ selected: true });

    const otherTile = renderer!.root.findByProps({ testID: 'seller-dashboard-stat-tile-aov' });
    expect(otherTile.props.accessibilityState).toMatchObject({ selected: false });

    await act(async () => {
      otherTile.props.onPress();
    });
    expect(onSelect).toHaveBeenCalledWith('aov');
  });

  it('colors deltas by direction: success for up, error for down, muted for flat', async () => {
    await act(async () => {
      renderer = create(
        <SellerDashboardStatGrid tiles={tiles} activeKey="orders" onSelect={vi.fn()} theme={theme} />,
      );
    });

    const up = renderer!.root.findByProps({ testID: 'seller-dashboard-stat-tile-orders' });
    const upDelta = up.findAllByType('Text' as React.ElementType).find((t) => t.props.children === '+12%')!;
    expect(flattenStyle(upDelta.props.style).color).toBe(theme.success);

    const down = renderer!.root.findByProps({ testID: 'seller-dashboard-stat-tile-visitors' });
    const downDelta = down.findAllByType('Text' as React.ElementType).find((t) => t.props.children === '-3%')!;
    expect(flattenStyle(downDelta.props.style).color).toBe(theme.error);

    const flat = renderer!.root.findByProps({ testID: 'seller-dashboard-stat-tile-conversion' });
    const flatDelta = flat.findAllByType('Text' as React.ElementType).find((t) => t.props.children === '—')!;
    expect(flattenStyle(flatDelta.props.style).color).toBe(theme.muted);
  });
});
