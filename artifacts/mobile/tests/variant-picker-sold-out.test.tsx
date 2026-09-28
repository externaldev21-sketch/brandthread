import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

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
  View: nativeComponent('View'),
  Text: nativeComponent('Text'),
  ScrollView: nativeComponent('ScrollView'),
  Modal: nativeComponent('Modal'),
  TouchableOpacity: nativeComponent('TouchableOpacity'),
  TouchableWithoutFeedback: nativeComponent('TouchableWithoutFeedback'),
  ActivityIndicator: nativeComponent('ActivityIndicator'),
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('@expo/vector-icons', () => ({ Feather: nativeComponent('Feather') }));
vi.mock('expo-haptics', () => ({
  selectionAsync: vi.fn(async () => {}), impactAsync: vi.fn(async () => {}), notificationAsync: vi.fn(async () => {}),
  ImpactFeedbackStyle: { Medium: 'medium' }, NotificationFeedbackType: { Warning: 'warning' },
}));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { text: '#fff', subtle: '#999', accent: '#fff', onAccent: '#000', border: '#333', surface: '#111', card: '#18181b', cardElevated: '#18181b', accentLight: '#fff', warning: '#fc0', error: '#f88' } }),
}));
vi.mock('@/components/CachedImage', () => ({ CachedImage: nativeComponent('CachedImage') }));
vi.mock('@/components/ui/ErrorState', () => ({ ErrorState: nativeComponent('ErrorState') }));
vi.mock('@/components/ui/QuantityStepper', () => ({ QuantityStepper: nativeComponent('QuantityStepper') }));
vi.mock('@/components/ui/Chip', () => ({ Chip: nativeComponent('Chip') }));
vi.mock('@/services/cartService', () => ({ getBuyerProduct: vi.fn() }));

import { VariantPickerSheet } from '@/components/buy-now/VariantPickerSheet';
import type { BuyerProduct } from '@/services/cartTypes';

// Stock comes from the product's variants (adaptApiProduct maps stock → isAvailable).
const product: BuyerProduct = {
  id: 'p1', sellerId: 's1', sellerName: 'Northline', sellerHandle: 'northline', name: 'Field Shell Jacket', description: '',
  priceCents: 22000, imageUris: [], category: 'Outerwear', isPreOrder: false, cancellationPolicy: '', refundPolicy: '',
  isActive: true, tags: [],
  options: [{ id: 'opt_size', name: 'Size', values: ['S', 'M', 'L'].map(size => ({ id: `size_${size}`, label: size })) }],
  variants: [
    { id: 'v_s', title: 'S', optionValues: [{ optionId: 'opt_size', valueId: 'size_S' }], priceCents: 22000, inventoryQuantity: 4, isAvailable: true },
    { id: 'v_m', title: 'M', optionValues: [{ optionId: 'opt_size', valueId: 'size_M' }], priceCents: 22000, inventoryQuantity: 0, isAvailable: false },
    { id: 'v_l', title: 'L', optionValues: [{ optionId: 'opt_size', valueId: 'size_L' }], priceCents: 22000, inventoryQuantity: 2, isAvailable: true },
  ],
};

describe('VariantPickerSheet size chips', () => {
  it('uses the shared Chip; sold-out sizes (from variant stock) are disabled, struck and announced', () => {
    let tree!: ReactTestRenderer;
    act(() => { tree = create(<VariantPickerSheet productId="p1" initialProduct={product} onClose={vi.fn()} onConfirm={vi.fn()} />); });
    const chips = tree.root.findAllByType('Chip' as never);
    expect(chips.map(c => c.props.label)).toEqual(['S', 'M', 'L']);
    const m = chips[1];
    expect(m.props.disabled).toBe(true);
    expect(m.props.strikethrough).toBe(true);
    expect(m.props.icon).toBe('slash');
    expect(m.props.accessibilityLabel).toBe('Size, M, sold out');
    expect(m.props.accessibilityRole).toBe('radio');
    for (const inStock of [chips[0], chips[2]]) {
      expect(inStock.props.disabled).toBe(false);
      expect(inStock.props.strikethrough).toBe(false);
      expect(inStock.props.icon).toBeUndefined();
    }
  });

  it('selecting an in-stock size marks it selected; a sold-out size ignores taps', () => {
    let tree!: ReactTestRenderer;
    act(() => { tree = create(<VariantPickerSheet productId="p1" initialProduct={product} onClose={vi.fn()} onConfirm={vi.fn()} />); });
    act(() => tree.root.findAllByType('Chip' as never)[1].props.onPress());
    expect(tree.root.findAllByType('Chip' as never).some(c => c.props.selected)).toBe(false);
    act(() => tree.root.findAllByType('Chip' as never)[2].props.onPress());
    expect(tree.root.findAllByType('Chip' as never)[2].props.selected).toBe(true);
  });
});
