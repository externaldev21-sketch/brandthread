import { describe, expect, it } from 'vitest';
import { allOptionsSelected, onlyVariantSelection } from './buyerProductSelection';

describe('buyer product selection (BT-252)', () => {
  it('treats a product with no options as fully selected', () => {
    expect(allOptionsSelected({ options: [] }, {})).toBe(true);
  });

  it('still requires every option on a product that has them', () => {
    const product = { options: [{ id: 'size' }, { id: 'colour' }] };
    expect(allOptionsSelected(product, {})).toBe(false);
    expect(allOptionsSelected(product, { size: 'm' })).toBe(false);
    expect(allOptionsSelected(product, { size: 'm', colour: 'black' })).toBe(true);
  });

  it('pre-selects the only variant, and nothing when there is a choice', () => {
    expect(onlyVariantSelection({ options: [], variants: [{ optionValues: [] }] })).toEqual({});
    expect(onlyVariantSelection({
      options: [{ id: 'size' }],
      variants: [{ optionValues: [{ optionId: 'size', valueId: 'os' }] }],
    })).toEqual({ size: 'os' });
    expect(onlyVariantSelection({
      options: [{ id: 'size' }],
      variants: [
        { optionValues: [{ optionId: 'size', valueId: 's' }] },
        { optionValues: [{ optionId: 'size', valueId: 'm' }] },
      ],
    })).toBeNull();
  });
});
