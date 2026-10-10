import { describe, expect, it } from 'vitest';
import { publishesSoldOut } from './productPublishChecks';

const base = { status: 'active' as const, trackInventory: true, allowOversell: false, isPreOrder: false, totalStock: 0 };

describe('publishesSoldOut', () => {
  it('flags a published product with no stock', () => {
    expect(publishesSoldOut(base)).toBe(true);
  });
  it('lets drafts, stocked, untracked, oversell and pre-order products through', () => {
    expect(publishesSoldOut({ ...base, status: 'draft' })).toBe(false);
    expect(publishesSoldOut({ ...base, totalStock: 4 })).toBe(false);
    expect(publishesSoldOut({ ...base, trackInventory: false })).toBe(false);
    expect(publishesSoldOut({ ...base, allowOversell: true })).toBe(false);
    expect(publishesSoldOut({ ...base, isPreOrder: true })).toBe(false);
  });
});
