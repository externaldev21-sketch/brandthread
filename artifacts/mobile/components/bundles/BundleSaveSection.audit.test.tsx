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
  View: nativeComponent('View'),
  Text: nativeComponent('Text'),
  ScrollView: nativeComponent('ScrollView'),
  TouchableOpacity: nativeComponent('TouchableOpacity'),
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
}));
vi.mock('@/components/ui/Icon', () => ({ Icon: nativeComponent('Icon') }));
vi.mock('@/components/CachedImage', () => ({ CachedImage: nativeComponent('CachedImage') }));
vi.mock('@/components/ui', () => ({ Button: nativeComponent('Button') }));
vi.mock('@/contexts/AppThemeContext', () => ({ useAppTheme: () => ({ theme: { text: '#fff', muted: '#999', subtle: '#777', border: '#333', card: '#111', cardElevated: '#222', background: '#000' } }) }));
vi.mock('@/lib/api', () => ({ useApi: () => ({}) }));
vi.mock('@/lib/previewProducts', () => ({ isPreviewProductId: () => false }));
vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(), notificationAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: 'light' }, NotificationFeedbackType: { Success: 'success' },
}));
const { addBundleToCart } = vi.hoisted(() => ({ addBundleToCart: vi.fn() }));
vi.mock('@/services/cartService', () => ({ addBundleToCart }));

import { BundleOfferCard } from './BundleSaveSection';

const bundle = {
  id: 'b1', name: 'Weekend set', bundlePriceCents: 9000, itemsTotalCents: 12000, savingsCents: 3000, needsSelection: false,
  items: [{ id: 'i1', productName: 'Tee', image: null, quantity: 1 }],
} as never;

afterEach(() => { vi.useRealTimers(); });

describe('BundleOfferCard "Added to bag" timer (audit)', () => {
  it('reverts to idle after the beat while mounted', async () => {
    vi.useFakeTimers();
    addBundleToCart.mockResolvedValue({ success: true });
    let tree!: ReactTestRenderer;
    act(() => { tree = create(<BundleOfferCard bundle={bundle} />); });
    await act(async () => { tree.root.findByType('Button' as never).props.onPress(); });
    expect(tree.root.findByType('Button' as never).props.label).toBe('Added to bag');
    await act(async () => { vi.advanceTimersByTime(2200); });
    expect(tree.root.findByType('Button' as never).props.label).toBe('Add bundle');
  });

  it('leaves no pending timer behind once the card unmounts', async () => {
    vi.useFakeTimers();
    addBundleToCart.mockResolvedValue({ success: true });
    let tree!: ReactTestRenderer;
    act(() => { tree = create(<BundleOfferCard bundle={bundle} />); });
    await act(async () => { tree.root.findByType('Button' as never).props.onPress(); });
    expect(vi.getTimerCount()).toBe(1);
    act(() => { tree.unmount(); });
    expect(vi.getTimerCount()).toBe(0);
  });
});
