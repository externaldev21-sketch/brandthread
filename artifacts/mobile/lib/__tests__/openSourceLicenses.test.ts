import { describe, expect, it } from 'vitest';
import { npmPackageUrl, OPEN_SOURCE_LICENSES } from '../openSourceLicenses';

describe('openSourceLicenses', () => {
  it('builds npm URLs for plain and scoped packages', () => {
    expect(npmPackageUrl('expo-router')).toBe('https://www.npmjs.com/package/expo-router');
    expect(npmPackageUrl('@clerk/expo')).toBe('https://www.npmjs.com/package/%40clerk/expo');
  });

  it('exposes the generated list with unique names', () => {
    const names = OPEN_SOURCE_LICENSES.map((e) => e.name);
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('react-native');
  });
});
