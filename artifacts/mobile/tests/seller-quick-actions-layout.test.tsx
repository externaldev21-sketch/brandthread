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
  View: nativeComponent('View'),
}));

vi.mock('@expo/vector-icons', () => ({ Feather: { glyphMap: {} } }));
vi.mock('@/components/BrandthreadUI', () => ({
  QuickActionCard: ({ label, badge, style }: { label: string; badge?: boolean; style?: unknown }) =>
    React.createElement(
      'PressableScale',
      { style, testID: `quick-action-card-${label.toLowerCase().replace(/\s+/g, '-')}` },
      React.createElement('Text', {
        numberOfLines: 1,
        adjustsFontSizeToFit: true,
        minimumFontScale: 0.9,
      }, label),
      badge ? React.createElement('View', { testID: `quick-action-badge-${label.toLowerCase().replace(/\s+/g, '-')}` }) : null,
    ),
}));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      background: '#0A0A0B',
      surface: '#111113',
      card: '#18181B',
      cardElevated: '#222226',
      border: '#FFFFFF2B',
      borderSubtle: '#FFFFFF1A',
      text: '#FAFAFA',
      muted: '#D7D7DB',
      subtle: '#C5C5CA',
      accent: '#F7F7FA',
      accentLight: '#FFFFFF',
      accentDim: '#FFFFFF2E',
      onAccent: '#0A0A0B',
      secondary: '#F7F7FA',
      secondaryDim: '#FFFFFF24',
      success: '#7FF0B0',
      warning: '#FFD580',
      error: '#FFB4B4',
    },
  }),
}));

import { SellerQuickActionsGrid } from '@/components/SellerQuickActionsGrid';
import {
  SELLER_COMPACT_GRID_COLUMN_FRACTION,
  SELLER_COMPACT_GRID_COLUMN_WIDTH,
  SELLER_COMPACT_GRID_GAP,
} from '@/components/sellerCompactGridLayout';

const actions = [
  { label: 'Create Post', icon: 'video' as const, accent: '#a855f7', badge: true, onPress: vi.fn() },
  { label: 'Add Product', icon: 'plus-circle' as const, accent: '#22d3ee', onPress: vi.fn() },
  { label: 'View Orders', icon: 'shopping-bag' as const, accent: '#3b82f6', onPress: vi.fn() },
  { label: 'Studio', icon: 'zap' as const, accent: '#f59e0b', onPress: vi.fn() },
];

function flattenStyle(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity) : [style]).filter(Boolean));
}

function textNode(card: ReactTestInstance) {
  return card.findByType('Text' as React.ElementType);
}

describe('seller Quick Actions compact layout', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    renderer?.unmount();
    renderer = null;
  });

  it.each([320, 375, 402])('keeps all four actions in a true two-column grid at %ipx', async viewportWidth => {
    await act(async () => {
      renderer = create(<SellerQuickActionsGrid actions={actions} />);
    });

    const grid = renderer!.root.findByProps({ testID: 'seller-quick-actions-grid' });
    expect(flattenStyle(grid.props.style)).toMatchObject({
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: SELLER_COMPACT_GRID_GAP,
    });

    const columns = actions.map(action =>
      renderer!.root.findByProps({ testID: `seller-quick-action-${action.label.toLowerCase().replace(/\s+/g, '-')}` }),
    );
    expect(columns.map(column => flattenStyle(column.props.style).width)).toEqual(
      actions.map(() => SELLER_COMPACT_GRID_COLUMN_WIDTH),
    );
    expect(columns.every(column => flattenStyle(column.props.style).minWidth === 0)).toBe(true);

    const contentWidth = viewportWidth - 32;
    const renderedCardWidth = contentWidth * SELLER_COMPACT_GRID_COLUMN_FRACTION;
    expect(renderedCardWidth * 2 + SELLER_COMPACT_GRID_GAP).toBeLessThanOrEqual(contentWidth);
    expect(renderedCardWidth).toBeGreaterThanOrEqual(138);
  });

  it.each([1.3, 1.6, 2])('keeps labels horizontal and card geometry unchanged at font scale %s', async fontScale => {
    await act(async () => {
      renderer = create(<SellerQuickActionsGrid actions={actions} />);
    });

    for (const action of actions) {
      const column = renderer!.root.findByProps({ testID: `seller-quick-action-${action.label.toLowerCase().replace(/\s+/g, '-')}` });
      const card = renderer!.root.findByProps({ testID: `quick-action-card-${action.label.toLowerCase().replace(/\s+/g, '-')}` });
      const label = textNode(card);

      expect(flattenStyle(column.props.style)).toMatchObject({
        width: SELLER_COMPACT_GRID_COLUMN_WIDTH,
        minWidth: 0,
      });
      expect(flattenStyle(card.props.style)).toMatchObject({ width: '100%', minWidth: 0 });
      expect(label.props).toMatchObject({
        numberOfLines: 1,
        adjustsFontSizeToFit: true,
        minimumFontScale: 0.9,
      });
      expect(label.props.maxFontSizeMultiplier).toBeUndefined();

      const narrowestCardWidth = (320 - 32) * SELLER_COMPACT_GRID_COLUMN_FRACTION;
      const horizontalPadding = 8;
      const estimatedLabelWidth = action.label.length * 12 * fontScale * 0.49 * label.props.minimumFontScale;
      expect(estimatedLabelWidth).toBeLessThanOrEqual(narrowestCardWidth - horizontalPadding);
    }
  });

  it('renders the Create Post badge without changing its column geometry', async () => {
    await act(async () => {
      renderer = create(<SellerQuickActionsGrid actions={actions} />);
    });

    expect(renderer!.root.findAllByProps({ testID: 'quick-action-badge-create-post' })).toHaveLength(1);
    expect(renderer!.root.findAll(node =>
      typeof node.props.testID === 'string' && node.props.testID.startsWith('quick-action-badge-'),
    )).toHaveLength(1);

    const badgeColumn = renderer!.root.findByProps({ testID: 'seller-quick-action-create-post' });
    const nonBadgeColumns = actions.slice(1).map(action =>
      renderer!.root.findByProps({ testID: `seller-quick-action-${action.label.toLowerCase().replace(/\s+/g, '-')}` }),
    );
    expect(nonBadgeColumns.map(column => flattenStyle(column.props.style)))
      .toEqual(nonBadgeColumns.map(() => flattenStyle(badgeColumn.props.style)));
  });
});
