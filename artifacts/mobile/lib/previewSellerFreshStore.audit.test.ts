import { describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => {
  let finish!: (raw: string | null) => void;
  const pending = new Promise<string | null>((resolve) => { finish = resolve; });
  return { finish: (raw: string | null) => finish(raw), pending, setItem: vi.fn(async () => {}) };
});
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(() => storage.pending), setItem: storage.setItem },
}));

import {
  addPreviewDiscount, getPreviewDiscounts, type PreviewDiscount, whenPreviewSellerFreshStoreReady,
} from './previewSellerFreshStore';

const discount = (id: string): PreviewDiscount => ({
  id, code: id.toUpperCase(), type: 'percentage', value: 10, minOrderCents: 0, appliesTo: 'entire_store', productIds: [],
  maxUses: null, usesCount: 0, oneUsePerCustomer: false, startsAt: null, expiresAt: null, active: true, status: 'active',
  createdAt: '2026-10-01T00:00:00.000Z',
});

describe('preview seller store hydration (audit)', () => {
  it('keeps a discount added while the saved session was still loading', async () => {
    addPreviewDiscount(discount('new'));
    storage.finish(JSON.stringify({ discounts: [discount('saved')], liveSessions: [], storefront: { headline: null, bio: null, updatedAt: null } }));
    await whenPreviewSellerFreshStoreReady();
    expect(getPreviewDiscounts().map((d) => d.id)).toEqual(['new', 'saved']);
    // And what gets persisted is the merged list, not the stale saved one.
    const lastWrite = storage.setItem.mock.calls.at(-1) as unknown as [string, string];
    expect(JSON.parse(lastWrite[1]).discounts.map((d: PreviewDiscount) => d.id)).toEqual(['new', 'saved']);
  });
});
