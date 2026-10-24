import { describe, expect, it } from 'vitest';
import { countryName } from './countryNames';

describe('countryName', () => {
  it('maps ISO codes to names, case-insensitively', () => {
    expect(countryName('US')).toBe('United States');
    expect(countryName('pt')).toBe('Portugal');
    expect(countryName(' GB ')).toBe('United Kingdom');
  });
  it('falls back to the input for unknown codes and names', () => {
    expect(countryName('XK')).toBe('XK');
    expect(countryName('France')).toBe('France');
    expect(countryName('')).toBe('Unknown');
    expect(countryName(null)).toBe('Unknown');
  });
});
