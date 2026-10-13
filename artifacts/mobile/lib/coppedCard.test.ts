import { describe, expect, it } from 'vitest';
import { coppedCardData } from './coppedCard';

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const item = (n: number, imageUri?: string) => ({
  productId: id(n), productName: `Tee ${n}`, imageUri, sellerName: 'Studio', sellerHandle: '@studio',
});

describe('coppedCardData', () => {
  it('returns null for an empty order', () => {
    expect(coppedCardData([])).toBeNull();
  });

  it('features the first item that has a photo', () => {
    const data = coppedCardData([item(1), item(2, 'https://img/2.jpg')]);
    expect(data?.productName).toBe('Tee 2');
    expect(data?.imageUri).toBe('https://img/2.jpg');
    expect(data?.moreCount).toBe(1);
  });

  it('counts the same product twice (two sizes) as one', () => {
    expect(coppedCardData([item(1, 'a'), item(1, 'a')])?.moreCount).toBe(0);
  });

  it('links to the product page and normalises the handle', () => {
    const data = coppedCardData([{ ...item(3, 'x'), sellerHandle: 'studio' }]);
    expect(data?.brandHandle).toBe('@studio');
    expect(data?.url).toMatch(/\/store\/product\/00000000-0000-4000-8000-000000000003$/);
  });

  it('falls back to the first item without a photo', () => {
    const data = coppedCardData([item(4)]);
    expect(data?.imageUri).toBeNull();
    expect(data?.productName).toBe('Tee 4');
  });
});
