import { describe, expect, it } from 'vitest';
import { orderDisplayNumber } from '../orderDisplayNumber';

describe('orderDisplayNumber', () => {
  it('turns the server order number into "Order #N"', () => {
    expect(orderDisplayNumber('BT-10234')).toBe('Order #10234');
    expect(orderDisplayNumber('BT-00042')).toBe('Order #42');
    expect(orderDisplayNumber('1234')).toBe('Order #1234');
  });

  it('never prints a raw or synthetic identifier', () => {
    expect(orderDisplayNumber('PREVIEW-ORDER-01')).toBe('Order #1');
    expect(orderDisplayNumber('3f2b8c1e-9d4a-4b7e-8f21-0c6d5e4a3b21')).toBeNull();
    expect(orderDisplayNumber('ord_8Hk2pQ')).toBeNull();
    expect(orderDisplayNumber('')).toBeNull();
    expect(orderDisplayNumber(undefined)).toBeNull();
  });
});
