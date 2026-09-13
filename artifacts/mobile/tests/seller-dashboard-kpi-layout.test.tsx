import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
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
  },
  Text: nativeComponent('Text'),
  View: nativeComponent('View'),
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: nativeComponent('Feather'),
}));

vi.mock('@/components/BrandthreadUI', () => ({
  PressableScale: nativeComponent('PressableScale'),
}));

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      accent: '#a855f7',
      glassBorder: 'rgba(255,255,255,0.12)',
    },
  }),
}));

import { SellerDashboardKPIGrid } from '@/components/SellerDashboardKPIGrid';
import {
  SELLER_COMPACT_GRID_COLUMN_FRACTION,
  SELLER_COMPACT_GRID_COLUMN_WIDTH,
  SELLER_COMPACT_GRID_GAP,
} from '@/components/sellerCompactGridLayout';

const cards = [
  { label: 'Revenue', value: '$12,345.67', onPress: vi.fn() },
  { label: 'Orders', value: '128', onPress: vi.fn() },
  { label: 'Visitors', value: '4,892' },
  { label: 'Conversion', value: '12.4%' },
];

function flattenStyle(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity) : [style]).filter(Boolean));
}

function textNodes(card: ReactTestInstance) {
  return card.findAll(node => String(node.type) === 'Text');
}

describe('seller dashboard KPI layout', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    renderer?.unmount();
    renderer = null;
  });

  it.each([320, 375, 402])('keeps a true two-column grid at %ipx', async viewportWidth => {
    await act(async () => {
      renderer = create(<SellerDashboardKPIGrid cards={cards} />);
    });

    const grid = renderer!.root.findByProps({ testID: 'seller-kpi-grid' });
    const gridStyle = flattenStyle(grid.props.style);
    expect(gridStyle).toMatchObject({
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: SELLER_COMPACT_GRID_GAP,
    });

    const cardNodes = cards.map(card =>
      renderer!.root.findByProps({ testID: `seller-kpi-${card.label.toLowerCase()}` }),
    );
    const columnWidths = cardNodes.map(card => flattenStyle(card.props.style).width);
    expect(columnWidths).toEqual(cards.map(() => SELLER_COMPACT_GRID_COLUMN_WIDTH));

    const contentWidth = viewportWidth - 32;
    const renderedCardWidth = contentWidth * SELLER_COMPACT_GRID_COLUMN_FRACTION;
    expect(renderedCardWidth * 2 + SELLER_COMPACT_GRID_GAP).toBeLessThanOrEqual(contentWidth);
    expect(renderedCardWidth).toBeGreaterThanOrEqual(138);
  });

  it('keeps labels and values readable at 2x accessibility font scaling', async () => {
    await act(async () => {
      renderer = create(<SellerDashboardKPIGrid cards={cards} />);
    });

    for (const card of cards) {
      const node = renderer!.root.findByProps({ testID: `seller-kpi-${card.label.toLowerCase()}` });
      const [label, value] = textNodes(node);
      expect(label.props.numberOfLines).toBe(2);
      expect(label.props.maxFontSizeMultiplier).toBe(2);
      expect(flattenStyle(label.props.style)).toMatchObject({ lineHeight: 16, minHeight: 32 });
      expect(value.props.numberOfLines).toBe(1);
      expect(value.props.adjustsFontSizeToFit).toBe(true);
      expect(value.props.minimumFontScale).toBe(0.65);
      expect(value.props.maxFontSizeMultiplier).toBe(2);
    }
  });

  it('preserves full-width content for clickable and non-clickable cards', async () => {
    await act(async () => {
      renderer = create(<SellerDashboardKPIGrid cards={cards} />);
    });

    for (const label of ['Revenue', 'Orders']) {
      const card = renderer!.root.findByProps({ testID: `seller-kpi-${label.toLowerCase()}` });
      const wrapper = card.findByType('PressableScale' as React.ElementType);
      expect(flattenStyle(wrapper.props.style)).toMatchObject({ width: '100%', height: '100%', minWidth: 0 });
    }

    for (const label of ['Visitors', 'Conversion']) {
      const card = renderer!.root.findByProps({ testID: `seller-kpi-${label.toLowerCase()}` });
      const wrapper = card.findAllByType('View' as React.ElementType).find(node => flattenStyle(node.props.style).width === '100%');
      expect(wrapper).toBeTruthy();
      expect(flattenStyle(wrapper!.props.style).minWidth).toBe(0);
      expect(flattenStyle(wrapper!.props.style).height).toBe('100%');
    }
  });
});