import { describe, expect, it } from 'vitest';
import { compareVersions, isVersionBelow, parseVersion } from './semver';

describe('semver', () => {
  it('parses partial, prefixed and pre-release versions', () => {
    expect(parseVersion('1.2.3')).toEqual({ core: [1, 2, 3], pre: [] });
    expect(parseVersion('v2')).toEqual({ core: [2, 0, 0], pre: [] });
    expect(parseVersion(' 1.5.0-beta.1+build.7 ')).toEqual({ core: [1, 5, 0], pre: ['beta', '1'] });
    expect(parseVersion('latest')).toBeNull();
    expect(parseVersion('1.2.3.4')).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
  });

  it('compares numerically, not lexically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.0.0', '1.0')).toBe(0);
    expect(compareVersions('2.0.0', '10.0.0')).toBe(-1);
  });

  it('orders pre-releases below the release', () => {
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBe(-1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBe(-1);
    expect(compareVersions('1.0.0-beta.1', '1.0.0-beta')).toBe(1);
  });

  it('fails open on unparseable input', () => {
    expect(compareVersions('nope', '1.0.0')).toBeNull();
    expect(isVersionBelow('nope', '1.0.0')).toBe(false);
    expect(isVersionBelow('1.0.0', null)).toBe(false);
    expect(isVersionBelow('1.0.0', '1.0.1')).toBe(true);
    expect(isVersionBelow('1.0.1', '1.0.1')).toBe(false);
  });
});
