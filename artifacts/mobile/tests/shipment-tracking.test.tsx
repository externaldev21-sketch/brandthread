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
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
}));
vi.mock('react-native-svg', () => ({
  default: nativeComponent('Svg'),
  Circle: nativeComponent('Circle'),
  Line: nativeComponent('Line'),
  Path: nativeComponent('Path'),
}));
vi.mock('@expo/vector-icons', () => ({ Feather: nativeComponent('Feather') }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { text: '#FAFAFA', muted: '#999', border: '#333', background: '#000', cardElevated: '#111', accent: '#FF7B82' } }),
}));

import {
  ShipmentHeadline, ShipmentMapPlaceholder, routeProgress, trackingHeadline, type ShipmentInfo,
} from '@/components/orders/ShipmentTracking';

const NOW = new Date(2026, 8, 28, 13, 0); // Mon Sep 28 2026, local
const base: ShipmentInfo = {
  status: 'shipped', trackingStatus: 'in_transit', trackingCarrier: 'UPS',
  estimatedDelivery: '2026-09-30', sellerName: 'Atelier Noire', destinationCity: 'New York', destinationState: 'NY',
};

describe('trackingHeadline', () => {
  it('in transit with an estimate → "Arriving by <day>" + carrier', () => {
    expect(trackingHeadline(base, NOW)).toEqual({ title: 'Arriving by Wed, Sep 30', subtitle: 'In transit with UPS' });
  });
  it('today / tomorrow / late estimates', () => {
    expect(trackingHeadline({ ...base, estimatedDelivery: '2026-09-28' }, NOW)?.title).toBe('Arriving today');
    expect(trackingHeadline({ ...base, estimatedDelivery: '2026-09-29' }, NOW)?.title).toBe('Arriving tomorrow');
    expect(trackingHeadline({ ...base, estimatedDelivery: '2026-09-25' }, NOW)?.title).toBe('Expected Fri, Sep 25');
    // Full ISO timestamps (preview data) are read as their local date.
    expect(trackingHeadline({ ...base, estimatedDelivery: new Date(2026, 8, 30, 15).toISOString() }, NOW)?.title).toBe('Arriving by Wed, Sep 30');
  });
  it('no estimate → "On its way"', () => {
    expect(trackingHeadline({ ...base, estimatedDelivery: undefined }, NOW)?.title).toBe('On its way');
  });
  it('out for delivery / delivered / problems', () => {
    expect(trackingHeadline({ ...base, trackingStatus: 'out_for_delivery' }, NOW)).toEqual({ title: 'Arriving today', subtitle: 'Out for delivery with UPS' });
    expect(trackingHeadline({ ...base, status: 'delivered', trackingStatus: 'delivered' }, NOW)).toEqual({ title: 'Delivered', subtitle: 'Delivered by UPS' });
    expect(trackingHeadline({ ...base, trackingStatus: 'exception' }, NOW)?.title).toBe('Delivery problem');
    expect(trackingHeadline({ ...base, trackingStatus: 'returned_to_sender' }, NOW)?.title).toBe('Returning to sender');
  });
  it('before shipping: confirmed vs. just placed; nothing for cancelled/refunded', () => {
    const unshipped = { ...base, status: 'new' as const, trackingStatus: undefined, trackingCarrier: undefined };
    expect(trackingHeadline(unshipped, NOW)).toEqual({ title: 'Order placed', subtitle: 'Waiting for Atelier Noire to confirm' });
    expect(trackingHeadline({ ...unshipped, paidAt: '2026-09-26T10:00:00Z' }, NOW)?.title).toBe('Preparing to ship');
    expect(trackingHeadline({ ...unshipped, status: 'processing' }, NOW)?.title).toBe('Preparing to ship');
    expect(trackingHeadline({ ...base, status: 'cancelled' }, NOW)).toBeNull();
    expect(trackingHeadline({ ...base, status: 'refunded' }, NOW)).toBeNull();
  });
});

describe('routeProgress', () => {
  it('moves the package only with the real tracking status', () => {
    expect(routeProgress({ status: 'shipped', trackingStatus: 'label_created' })).toBe(0);
    expect(routeProgress({ status: 'shipped', trackingStatus: 'accepted' })).toBeLessThan(routeProgress({ status: 'shipped', trackingStatus: 'in_transit' }));
    expect(routeProgress({ status: 'shipped', trackingStatus: 'in_transit' })).toBeLessThan(routeProgress({ status: 'shipped', trackingStatus: 'out_for_delivery' }));
    expect(routeProgress({ status: 'delivered' })).toBe(1);
  });
});

describe('components', () => {
  let tree: ReactTestRenderer;
  afterEach(() => act(() => tree.unmount()));

  it('map placeholder draws after layout, describes the route, and uses no accent colour', () => {
    act(() => { tree = create(<ShipmentMapPlaceholder info={base} />); });
    const map = tree.root.find((n) => n.props.testID === 'shipment-map-placeholder' && typeof n.type === 'string');
    expect(map.props.accessibilityLabel).toBe('Route overview: from Atelier Noire to New York, NY. In transit.');
    expect(tree.root.findAllByType('Svg' as never)).toHaveLength(0); // nothing drawn at width 0 — never a broken image
    act(() => { map.props.onLayout({ nativeEvent: { layout: { width: 326, height: 136 } } }); });
    expect(tree.root.findAllByType('Svg' as never)).toHaveLength(1);
    expect(tree.root.findAllByType('Feather' as never).map((n) => n.props.name)).toContain('package');
    const json = JSON.stringify(tree.toJSON());
    expect(json).not.toContain('#FF7B82');
    expect(json).toContain('New York, NY');
  });

  it('delivered: the marker becomes a check at the destination', () => {
    act(() => { tree = create(<ShipmentMapPlaceholder info={{ ...base, status: 'delivered', trackingStatus: 'delivered' }} />); });
    const map = tree.root.find((n) => n.props.testID === 'shipment-map-placeholder' && typeof n.type === 'string');
    act(() => { map.props.onLayout({ nativeEvent: { layout: { width: 326, height: 136 } } }); });
    const icons = tree.root.findAllByType('Feather' as never).map((n) => n.props.name);
    expect(icons).toContain('check');
    expect(icons).not.toContain('package');
  });

  it('headline renders nothing for a cancelled order', () => {
    act(() => { tree = create(<ShipmentHeadline info={{ ...base, status: 'cancelled' }} />); });
    expect(tree.toJSON()).toBeNull();
  });
});
