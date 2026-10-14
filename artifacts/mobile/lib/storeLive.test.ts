import { describe, expect, it } from 'vitest';
import { isFirstStoreLive, storeLiveSeenKey } from './storeLive';

describe('isFirstStoreLive', () => {
  it('is true when the just-published product is the only active one', () => {
    expect(isFirstStoreLive([{ id: 'a', status: 'active' }, { id: 'b', status: 'draft' }], 'a', false)).toBe(true);
  });
  it('is false once a seller already had a live product', () => {
    expect(isFirstStoreLive([{ id: 'a', status: 'active' }, { id: 'b', status: 'active' }], 'a', false)).toBe(false);
  });
  it('is false for a draft save', () => {
    expect(isFirstStoreLive([{ id: 'a', status: 'draft' }], 'a', false)).toBe(false);
  });
  it('never repeats', () => {
    expect(isFirstStoreLive([{ id: 'a', status: 'active' }], 'a', true)).toBe(false);
  });
  it('keys the seen flag per seller', () => {
    expect(storeLiveSeenKey('user_1')).not.toBe(storeLiveSeenKey('user_2'));
  });
});
