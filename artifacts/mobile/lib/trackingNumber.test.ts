import { describe, expect, it } from 'vitest';
import { CARRIER_OPTIONS, validateTrackingNumber } from './trackingNumber';

describe('validateTrackingNumber (mirrors api-server lib/shippingTracking)', () => {
  it.each([
    ['USPS', '9400 1118 9922 3344 5566 77', '9400111899223344556677'],
    ['UPS', '1z999aa10123456784', '1Z999AA10123456784'],
    ['FedEx', '1234-5678-9012', '123456789012'],
    ['DHL Express', '1234567890', '1234567890'],
    ['OnTrac', 'C11234567890123', 'C11234567890123'],
  ])('accepts a %s number and normalizes it', (carrier, raw, stored) => {
    expect(validateTrackingNumber(carrier, raw)).toEqual({ ok: true, carrier, trackingNumber: stored });
  });

  it('flags the field that needs fixing', () => {
    expect(validateTrackingNumber('UPS', '1ZROUTE')).toMatchObject({ ok: false, field: 'trackingNumber' });
    expect(validateTrackingNumber('UPS', '')).toEqual({ ok: false, field: 'trackingNumber', error: 'Enter a tracking number.' });
    expect(validateTrackingNumber('', '1Z999AA10123456784')).toMatchObject({ ok: false, field: 'carrier' });
    expect(validateTrackingNumber('Other', '1Z999AA10123456784')).toMatchObject({ ok: false, field: 'carrier' });
  });

  it('offers the same carriers as the server', () => {
    expect(CARRIER_OPTIONS.map(o => o.label)).toEqual(['USPS', 'UPS', 'FedEx', 'DHL Express', 'Other']);
  });
});
