import { describe, expect, it, vi } from 'vitest';
import { resolveSharedProductHref } from './sharedProductRoute';

const ID = '3f2b8a5e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';

describe('resolveSharedProductHref', () => {
  it('sends signed-out visitors to the public buyer page without any lookup', async () => {
    const getPublicProduct = vi.fn();
    const href = await resolveSharedProductHref(ID, { viewerId: null, getPublicProduct });
    expect(href).toBe(`/buyer-product-detail?productId=${ID}`);
    expect(getPublicProduct).not.toHaveBeenCalled();
  });

  it('sends a signed-in shopper (not the owner) to the buyer page', async () => {
    const getOwnProduct = vi.fn();
    const href = await resolveSharedProductHref(ID, {
      viewerId: 'user_buyer',
      getPublicProduct: async () => ({ ownerId: 'user_seller' }),
      getOwnProduct,
    });
    expect(href).toBe(`/buyer-product-detail?productId=${ID}`);
    expect(getOwnProduct).not.toHaveBeenCalled();
  });

  it('sends the owner to the management screen', async () => {
    const href = await resolveSharedProductHref(ID, {
      viewerId: 'user_seller',
      getPublicProduct: async () => ({ ownerId: 'user_seller' }),
    });
    expect(href).toBe(`/product-detail?id=${ID}`);
  });

  it('lets the owner open their own non-public product (draft) via the owner lookup', async () => {
    const href = await resolveSharedProductHref(ID, {
      viewerId: 'user_seller',
      getPublicProduct: async () => { throw new Error('404'); },
      getOwnProduct: async () => ({ id: ID }),
    });
    expect(href).toBe(`/product-detail?id=${ID}`);
  });

  it('falls back to the buyer page when neither lookup succeeds', async () => {
    const href = await resolveSharedProductHref(ID, {
      viewerId: 'user_buyer',
      getPublicProduct: async () => { throw new Error('404'); },
      getOwnProduct: async () => { throw new Error('404'); },
    });
    expect(href).toBe(`/buyer-product-detail?productId=${ID}`);
  });
});
