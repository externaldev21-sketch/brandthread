import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('@/components/ui/Snackbar', () => ({ Snackbar: nativeComponent('Snackbar') }));
vi.mock('@/lib/devPreview', () => ({ isPreviewDemoMode: () => false }));

const { waitlist, auth, prefs, goToSignIn } = vi.hoisted(() => ({
  waitlist: {
    join: vi.fn(async () => ({ joined: true })),
    leave: vi.fn(async () => ({ left: true })),
    check: vi.fn(async () => ({ joined: false })),
  },
  auth: { isSignedIn: true },
  prefs: { value: { sizes: {} as Record<string, string> }, status: 'loaded' as string },
  goToSignIn: vi.fn(),
}));
vi.mock('@/hooks/useApi', () => ({ useApi: () => ({ waitlist }) }));
vi.mock('@/hooks/useSignInGate', () => ({ useSignInGate: () => ({ isSignedIn: auth.isSignedIn, goToSignIn, requireSignIn: () => auth.isSignedIn }) }));
vi.mock('@/hooks/useBuyerPreferences', () => ({ useBuyerPreferences: () => ({ preferences: prefs.value, status: prefs.status }) }));
vi.mock('@/components/SizeRecommendationBadge', async () => {
  const { buildSizeBadgeModel } = await import('@/lib/sizeBadge');
  return {
    DEMO_PREFERENCES: { sizes: {} },
    useSizeBadgeModel: (product: unknown) => buildSizeBadgeModel(product as never, prefs.value),
  };
});

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

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const chips = (tree: ReactTestRenderer) => tree.root.findAllByType('Chip' as never);
function render(p: BuyerProduct = product) {
  let tree!: ReactTestRenderer;
  act(() => { tree = create(<VariantPickerSheet productId="p1" initialProduct={p} onClose={vi.fn()} onConfirm={vi.fn()} />); });
  return tree;
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.isSignedIn = true;
  prefs.value = { sizes: {} };
  prefs.status = 'loaded';
});

describe('VariantPickerSheet size chips', () => {
  it('uses the shared Chip; sold-out sizes (from variant stock) keep the disabled, struck look and carry "Notify me"', async () => {
    const tree = render();
    await flush();
    const all = chips(tree);
    expect(all.map(c => c.props.label)).toEqual(['S', 'M', 'L']);
    const m = all[1];
    expect(m.props.disabled).toBe(true);
    expect(m.props.pressableWhenDisabled).toBe(true);
    expect(m.props.strikethrough).toBe(true);
    expect(m.props.icon).toBe('slash');
    expect(m.props.trailingLabel).toBe('Notify me');
    expect(m.props.accessibilityLabel).toBe('Size, M, sold out. Notify me');
    expect(m.props.accessibilityHint).toBe('Sets a restock reminder');
    for (const inStock of [all[0], all[2]]) {
      expect(inStock.props.disabled).toBe(false);
      expect(inStock.props.strikethrough).toBe(false);
      expect(inStock.props.icon).toBeUndefined();
      expect(inStock.props.trailingLabel).toBeUndefined();
      expect(inStock.props.accessibilityRole).toBe('radio');
    }
  });

  it('selecting an in-stock size marks it selected; tapping a sold-out size sets a reminder without selecting it', async () => {
    const tree = render();
    await flush();
    expect(waitlist.check).toHaveBeenCalledWith('v_m');
    await act(async () => { chips(tree)[1].props.onPress(); });
    await flush();
    expect(waitlist.join).toHaveBeenCalledWith('p1', 'v_m');
    expect(chips(tree).some(c => c.props.selected)).toBe(false);
    expect(chips(tree)[1].props.trailingLabel).toBe('Reminder set');
    expect(tree.root.findByType('Snackbar' as never).props).toMatchObject({ visible: true, message: 'Reminder set' });

    act(() => chips(tree)[2].props.onPress());
    expect(chips(tree)[2].props.selected).toBe(true);
  });

  it('tapping "Reminder set" removes the reminder', async () => {
    waitlist.check.mockImplementation(async () => ({ joined: true }));
    const tree = render();
    await flush();
    expect(chips(tree)[1].props.trailingLabel).toBe('Reminder set');
    await act(async () => { chips(tree)[1].props.onPress(); });
    await flush();
    expect(waitlist.leave).toHaveBeenCalledWith('p1', 'v_m');
    expect(chips(tree)[1].props.trailingLabel).toBe('Notify me');
    expect(tree.root.findByType('Snackbar' as never).props.message).toBe('Reminder removed');
    waitlist.check.mockImplementation(async () => ({ joined: false }));
  });

  it('signed out: Notify me goes to sign-in and never calls the waitlist API', async () => {
    auth.isSignedIn = false;
    const tree = render();
    await flush();
    expect(waitlist.check).not.toHaveBeenCalled();
    await act(async () => { chips(tree)[1].props.onPress(); });
    expect(goToSignIn).toHaveBeenCalled();
    expect(waitlist.join).not.toHaveBeenCalled();
  });

  it("preselects the buyer's saved size when it is in stock", async () => {
    prefs.value = { sizes: { outerwear: 'L' } };
    const tree = render();
    await flush();
    expect(chips(tree).find(c => c.props.selected)?.props.label).toBe('L');
  });

  it('does not preselect a sold-out saved size (it shows Notify me instead)', async () => {
    prefs.value = { sizes: { outerwear: 'M' } };
    const tree = render();
    await flush();
    expect(chips(tree).some(c => c.props.selected)).toBe(false);
    expect(chips(tree)[1].props.trailingLabel).toBe('Notify me');
  });
});
