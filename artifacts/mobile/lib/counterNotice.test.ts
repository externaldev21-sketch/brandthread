import { describe, expect, it } from 'vitest';
import {
  counterNoticeError, counterNoticeStatusLabel, defaultRemovedMaterial, type CounterNoticeInput,
} from './counterNotice';

const valid: CounterNoticeInput = {
  fullName: 'Sam Seller', address: '12 Market Street, Portland, OR', phone: '503 555 0100', email: '',
  removedMaterial: 'My listing "Nord jacket"', explanation: 'I designed and made this jacket myself.',
  perjuryStatement: true, consentToJurisdiction: true, signature: 'Sam Seller',
};

describe('counter-notice form', () => {
  it('accepts a complete notice (email optional, signature case-insensitive)', () => {
    expect(counterNoticeError(valid)).toBeNull();
    expect(counterNoticeError({ ...valid, signature: ' sam   seller ' })).toBeNull();
  });

  it('requires every legally required element', () => {
    expect(counterNoticeError({ ...valid, fullName: '' })).toMatch(/legal name/);
    expect(counterNoticeError({ ...valid, address: 'x' })).toMatch(/address/);
    expect(counterNoticeError({ ...valid, phone: '12' })).toMatch(/phone/);
    expect(counterNoticeError({ ...valid, removedMaterial: '' })).toMatch(/removed listing/);
    expect(counterNoticeError({ ...valid, explanation: 'short' })).toMatch(/Explain/);
    expect(counterNoticeError({ ...valid, perjuryStatement: false })).toMatch(/perjury/);
    expect(counterNoticeError({ ...valid, consentToJurisdiction: false })).toMatch(/jurisdiction/);
    expect(counterNoticeError({ ...valid, signature: 'Other Person' })).toMatch(/match/);
  });

  it('prefills the removed material and labels case states', () => {
    expect(defaultRemovedMaterial({ listingName: 'Nord', listingProductId: 'p1', caseReference: 'IP-1' }))
      .toBe('My listing "Nord" at brandthread.app/product/p1 (case IP-1).');
    expect(counterNoticeStatusLabel({ counterNoticeStatus: 'none', canFileCounterNotice: true })).toMatch(/can file/);
    expect(counterNoticeStatusLabel({ counterNoticeStatus: 'received', canFileCounterNotice: false })).toMatch(/review/);
  });
});
