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

vi.mock('react-native', () => {
  const AnimatedValue = class {
    _value: number;
    constructor(v: number) { this._value = v; }
    interpolate() { return this._value; }
    setValue(v: number) { this._value = v; }
  };
  return {
    StyleSheet: {
      create: (styles: unknown) => styles,
      flatten: (style: unknown) => Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity) : [style]).filter(Boolean)),
    },
    View: nativeComponent('View'),
    Text: nativeComponent('Text'),
    TouchableOpacity: nativeComponent('TouchableOpacity'),
    AccessibilityInfo: { isReduceMotionEnabled: () => Promise.resolve(false) },
    Animated: {
      Value: AnimatedValue,
      View: nativeComponent('AnimatedView'),
      loop: () => ({ start: () => {}, stop: () => {} }),
      sequence: () => ({}),
      timing: () => ({}),
    },
  };
});

vi.mock('@expo/vector-icons', () => {
  function Feather(props: Record<string, unknown>) {
    return React.createElement('Feather', props);
  }
  (Feather as unknown as { glyphMap: Record<string, unknown> }).glyphMap = {};
  return { Feather };
});
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      background: '#0A0A0B', surface: '#111113', card: '#18181B', cardElevated: '#222226',
      border: '#FFFFFF2B', text: '#FAFAFA', muted: '#D7D7DB', accent: '#F7F7FA',
      onAccent: '#0A0A0B', error: '#FFB4B4', success: '#7FF0B0',
    },
  }),
}));

import { OrderProgressTimeline, fmtEstimate, stepIndex } from '@/components/orders/OrderProgressTimeline';

function findAllText(root: ReactTestInstance): string[] {
  return root.findAllByType('Text' as never).map((n) => {
    const children = (n.props as { children?: unknown }).children;
    return Array.isArray(children) ? children.join('') : String(children ?? '');
  });
}

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => { renderer?.unmount(); });
  renderer = undefined;
  vi.clearAllMocks();
});

describe('OrderProgressTimeline', () => {
  it('renders all five happy-path steps for a brand-new order', () => {
    act(() => {
      renderer = create(
        <OrderProgressTimeline status="new" createdAt="2026-01-01T10:00:00Z" />,
      );
    });
    const texts = findAllText(renderer!.root);
    expect(texts).toEqual(expect.arrayContaining(['Order placed', 'Confirmed', 'Shipped', 'Out for delivery', 'Delivered']));
  });

  it('marks the shipped step done and surfaces a tap-to-track chip with carrier + tracking number', () => {
    const onTrackPress = vi.fn();
    act(() => {
      renderer = create(
        <OrderProgressTimeline
          status="shipped"
          createdAt="2026-01-01T10:00:00Z"
          shippedAt="2026-01-02T14:30:00Z"
          trackingStatus="in_transit"
          trackingCarrier="UPS"
          trackingNumber="1Z999AA10123456784"
          onTrackPress={onTrackPress}
        />,
      );
    });
    const texts = findAllText(renderer!.root);
    expect(texts.some((t) => t.includes('UPS') && t.includes('1Z999AA10123456784'))).toBe(true);

    const trackable = renderer!.root.findByProps({ accessibilityLabel: 'Track package with UPS, tracking number 1Z999AA10123456784' });
    act(() => { trackable.props.onPress(); });
    expect(onTrackPress).toHaveBeenCalledTimes(1);
  });

  it('marks out-for-delivery from tracking status even though order.status is still "shipped"', () => {
    act(() => {
      renderer = create(
        <OrderProgressTimeline status="shipped" createdAt="2026-01-01T10:00:00Z" trackingStatus="out_for_delivery" />,
      );
    });
    const texts = findAllText(renderer!.root);
    expect(texts).toContain('In progress');
  });

  it('collapses to a single exception pill for a cancelled order instead of the 5-step list', () => {
    act(() => {
      renderer = create(<OrderProgressTimeline status="cancelled" createdAt="2026-01-01T10:00:00Z" />);
    });
    const texts = findAllText(renderer!.root);
    expect(texts).toContain('Order cancelled');
    expect(texts).not.toContain('Out for delivery');
  });

  it('item 107: placed → confirmed → shipped → out for delivery → delivered, current step selected', () => {
    expect(stepIndex('new', undefined)).toBe(0);
    expect(stepIndex('new', undefined, '2026-01-01T10:02:00Z')).toBe(1);
    expect(stepIndex('processing', undefined)).toBe(1);
    expect(stepIndex('shipped', 'in_transit')).toBe(2);
    expect(stepIndex('shipped', 'out_for_delivery')).toBe(3);
    expect(stepIndex('delivered', 'delivered')).toBe(4);

    act(() => {
      renderer = create(
        <OrderProgressTimeline
          status="shipped" createdAt="2026-01-01T10:00:00Z" paidAt="2026-01-01T10:02:00Z"
          shippedAt="2026-01-02T14:30:00Z" trackingStatus="in_transit" estimatedDelivery="2026-01-06"
        />,
      );
    });
    const selected = renderer!.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityState?.selected === true);
    expect(selected.map((n) => n.props.testID)).toEqual(['order-step-shipped']);
    const texts = findAllText(renderer!.root);
    // Confirmed carries the real payment time; Delivered carries the carrier estimate.
    expect(texts.filter((t) => /, \d{1,2}:\d{2}/.test(t))).toHaveLength(3);
    expect(texts).toContain('Est. Jan 6');
  });

  it('item 107: a delivered order shows no estimate and marks Delivered as the current step', () => {
    act(() => {
      renderer = create(
        <OrderProgressTimeline status="delivered" createdAt="2026-01-01T10:00:00Z" trackingStatus="delivered" estimatedDelivery="2026-01-06" />,
      );
    });
    const selected = renderer!.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityState?.selected === true);
    expect(selected.map((n) => n.props.testID)).toEqual(['order-step-delivered']);
    expect(findAllText(renderer!.root)).not.toContain('Est. Jan 6');
  });

  it('item 107: done steps use the text colour, never the (theme-tinted) accent', () => {
    act(() => {
      renderer = create(<OrderProgressTimeline status="shipped" createdAt="2026-01-01T10:00:00Z" trackingStatus="in_transit" />);
    });
    const colors = JSON.stringify(renderer!.toJSON());
    expect(colors).toContain('#FAFAFA');
    expect(colors).not.toContain('#F7F7FA');
  });

  it('fmtEstimate reads a YYYY-MM-DD as a calendar date (no timezone shift)', () => {
    expect(fmtEstimate('2026-08-20')).toBe('Est. Aug 20');
    expect(fmtEstimate(undefined)).toBe('');
    expect(fmtEstimate('not a date')).toBe('');
  });

  it('collapses to an exception pill when the carrier reports a delivery exception, even if order.status is still "shipped"', () => {
    act(() => {
      renderer = create(
        <OrderProgressTimeline status="shipped" createdAt="2026-01-01T10:00:00Z" trackingStatus="exception" />,
      );
    });
    const texts = findAllText(renderer!.root);
    expect(texts).toContain('Delivery problem');
  });
});
