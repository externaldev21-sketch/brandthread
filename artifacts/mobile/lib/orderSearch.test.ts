import { describe, expect, it } from 'vitest';
import { matchesOrderSearch, searchOrders } from './orderSearch';

const orders = [
  { id: 'a', orderNumber: 'BT-10042', sellerName: 'Atelier Noir', lineItems: [{ productName: 'Chrome Tee' }, { productName: 'Café Hoodie' }] },
  { id: 'b', orderNumber: 'BT-10077', sellerName: 'Silver Lane', lineItems: [{ productName: 'Cargo Pant' }] },
];

describe('matchesOrderSearch', () => {
  it('matches product, seller and order number', () => {
    expect(matchesOrderSearch(orders[0], 'chrome')).toBe(true);
    expect(matchesOrderSearch(orders[0], 'atelier')).toBe(true);
    expect(matchesOrderSearch(orders[0], '10042')).toBe(true);
    expect(matchesOrderSearch(orders[0], '#BT-10042')).toBe(true);
    expect(matchesOrderSearch(orders[1], 'chrome')).toBe(false);
  });

  it('ignores case and accents and needs every word', () => {
    expect(matchesOrderSearch(orders[0], 'CAFE hoodie')).toBe(true);
    expect(matchesOrderSearch(orders[0], 'noir cargo')).toBe(false);
  });

  it('treats an empty query as no filter', () => {
    expect(searchOrders(orders, '   ').map(o => o.id)).toEqual(['a', 'b']);
    expect(searchOrders(orders, 'lane').map(o => o.id)).toEqual(['b']);
  });
});
