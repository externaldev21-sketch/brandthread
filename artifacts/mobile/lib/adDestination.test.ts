import { describe, expect, it } from 'vitest';
import { adDestinationUrl } from './adDestination';

const id = '3f1a2b4c-1111-4222-8333-944455556666';

describe('Meta ad destination (BT-326)', () => {
  it('sends a product ad to the product page, tagged as paid social', () => {
    expect(adDestinationUrl({ promoteKind: 'product', promoteRefId: id, storeUrl: 'https://brandthread.app/u/northline', campaignId: 'c-42' }))
      .toBe(`https://brandthread.app/store/product/${id}?utm_source=facebook&utm_medium=paid&utm_campaign=c-42`);
  });

  it('sends store and video ads to the store, and tags drafts before they have an id', () => {
    expect(adDestinationUrl({ promoteKind: 'store', promoteRefId: null, storeUrl: 'https://brandthread.app/u/northline' }))
      .toBe('https://brandthread.app/u/northline?utm_source=facebook&utm_medium=paid&utm_campaign=brandthread_ads');
    expect(adDestinationUrl({ promoteKind: 'video', promoteRefId: 'p1', storeUrl: 'https://brandthread.app/u/northline', campaignId: 'c-1' }))
      .toContain('/u/northline?utm_source=facebook');
  });

  it('falls back to the store when the product id is not usable, and to nothing without either', () => {
    expect(adDestinationUrl({ promoteKind: 'product', promoteRefId: '../x', storeUrl: 'https://brandthread.app/u/a' })).toContain('/u/a?');
    expect(adDestinationUrl({ promoteKind: 'product', promoteRefId: null, storeUrl: null })).toBeNull();
  });
});
