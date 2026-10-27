import { describe, expect, it } from 'vitest';
import { isValidShopifyStoreHandle, shopifyStoreHandle } from './shopifyStoreHandle';

describe('shopifyStoreHandle', () => {
  it.each([
    ['northline', 'northline'],
    ['  Northline-Studio.myshopify.com ', 'northline-studio'],
    ['https://northline.myshopify.com/admin', 'northline'],
    ['https://admin.shopify.com/store/northline/products', 'northline'],
  ])('reads %j as %j', (input, handle) => {
    expect(shopifyStoreHandle(input)).toBe(handle);
  });

  it('rejects anything that is not a store name', () => {
    expect(isValidShopifyStoreHandle(shopifyStoreHandle('northline.com'))).toBe(false);
    expect(isValidShopifyStoreHandle('')).toBe(false);
    expect(isValidShopifyStoreHandle('-x')).toBe(false);
  });
});
