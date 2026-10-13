import { describe, expect, it } from 'vitest';
import {
  addableRegions, draftFromHeadOffice, filterRegistrations, headOfficeErrors, headOfficeFromDraft, headOfficeLine,
  registrationStatusLabel, type TaxRegistration,
} from './taxRegistrationsView';

const regions = [
  { code: 'US-CA', country: 'US', state: 'CA', name: 'California' },
  { code: 'US-NY', country: 'US', state: 'NY', name: 'New York' },
  { code: 'US-TX', country: 'US', state: 'TX', name: 'Texas' },
  { code: 'GB', country: 'GB', state: null, name: 'United Kingdom' },
];
const reg = (code: string, status: string): TaxRegistration => ({
  ...regions.find((r) => r.code === code)!, id: `taxreg_${code}`, status, activeFrom: null, expiresAt: null,
});

describe('tax registrations view', () => {
  it('labels statuses in plain words', () => {
    expect(registrationStatusLabel('active')).toBe('Collecting');
    expect(registrationStatusLabel('scheduled')).toBe('Starts soon');
    expect(registrationStatusLabel('expired')).toBe('Stopped');
  });

  it('only offers regions not already collecting or starting', () => {
    const info = { regions, registrations: [reg('US-CA', 'active'), reg('US-NY', 'expired'), reg('GB', 'scheduled')] };
    expect(addableRegions(info, '').map((r) => r.code)).toEqual(['US-NY', 'US-TX']);
  });

  it('searches by name or code', () => {
    const info = { regions, registrations: [] };
    expect(addableRegions(info, 'new').map((r) => r.code)).toEqual(['US-NY']);
    expect(addableRegions(info, 'tx').map((r) => r.code)).toEqual(['US-TX']);
    expect(addableRegions(info, 'gb').map((r) => r.code)).toEqual(['GB']);
    expect(filterRegistrations([reg('US-CA', 'active'), reg('GB', 'active')], 'cal').map((r) => r.code)).toEqual(['US-CA']);
  });

  it('formats the head office on one line', () => {
    expect(headOfficeLine({ line1: '1 Market St', line2: null, city: 'San Francisco', state: 'CA', postalCode: '94105', country: 'US' }))
      .toBe('1 Market St, San Francisco, CA 94105, US');
    expect(headOfficeLine(null)).toBeNull();
  });

  it('validates the head office form and trims what it sends', () => {
    const empty = draftFromHeadOffice(null);
    expect(Object.keys(headOfficeErrors(empty)).sort()).toEqual(['city', 'line1', 'postalCode', 'state']);
    const draft = { ...empty, line1: ' 1 Market St ', city: 'SF', state: 'ca', postalCode: '94105' };
    expect(headOfficeErrors(draft)).toEqual({});
    expect(headOfficeFromDraft(draft)).toEqual({ line1: '1 Market St', line2: null, city: 'SF', state: 'CA', postalCode: '94105', country: 'US' });
    expect(headOfficeErrors({ ...draft, country: 'USA' }).country).toBeTruthy();
    expect(headOfficeErrors({ ...draft, country: 'GB', state: '' })).toEqual({});
  });
});
