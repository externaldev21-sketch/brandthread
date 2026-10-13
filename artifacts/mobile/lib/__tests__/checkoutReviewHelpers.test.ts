import { describe, expect, it } from 'vitest';
import {
  addBusinessDays, arrivalBusinessDays, arrivalLabel, formatDateRange, shippingLine, shippingPriceLabel,
} from '@/lib/checkoutDelivery';
import { addressName, addressOneLine } from '@/lib/addressFormat';
import {
  deviceCountry, filterRegions, firstIndexForLetter, regionLetters, sortRegions, suggestedRegion, usStateForZip,
} from '@/lib/regionPicker';
import { COUNTRIES, US_STATES } from '@/lib/addressRegions';

// Tuesday, October 13, 2026 (local time).
const TUE = new Date(2026, 9, 13, 10, 0);

describe('shipping row: "Free shipping · Arrives Oct 16–20"', () => {
  it('counts business days, skipping the weekend', () => {
    expect(addBusinessDays(TUE, 3).toDateString()).toBe(new Date(2026, 9, 16).toDateString()); // Fri
    expect(addBusinessDays(TUE, 5).toDateString()).toBe(new Date(2026, 9, 20).toDateString()); // Tue
    expect(addBusinessDays(new Date(2026, 9, 16), 1).toDateString()).toBe(new Date(2026, 9, 19).toDateString()); // Fri → Mon
  });

  it('uses 3–5 business days when the seller set no processing time, processing + 2–4 days transit otherwise', () => {
    expect(arrivalBusinessDays({ processingDays: null })).toEqual([3, 5]);
    expect(arrivalBusinessDays({ processingDays: 3 })).toEqual([5, 7]);
    expect(arrivalBusinessDays({ processingDays: 0 })).toEqual([3, 5]);
    expect(arrivalBusinessDays({ isPreOrder: true })).toBeNull();
  });

  it('writes a real date range, across months too', () => {
    expect(arrivalLabel({ processingDays: null }, TUE)).toBe('Arrives Oct 16–20');
    expect(arrivalLabel({ isPreOrder: true }, TUE)).toBe('Ships after production');
    expect(formatDateRange(new Date(2026, 9, 30), new Date(2026, 10, 3))).toBe('Oct 30 – Nov 3');
    expect(formatDateRange(new Date(2026, 9, 16), new Date(2026, 9, 16))).toBe('Oct 16');
  });

  it('says the price once: "Free shipping" never twice', () => {
    expect(shippingPriceLabel(0)).toBe('Free shipping');
    expect(shippingPriceLabel(1200)).toBe('$12.00 shipping');
    const line = shippingLine({ priceCents: 0, processingDays: null }, TUE);
    expect(line).toBe('Free shipping · Arrives Oct 16–20');
    expect(line.match(/free shipping/gi)).toHaveLength(1);
  });
});

describe('Ship to: name above the whole address on one line', () => {
  const address = { firstName: 'Jordan', lastName: 'Reyes', line1: '141 Prince St', city: 'New York', state: 'NY', postalCode: '10012', country: 'US' };

  it('keeps the full street, city, state and ZIP', () => {
    expect(addressName(address)).toBe('Jordan Reyes');
    expect(addressOneLine(address)).toBe('141 Prince St, New York, NY 10012');
    expect(addressOneLine({ ...address, line2: 'Apt 4' })).toBe('141 Prince St, Apt 4, New York, NY 10012');
    expect(addressOneLine({ ...address, country: 'CA', state: 'ON', postalCode: 'M5V 2T6', city: 'Toronto', line1: '1 Spadina Ave' }))
      .toBe('1 Spadina Ave, Toronto, ON M5V 2T6, CA');
  });

  it('is empty until the street and city exist', () => {
    expect(addressOneLine({ ...address, line1: '' })).toBeNull();
    expect(addressOneLine({ ...address, city: ' ' })).toBeNull();
    expect(addressName({})).toBe('');
  });
});

describe('State / Country sheet', () => {
  const labels = (options: { label: string }[]) => options.map(option => option.label);

  it('filters as you type, by name or code', () => {
    expect(labels(filterRegions(US_STATES, 'New'))).toEqual(['New Hampshire', 'New Jersey', 'New Mexico', 'New York']);
    expect(labels(filterRegions(US_STATES, 'NY'))[0]).toBe('New York');
    expect(labels(filterRegions(US_STATES, 'york'))).toEqual(['New York']);
    expect(labels(filterRegions(COUNTRIES, 'US'))[0]).toBe('United States');
    expect(labels(filterRegions(COUNTRIES, 'uni'))).toEqual(['United Arab Emirates', 'United Kingdom', 'United States']);
    expect(filterRegions(US_STATES, 'zzz')).toEqual([]);
  });

  it('lists A–Z with a letter index for the scrubber', () => {
    const sorted = sortRegions(COUNTRIES);
    expect(sorted[0].label).toBe('Australia');
    expect(regionLetters(US_STATES)[0]).toBe('A');
    expect(regionLetters(US_STATES)).not.toContain('B');
    expect(sorted[firstIndexForLetter(sorted, 'u')].label).toBe('United Arab Emirates');
    expect(firstIndexForLetter(sorted, 'Q')).toBe(-1);
  });

  it('puts the likely value first: state from the ZIP, country from the device', () => {
    expect(usStateForZip('10012')).toBe('NY');
    expect(usStateForZip('94110')).toBe('CA');
    expect(usStateForZip('60614')).toBe('IL');
    expect(usStateForZip('97209')).toBe('OR');
    expect(usStateForZip('20500')).toBe('DC');
    expect(usStateForZip('12')).toBeNull();
    expect(usStateForZip('')).toBeNull();
    expect(deviceCountry('en-US')).toBe('US');
    expect(deviceCountry('fr_CA')).toBe('CA');
    expect(deviceCountry('en')).toBeNull();
    expect(suggestedRegion(US_STATES, 'ny')?.label).toBe('New York');
    expect(suggestedRegion(COUNTRIES, 'ZZ')).toBeNull();
  });
});
