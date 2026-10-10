import { describe, expect, it } from 'vitest';
import { suggestUsername, withSuffix } from './usernameSuggestion';

describe('suggestUsername', () => {
  it('prefers the brand name for sellers', () => {
    expect(suggestUsername({ brandName: 'Noir Field Studio', name: 'Sasha Rivera' })).toBe('noirfieldstudio');
  });
  it('uses the name with underscores, stripped of accents and symbols', () => {
    expect(suggestUsername({ name: 'Zoë  O\'Neil' })).toBe('zoe_oneil');
  });
  it('falls back to the email local part', () => {
    expect(suggestUsername({ name: 'Al', email: 'mila.rose+x@gmail.com' })).toBe('milarose');
  });
  it('returns empty when nothing usable exists', () => {
    expect(suggestUsername({ name: '李', email: '' })).toBe('');
  });
  it('caps at 30 characters', () => {
    expect(suggestUsername({ name: 'a'.repeat(50) })).toHaveLength(30);
  });
});

describe('withSuffix', () => {
  it('replaces a trailing number and stays within 30 chars', () => {
    expect(withSuffix('mila', 1)).toBe('mila1');
    expect(withSuffix('mila1', 2)).toBe('mila2');
    expect(withSuffix('a'.repeat(30), 7)).toHaveLength(30);
  });
});
