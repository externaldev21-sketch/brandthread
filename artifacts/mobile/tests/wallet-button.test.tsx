import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { nativeComponent, platform } = vi.hoisted(() => ({
  nativeComponent: (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  },
  platform: { OS: 'ios' as string },
}));

vi.mock('react-native', () => ({
  View: nativeComponent('View'),
  Text: nativeComponent('Text'),
  ActivityIndicator: nativeComponent('ActivityIndicator'),
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Platform: {
    get OS() { return platform.OS; },
    select: (spec: Record<string, unknown>) => spec[platform.OS] ?? spec.default,
  },
}));
vi.mock('@expo/vector-icons', () => ({ Feather: nativeComponent('Feather'), Ionicons: nativeComponent('Ionicons') }));
vi.mock('@/components/BrandthreadUI', () => ({ PressableScale: nativeComponent('PressableScale') }));
vi.mock('@/contexts/AppThemeContext', () => ({
  // A colored theme: the wallet button must not pick any of this up.
  useAppTheme: () => ({ theme: { text: '#FAFAFA', background: '#281235', subtle: '#999', muted: '#aaa', border: '#333' } }),
}));
vi.mock('@/components/checkout/CheckoutPrimitives', () => ({
  // Mirrors the colored theme mocked above (useAppTheme): the wallet button
  // must not pick any of it up, so this stands in for useCheckoutColors().
  useCheckoutColors: () => ({ text: '#FAFAFA', bg: '#281235', muted: '#aaa', subtle: '#999', divider: '#333', fieldBorder: '#333', fieldFocus: '#FAFAFA' }),
  CheckoutSection: nativeComponent('CheckoutSection'),
  OptionRow: nativeComponent('OptionRow'),
}));
vi.mock('@/components/checkout/StripePayment', () => ({ CardEntry: nativeComponent('CardEntry') }));

import { HostedExpressButton, detectWebApplePay } from '@/components/checkout/PaymentSection';

function render() {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<HostedExpressButton onPress={vi.fn()} disabled={false} loading={false} />);
  });
  return tree;
}
const button = (tree: ReactTestRenderer) => tree.root.findByProps({ testID: 'checkout-express-pay' });
const texts = (tree: ReactTestRenderer) => button(tree).findAllByType('Text' as never);
const icons = (tree: ReactTestRenderer) => button(tree).findAll((n) => (n.type as unknown) === 'Ionicons' || (n.type as unknown) === 'Feather').map((n) => n.props.name);
const flatten = (style: unknown): Record<string, unknown> => (Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : ((style as Record<string, unknown>) ?? {}));

describe('express wallet button', () => {
  beforeEach(() => {
    platform.OS = 'ios';
    delete (globalThis as { window?: unknown }).window;
  });

  it('iOS: white pill, black "Buy with  Pay" in the system font — never theme colors', () => {
    const tree = render();
    expect(flatten(button(tree).props.style)).toMatchObject({ backgroundColor: '#FFFFFF', height: 50 });
    expect(button(tree).props.accessibilityLabel).toBe('Buy with Apple Pay');
    expect(texts(tree).map((t) => t.props.children)).toEqual(['Buy with', 'Pay']);
    for (const t of texts(tree)) expect(flatten(t.props.style)).toMatchObject({ color: '#000000', fontFamily: 'System' });
    expect(icons(tree)).toEqual(['logo-apple']);
    expect(button(tree).findAll((n) => (n.type as unknown) === 'Ionicons')[0].props.color).toBe('#000000');
  });

  it('Android: "Buy with G Pay", same white/black treatment', () => {
    platform.OS = 'android';
    const tree = render();
    expect(button(tree).props.accessibilityLabel).toBe('Buy with Google Pay');
    expect(icons(tree)).toEqual(['logo-google']);
    // (The typeface is picked once per platform at module load via Platform.select.)
    for (const t of texts(tree)) expect(flatten(t.props.style)).toMatchObject({ color: '#000000' });
  });

  it('web without Apple Pay: neutral, unbranded "Express checkout"', () => {
    platform.OS = 'web';
    const tree = render();
    expect(button(tree).props.accessibilityLabel).toBe('Express checkout');
    expect(icons(tree)).toEqual(['zap']);
    expect(texts(tree).map((t) => t.props.children)).toEqual(['Express checkout']);
  });

  it('web in Safari with Apple Pay available: the Apple Pay button', () => {
    platform.OS = 'web';
    (globalThis as { window?: unknown }).window = { ApplePaySession: { canMakePayments: () => true } };
    const tree = render();
    expect(button(tree).props.accessibilityLabel).toBe('Buy with Apple Pay');
    expect(icons(tree)).toEqual(['logo-apple']);
  });

  it('detectWebApplePay is false without ApplePaySession, when it says no, or when it throws', () => {
    expect(detectWebApplePay(undefined)).toBe(false);
    expect(detectWebApplePay({})).toBe(false);
    expect(detectWebApplePay({ ApplePaySession: { canMakePayments: () => false } })).toBe(false);
    expect(detectWebApplePay({ ApplePaySession: { canMakePayments: () => { throw new Error('insecure'); } } })).toBe(false);
    expect(detectWebApplePay({ ApplePaySession: { canMakePayments: () => true } })).toBe(true);
  });
});
