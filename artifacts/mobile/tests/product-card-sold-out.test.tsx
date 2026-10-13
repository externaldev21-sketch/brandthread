/**
 * The Rack card stock states (S5 #122, #123): in-stock reads "N left";
 * sold out dims the image and the chip becomes the Restock action.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { Product } from '@/services/productTypes';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => {
  const React = require('react') as typeof import('react');
  const n = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
  return { View: n('View'), Text: n('Text'), StyleSheet: { create: (s: unknown) => s, absoluteFill: {} } };
});
vi.mock('react-native-gesture-handler', () => {
  const React = require('react') as typeof import('react');
  return { Swipeable: React.forwardRef((props: { children?: React.ReactNode }, _ref) => React.createElement('Swipeable', null, props.children)) };
});
vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
vi.mock('expo-haptics', () => ({ impactAsync: vi.fn(), notificationAsync: vi.fn(), ImpactFeedbackStyle: {}, NotificationFeedbackType: {} }));
vi.mock('@/components/CachedImage', () => ({ CachedImage: () => null }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { background: '#000', card: '#111', border: '#333', text: '#fff', muted: '#aaa', subtle: '#777', success: '#0f0', warning: '#f90', error: '#f00', accent: '#ccc', secondary: '#ccc', accentLight: '#fff', accentDim: '#333', secondaryDim: '#333' } }),
}));
vi.mock('@/lib/money', () => ({ formatCents: (c: number) => `$${(c / 100).toFixed(2)}`, integerPercent: () => 0 }));
vi.mock('@/lib/theme', () => ({
  FONT: { regular: 'S', medium: 'S', semibold: 'S', bold: 'S' }, FS: { xs: 11, sm: 13 },
  SP: { xs: 4, sm: 8, md: 16 }, RADIUS: { xs: 6, md: 14, pill: 999 }, ICON: { sm: 16, md: 20 },
}));
vi.mock('@/components/BrandthreadUI', () => {
  const React = require('react') as typeof import('react');
  return {
    PressableScale: (p: Record<string, unknown>) => React.createElement('Pressable', p, p.children as React.ReactNode),
    StatusBadge: () => null,
  };
});

import { ProductCard } from '@/components/products/ProductCard';

const product = (totalStock: number, status = 'active') => ({
  id: `p${totalStock}`, name: 'Linen Tee', status, category: 'T-shirt', media: [], variants: [],
  inventory: { totalStock, lowStockThreshold: 5 }, pricing: { priceCents: 4500, compareAtPriceCents: null },
}) as unknown as Product;

function render(p: Product, onEditStock = vi.fn()) {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(React.createElement(ProductCard, {
      product: p, width: 180, onPress: vi.fn(), onMore: vi.fn(), onQuickArchive: vi.fn(), onQuickDelete: vi.fn(), onEditStock,
    }));
  });
  return r;
}
const text = (r: ReactTestRenderer) => JSON.stringify(r.toJSON());
const dimmed = (r: ReactTestRenderer) => r.root.findAll((n) => typeof n.type === 'string' && (n.props as { style?: { opacity?: number } }).style?.opacity === 0.4).length;

describe('ProductCard stock states', () => {
  it('keeps healthy cards uncluttered and labels low-stock products, undimmed', () => {
    expect(text(render(product(12)))).not.toContain('product-card-restock');
    expect(text(render(product(3)))).toContain('3 left');
    expect(dimmed(render(product(12)))).toBe(0);
  });

  it('dims a sold-out card and turns the chip into Restock', () => {
    const onEditStock = vi.fn();
    const r = render(product(0), onEditStock);
    expect(dimmed(r)).toBe(1);
    const chip = r.root.find((n) => typeof n.type === 'string' && (n.props as { testID?: string }).testID === 'product-card-restock');
    expect(chip.props.accessibilityLabel).toBe('Restock Linen Tee, sold out');
    expect(text(r)).toContain('Sold out · Restock');
    act(() => (chip.props.onPress as () => void)());
    expect(onEditStock).toHaveBeenCalledTimes(1);
  });

  it('leaves archived sold-out cards as they were', () => {
    const r = render(product(0, 'archived'));
    expect(dimmed(r)).toBe(0);
    expect(text(r)).toContain('Sold out');
  });
});
