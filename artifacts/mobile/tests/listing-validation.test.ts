import { describe, expect, it } from 'vitest';
import {
  validatePhotosStep,
  validateDetailsStep,
  validateVariantsStep,
  validatePricingStep,
  validateListingForPublish,
  errorsForField,
} from '@/lib/listingValidation';

describe('validatePhotosStep', () => {
  it('requires at least one photo', () => {
    expect(validatePhotosStep({ media: [] })).toHaveLength(1);
  });
  it('passes with one photo', () => {
    expect(validatePhotosStep({ media: [{ id: '1' }] })).toHaveLength(0);
  });
});

describe('validateDetailsStep', () => {
  it('requires a non-empty name', () => {
    expect(validateDetailsStep({ name: '' })).toHaveLength(1);
    expect(validateDetailsStep({ name: '   ' })).toHaveLength(1);
    expect(validateDetailsStep({ name: 'Vintage Tee' })).toHaveLength(0);
  });
});

describe('validateVariantsStep', () => {
  it('allows variants with no SKU set', () => {
    expect(validateVariantsStep({ variants: [{ title: 'M / Black' }, { title: 'L / Black' }] })).toHaveLength(0);
  });

  it('flags duplicate SKUs', () => {
    const errors = validateVariantsStep({
      variants: [
        { title: 'M / Black', sku: 'TEE-1' },
        { title: 'L / Black', sku: 'TEE-1' },
      ],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('TEE-1');
  });

  it('flags an invalid per-variant price override', () => {
    const errors = validateVariantsStep({ variants: [{ title: 'M', price: 'abc' }] });
    expect(errors).toHaveLength(1);
  });

  it('accepts unique SKUs and valid price overrides', () => {
    const errors = validateVariantsStep({
      variants: [
        { title: 'M', sku: 'A', price: '19.99' },
        { title: 'L', sku: 'B', price: '21.00' },
      ],
    });
    expect(errors).toHaveLength(0);
  });
});

describe('validatePricingStep', () => {
  it('requires a positive retail price', () => {
    expect(validatePricingStep({ priceStr: '' })).toHaveLength(1);
    expect(validatePricingStep({ priceStr: '0' })).toHaveLength(1);
    expect(validatePricingStep({ priceStr: '19.99' })).toHaveLength(0);
  });

  it('rejects a malformed compare-at price', () => {
    const errors = validatePricingStep({ priceStr: '10.00', compareAtStr: 'abc' });
    expect(errors.some(e => e.field === 'compareAt')).toBe(true);
  });

  it('requires compare-at price to be higher than retail price', () => {
    const errors = validatePricingStep({ priceStr: '20.00', compareAtStr: '15.00' });
    expect(errors.some(e => e.field === 'compareAt')).toBe(true);
  });

  it('accepts a compare-at price above the retail price', () => {
    const errors = validatePricingStep({ priceStr: '20.00', compareAtStr: '30.00' });
    expect(errors).toHaveLength(0);
  });

  it('rejects an invalid cost value', () => {
    const errors = validatePricingStep({ priceStr: '20.00', costStr: 'nope' });
    expect(errors.some(e => e.field === 'cost')).toBe(true);
  });

  it('requires pre-order close date after the open date when both are set', () => {
    const errors = validatePricingStep({
      priceStr: '20.00', isPreOrder: true,
      preOrderOpenDate: '2026-05-01', preOrderCloseDate: '2026-04-01',
    });
    expect(errors.some(e => e.field === 'preorder')).toBe(true);
  });

  it('allows a valid pre-order date range', () => {
    const errors = validatePricingStep({
      priceStr: '20.00', isPreOrder: true,
      preOrderOpenDate: '2026-04-01', preOrderCloseDate: '2026-05-01',
    });
    expect(errors).toHaveLength(0);
  });
});

describe('validateListingForPublish (cross-step aggregate)', () => {
  it('aggregates every step\'s errors', () => {
    const errors = validateListingForPublish({
      media: [],
      name: '',
      priceStr: '',
      variants: [{ title: 'M', sku: 'A' }, { title: 'L', sku: 'A' }],
    });
    const fields = errors.map(e => e.field);
    expect(fields).toContain('media');
    expect(fields).toContain('name');
    expect(fields).toContain('price');
    expect(fields).toContain('variants');
  });

  it('is clean for a fully valid listing', () => {
    const errors = validateListingForPublish({
      media: [{ id: '1' }],
      name: 'Vintage Tee',
      priceStr: '25.00',
      variants: [{ title: 'M', sku: 'A' }, { title: 'L', sku: 'B' }],
    });
    expect(errors).toHaveLength(0);
  });
});

describe('errorsForField', () => {
  it('finds the first message for a field', () => {
    const errors = [{ field: 'price', message: 'bad' }, { field: 'name', message: 'missing' }];
    expect(errorsForField(errors, 'name')).toBe('missing');
    expect(errorsForField(errors, 'missing-field')).toBeUndefined();
  });
});
