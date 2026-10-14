import { describe, expect, it } from 'vitest';
import { editionLabel, editionNumberLabel, padEditionNumber, parseEditionSize } from '@/lib/editions';

describe('numbered pieces', () => {
  it('pads to the run size width, at least 3 digits', () => {
    expect(padEditionNumber(14, 200)).toBe('014');
    expect(padEditionNumber(7, 50)).toBe('007');
    expect(padEditionNumber(7, 5000)).toBe('0007');
    expect(padEditionNumber(200, 200)).toBe('200');
  });

  it('labels one unit and a range', () => {
    expect(editionLabel({ number: 14, quantity: 1, size: 200 })).toBe('No. 014 of 200');
    expect(editionNumberLabel({ number: 14, quantity: 2, size: 200 })).toBe('No. 014–015');
    expect(editionLabel({ number: 9, quantity: 1, size: 1000 })).toBe('No. 0009 of 1,000');
  });

  it('accepts only whole run sizes in range', () => {
    expect(parseEditionSize('200')).toBe(200);
    expect(parseEditionSize('1')).toBeNull();
    expect(parseEditionSize('100001')).toBeNull();
    expect(parseEditionSize('20.5')).toBeNull();
    expect(parseEditionSize('')).toBeNull();
  });
});
