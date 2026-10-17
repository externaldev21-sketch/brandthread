import { describe, expect, it } from 'vitest';
import licenses from '../content/open-source-licenses.json';
// @ts-expect-error -- plain .mjs build script without type declarations
import { buildLicenseEntries, isShippedDependency, normalizeLicense } from './generate-licenses.mjs';

describe('generate-licenses', () => {
  it('normalises the historical package.json license shapes', () => {
    expect(normalizeLicense({ license: 'MIT' })).toBe('MIT');
    expect(normalizeLicense({ license: { type: 'BSD-3-Clause' } })).toBe('BSD-3-Clause');
    expect(normalizeLicense({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] })).toBe('(MIT OR Apache-2.0)');
    expect(normalizeLicense({})).toBe('UNKNOWN');
  });

  it('skips own packages, type stubs and build-only tooling', () => {
    expect(isShippedDependency('@workspace/db', 'workspace:*')).toBe(false);
    expect(isShippedDependency('upload-live-activity', 'link:./modules/x')).toBe(false);
    expect(isShippedDependency('@types/react', '^19')).toBe(false);
    expect(isShippedDependency('vitest', '^4')).toBe(false);
    expect(isShippedDependency('expo-router', '~57')).toBe(true);
  });

  it('reads version + license from the installed package and sorts by name', () => {
    const installed: Record<string, object> = { b: { version: '2.0.0', license: 'ISC' }, a: { version: '1.0.0', license: 'MIT' } };
    expect(buildLicenseEntries({ b: '^2', a: '^1', missing: '^3' }, (n: string) => installed[n] ?? null)).toEqual([
      { name: 'a', version: '1.0.0', license: 'MIT' },
      { name: 'b', version: '2.0.0', license: 'ISC' },
      { name: 'missing', version: '^3', license: 'UNKNOWN' },
    ]);
  });

  it('ships a well-formed generated list', () => {
    expect(licenses.length).toBeGreaterThan(0);
    for (const entry of licenses) {
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.version).toBe('string');
      expect(typeof entry.license).toBe('string');
    }
  });
});
