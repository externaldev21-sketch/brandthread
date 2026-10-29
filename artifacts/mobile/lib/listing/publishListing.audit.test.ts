import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/setupCompletion', () => ({
  completeSetupTaskAfter: async <T,>(_task: string, run: () => Promise<T>) => run(),
}));
vi.mock('@/lib/payoutGate', () => ({ isPayoutsNotReadyError: () => false }));

import { emptyListing } from './listingStore';
import { publishListing } from './publishListing';

function fakeApi() {
  return {
    products: {
      create: vi.fn(async () => ({ id: 'new-1' })),
      update: vi.fn(async () => ({})),
      addVariant: vi.fn(async () => ({})),
      updateVariant: vi.fn(async () => ({})),
    },
    productVideos: { upload: vi.fn(async () => ({})) },
  };
}

describe('publishListing edit (audit)', () => {
  it('stops selling the old no-size variant when the item is split into several sizes', async () => {
    const api = fakeApi();
    const form = {
      ...emptyListing('edit_p1'), editProductId: 'p1', title: 'Tee', colors: [],
      sizes: [{ size: 'S', quantity: 2 }, { size: 'M', quantity: 1 }],
      variantIdsBySize: { '': 'v-default' },
    };
    await publishListing(api as never, form, 3000);
    expect(api.products.addVariant).toHaveBeenCalledTimes(2);
    expect(api.products.updateVariant).toHaveBeenCalledWith('p1', 'v-default', { stock: 0 });
  });

  it('keeps reusing the no-size variant for a single-size item (never zeroes it)', async () => {
    const api = fakeApi();
    const form = { ...emptyListing('edit_p1'), editProductId: 'p1', title: 'Tee', quantity: 4, variantIdsBySize: { '': 'v-default' } };
    await publishListing(api as never, form, 3000);
    expect(api.products.updateVariant).toHaveBeenCalledTimes(1);
    expect(api.products.updateVariant).toHaveBeenCalledWith('p1', 'v-default', { priceCents: 3000, stock: 4 });
  });
});
