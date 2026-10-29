/**
 * The route map's screen-reader label must name the real tracking state:
 * a package the carrier flagged (exception) or is sending back must not be
 * announced as "In transit".
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { text: '#fff', muted: '#999', border: '#222', cardElevated: '#111', background: '#000' } }),
}));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));

import { ShipmentMapPlaceholder, type ShipmentInfo } from '../ShipmentTracking';

function label(info: ShipmentInfo): string {
  let r!: ReactTestRenderer;
  act(() => { r = create(<ShipmentMapPlaceholder info={info} />); });
  return r.root.find((n) => n.props.testID === 'shipment-map-placeholder' && typeof n.props.accessibilityLabel === 'string').props.accessibilityLabel;
}

describe('ShipmentMapPlaceholder accessibility label', () => {
  const base: ShipmentInfo = { status: 'shipped', sellerName: 'Atelier', destinationCity: 'Austin', destinationState: 'TX' };

  it('announces a carrier exception as a delivery problem', () => {
    expect(label({ ...base, trackingStatus: 'exception' })).toBe('Route overview: from Atelier to Austin, TX. Delivery problem.');
  });

  it('announces a return as returning to sender', () => {
    expect(label({ ...base, trackingStatus: 'returned_to_sender' })).toBe('Route overview: from Atelier to Austin, TX. Returning to sender.');
  });

  it('keeps in-transit packages as in transit', () => {
    expect(label({ ...base, trackingStatus: 'in_transit' })).toBe('Route overview: from Atelier to Austin, TX. In transit.');
  });
});
