import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Alert: { alert: vi.fn() }, Platform: { OS: 'ios' } }));
vi.mock('expo-image-picker', () => ({}));

vi.mock('@/lib/setupCompletion', () => ({
  completeSetupTaskAfter: async <T,>(_task: string, run: () => Promise<T>) => run(),
}));

import {
  emptyListing, getListing, getListingVersion, missingForPublish, resetListing, totalQuantity, updateListing,
  patchListingQuietly, type ListingForm,
} from '@/lib/listing/listingStore';
import {
  createPayload, draftToListing, listingToDraft, productToListing, updatePayload, variantPayloads,
} from '@/lib/listing/listingPersistence';
import { publishListing } from '@/lib/listing/publishListing';
import { categoryPath, sizeOptionsFor } from '@/lib/listing/taxonomy';
import { makeCover, movePhoto, removePhoto } from '@/lib/listing/listingMedia';

function filled(overrides: Partial<ListingForm> = {}): ListingForm {
  return {
    ...emptyListing('draft_test'),
    photos: [
      { id: 'a', uri: 'file:///a.jpg', remoteUri: '/objects/a', status: 'done' },
      { id: 'b', uri: 'file:///b.jpg', remoteUri: '/objects/b', status: 'done' },
    ],
    title: 'Boxy tee',
    description: 'Worn twice',
    department: 'Men',
    category: 'Tops',
    subcategory: 'T-shirts',
    brand: 'Carhartt',
    condition: 'very_good',
    colors: ['Black'],
    priceStr: '40',
    parcelSize: 'small',
    ...overrides,
  };
}

describe('listing store', () => {
  beforeEach(() => resetListing());

  it('counts user edits but not background upload bookkeeping', () => {
    expect(getListingVersion()).toBe(0);
    updateListing({ title: 'x' });
    expect(getListingVersion()).toBe(1);
    patchListingQuietly(() => ({ description: 'y' }));
    expect(getListingVersion()).toBe(1);
    expect(getListing().description).toBe('y');
  });

  it('lists what Depop would mark as "Needs …"', () => {
    expect(missingForPublish(emptyListing(), null)).toEqual(['photos', 'title', 'category', 'condition', 'price']);
    expect(missingForPublish(filled(), 4000)).toEqual([]);
  });

  it('sums per-size quantities only when selling several sizes', () => {
    expect(totalQuantity(filled({ quantity: 3 }))).toBe(3);
    expect(totalQuantity(filled({ sizes: [{ size: 'S', quantity: 2 }, { size: 'M', quantity: 5 }] }))).toBe(7);
  });

  it('reorders photos, makes a cover and removes', () => {
    resetListing(filled({ photos: [
      { id: '1', uri: '1', status: 'done' }, { id: '2', uri: '2', status: 'done' }, { id: '3', uri: '3', status: 'done' },
    ] }));
    movePhoto(0, 2);
    expect(getListing().photos.map(p => p.id)).toEqual(['2', '3', '1']);
    makeCover('1');
    expect(getListing().photos.map(p => p.id)).toEqual(['1', '2', '3']);
    removePhoto('2');
    expect(getListing().photos.map(p => p.id)).toEqual(['1', '3']);
  });
});

describe('taxonomy', () => {
  it('picks the size system from the category', () => {
    expect(sizeOptionsFor('Men', 'Footwear')).toContain('US 9');
    expect(sizeOptionsFor('Women', 'Bottoms')).toContain('W28');
    expect(sizeOptionsFor('Unisex', 'Bags')).toEqual(['One size']);
    expect(sizeOptionsFor(undefined, undefined)).toContain('M');
    expect(categoryPath('Men', 'Tops', 'T-shirts')).toBe('Men / Tops / T-shirts');
  });
});

describe('drafts', () => {
  it('round-trips the whole form through a ProductDraft the drafts list can read', () => {
    const form = filled({ sizes: [{ size: 'M', quantity: 1 }] });
    const draft = listingToDraft(form);
    expect(draft).toMatchObject({ id: 'draft_test', isDraft: true, name: 'Boxy tee', pricing: { priceCents: 4000 } });
    expect(draft.media?.[0]).toMatchObject({ uri: 'file:///a.jpg', isCover: true });
    const web = listingToDraft(filled({ photos: [{ id: 'w', uri: 'blob:http://x/1', remoteUri: '/objects/w', status: 'done' }] }));
    expect(web.media?.[0].uri).toBe('/objects/w');
    const back = draftToListing(draft);
    expect(back).toMatchObject({ title: 'Boxy tee', subcategory: 'T-shirts', brand: 'Carhartt', sizes: [{ size: 'M', quantity: 1 }] });
  });

  it('marks photos that never finished uploading as failed so they get retried', () => {
    const form = filled({ photos: [{ id: 'p', uri: 'file:///p.jpg', status: 'uploading' }] });
    expect(draftToListing(listingToDraft(form)).photos[0].status).toBe('error');
  });

  it('still opens drafts saved by the old form', () => {
    const back = draftToListing({
      id: 'draft_old', isDraft: true, currentStep: 3, lastSavedAt: '2026-01-01T00:00:00Z',
      name: 'Old', description: 'd', pricing: { priceCents: 1250, currency: 'USD' },
      media: [{ id: 'm', type: 'image', uri: '/objects/m', isCover: true, sortOrder: 0, createdAt: '' }],
    });
    expect(back).toMatchObject({ title: 'Old', priceStr: '12.50', photos: [{ remoteUri: '/objects/m', status: 'done' }] });
  });
});

describe('API payloads', () => {
  it('creates an active product with one variant and the listing details', () => {
    const body = createPayload(filled({ quantity: 2 }), 4000);
    expect(body).toMatchObject({
      name: 'Boxy tee', status: 'active', category: 'T-shirts', images: ['/objects/a', '/objects/b'],
      tags: ['Carhartt', 'Men', 'Tops'],
      listingDetails: { brand: 'Carhartt', condition: 'very_good', colors: ['Black'], parcelSize: 'small', shippingPayer: 'buyer' },
    });
    expect(body.variants).toHaveLength(1);
    expect(body.variants[0]).toMatchObject({ priceCents: 4000, stock: 2, color: 'Black' });
  });

  it('makes one variant per size with its own stock and a unique sku', () => {
    const variants = variantPayloads(filled({ sizes: [{ size: 'S', quantity: 1 }, { size: 'XL', quantity: 4 }] }), 4000);
    expect(variants.map(v => [v.size, v.stock])).toEqual([['S', 1], ['XL', 4]]);
    expect(new Set(variants.map(v => v.sku)).size).toBe(2);
  });

  it('never sends status or variants on an edit', () => {
    const body = updatePayload(filled());
    expect(body).not.toHaveProperty('status');
    expect(body).not.toHaveProperty('variants');
  });

  it('maps an API product back into the form for Edit listing', () => {
    const form = productToListing({
      id: 'p1', name: 'Tee', description: null, category: 'T-shirts', images: ['/objects/x'],
      listingDetails: { department: 'Men', category: 'Tops', subcategory: 'T-shirts', condition: 'good', parcelSize: 'large', shippingPayer: 'seller' },
      variants: [{ id: 'v1', size: 'S', priceCents: 2500, stock: 1 }, { id: 'v2', size: 'M', priceCents: 2500, stock: 3 }],
    });
    expect(form).toMatchObject({
      editProductId: 'p1', priceStr: '25', condition: 'good', parcelSize: 'large', shippingPayer: 'seller',
      sizes: [{ size: 'S', quantity: 1 }, { size: 'M', quantity: 3 }], variantIdsBySize: { S: 'v1', M: 'v2' },
    });
  });
});

describe('publishListing', () => {
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

  it('posts a new listing and uploads its video against the new id', async () => {
    const api = fakeApi();
    const result = await publishListing(api as never, filled({ video: { uri: 'file:///v.mp4', mimeType: 'video/mp4' } }), 4000);
    expect(result).toEqual({ productId: 'new-1', kind: 'created', videoFailed: false });
    expect(api.products.create).toHaveBeenCalledOnce();
    expect(api.productVideos.upload).toHaveBeenCalledWith('new-1', 'file:///v.mp4', 'video/mp4');
  });

  it('reports a failed video without failing the post', async () => {
    const api = fakeApi();
    api.productVideos.upload.mockRejectedValueOnce(new Error('too big'));
    const result = await publishListing(api as never, filled({ video: { uri: 'file:///v.mp4' } }), 4000);
    expect(result.videoFailed).toBe(true);
  });

  it('on edit updates existing sizes, adds new ones and zeroes removed ones', async () => {
    const api = fakeApi();
    const form = filled({
      editProductId: 'p1',
      sizes: [{ size: 'S', quantity: 2 }, { size: 'L', quantity: 1 }],
      variantIdsBySize: { S: 'v1', M: 'v2' },
    });
    const result = await publishListing(api as never, form, 3000);
    expect(result).toMatchObject({ productId: 'p1', kind: 'updated' });
    expect(api.products.update).toHaveBeenCalledWith('p1', expect.not.objectContaining({ status: expect.anything() }));
    expect(api.products.updateVariant).toHaveBeenCalledWith('p1', 'v1', { priceCents: 3000, stock: 2 });
    expect(api.products.addVariant).toHaveBeenCalledWith('p1', expect.objectContaining({ size: 'L', stock: 1, priceCents: 3000 }));
    expect(api.products.updateVariant).toHaveBeenCalledWith('p1', 'v2', { stock: 0 });
    expect(api.products.create).not.toHaveBeenCalled();
  });
});
