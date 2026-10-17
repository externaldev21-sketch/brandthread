import { describe, expect, it } from 'vitest';
import { locationSearchNotice } from './locationSearchNotice';

describe('locationSearchNotice', () => {
  it('explains the limitation when Google Places is not configured', () => {
    const msg = locationSearchNotice({ query: ' Soho House ', providerEnabled: false, searching: false });
    expect(msg).toMatch(/already tagged/);
    expect(msg).toContain('“Soho House”');
  });

  it('is silent when the provider is on, unknown, while searching, or with no query', () => {
    expect(locationSearchNotice({ query: 'x', providerEnabled: true, searching: false })).toBeNull();
    expect(locationSearchNotice({ query: 'x', providerEnabled: null, searching: false })).toBeNull();
    expect(locationSearchNotice({ query: 'x', providerEnabled: false, searching: true })).toBeNull();
    expect(locationSearchNotice({ query: '  ', providerEnabled: false, searching: false })).toBeNull();
  });
});
