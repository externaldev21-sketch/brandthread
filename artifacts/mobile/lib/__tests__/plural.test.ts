import { describe, expect, it } from 'vitest';
import { plural } from '@/lib/plural';

describe('plural', () => {
  it('uses the singular for exactly one', () => {
    expect(plural(1, 'review')).toBe('1 review');
    expect(plural(1, 'day')).toBe('1 day');
  });
  it('uses the plural otherwise', () => {
    expect(plural(0, 'order')).toBe('0 orders');
    expect(plural(2, 'product')).toBe('2 products');
    expect(plural(1250, 'transaction')).toBe('1,250 transactions');
  });
  it('supports irregular plurals and bad input', () => {
    expect(plural(3, 'person', 'people')).toBe('3 people');
    expect(plural(Number.NaN, 'day')).toBe('0 days');
  });
});
