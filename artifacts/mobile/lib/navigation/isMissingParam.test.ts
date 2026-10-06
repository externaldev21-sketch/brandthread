import { describe, expect, it } from 'vitest';
import { isMissingParam } from './isMissingParam';

describe('isMissingParam', () => {
  it('treats absent and placeholder values as missing', () => {
    expect(isMissingParam(undefined)).toBe(true);
    expect(isMissingParam(null)).toBe(true);
    expect(isMissingParam('')).toBe(true);
    expect(isMissingParam('   ')).toBe(true);
    expect(isMissingParam('undefined')).toBe(true);
    expect(isMissingParam('null')).toBe(true);
    expect(isMissingParam([])).toBe(true);
    expect(isMissingParam([''])).toBe(true);
  });

  it('accepts real ids, including the first entry of an array param', () => {
    expect(isMissingParam('ord_123')).toBe(false);
    expect(isMissingParam('0')).toBe(false);
    expect(isMissingParam(['abc', 'def'])).toBe(false);
  });
});
