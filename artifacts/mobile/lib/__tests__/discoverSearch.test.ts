import { describe, expect, it } from 'vitest';
import {
  RECENT_CAP, capSuggestions, dedupePeopleAgainstBrands, dedupeRecent, highlightParts,
  interleave, isFitAuthor, mergeRecent, removeRecent, toColumnsRowMajor,
} from '../discoverSearch';

describe('discoverSearch recent list', () => {
  it('puts the new term first and dedupes case/spacing-insensitively', () => {
    expect(mergeRecent(['hoodie', 'Cargo  Pants'], '  cargo pants ')).toEqual(['cargo pants', 'hoodie']);
  });

  it('caps at 10', () => {
    const list = Array.from({ length: 12 }, (_, i) => `t${i}`);
    const merged = mergeRecent(list, 'new');
    expect(merged).toHaveLength(RECENT_CAP);
    expect(merged[0]).toBe('new');
  });

  it('ignores blank terms', () => {
    expect(mergeRecent(['a'], '   ')).toEqual(['a']);
  });

  it('removes a term regardless of case', () => {
    expect(removeRecent(['Hoodie', 'denim'], 'hoodie')).toEqual(['denim']);
  });

  it('dedupes a server list keeping order', () => {
    expect(dedupeRecent(['Hoodie', 'hoodie', ' denim', ''])).toEqual(['Hoodie', 'denim']);
  });
});

describe('highlightParts', () => {
  it('splits around the first match', () => {
    expect(highlightParts('Vintage Hoodie', 'hood')).toEqual([
      { text: 'Vintage ', match: false },
      { text: 'Hood', match: true },
      { text: 'ie', match: false },
    ]);
  });

  it('returns the plain text when nothing matches', () => {
    expect(highlightParts('Denim', 'zz')).toEqual([{ text: 'Denim', match: false }]);
    expect(highlightParts('Denim', ' ')).toEqual([{ text: 'Denim', match: false }]);
  });

  it('handles a match at the start', () => {
    expect(highlightParts('denim jacket', 'denim')).toEqual([
      { text: 'denim', match: true },
      { text: ' jacket', match: false },
    ]);
  });
});

describe('suggestion grouping', () => {
  it('caps each group at 3', () => {
    const many = [1, 2, 3, 4, 5];
    expect(capSuggestions({ brands: many, people: many, products: many, hashtags: many })).toEqual({
      brands: [1, 2, 3], people: [1, 2, 3], products: [1, 2, 3], hashtags: [1, 2, 3],
    });
  });

  it('drops people already shown as a brand', () => {
    expect(dedupePeopleAgainstBrands([{ userId: 's1' }, { userId: 'b1' }], new Set(['s1']))).toEqual([{ userId: 'b1' }]);
  });
});

describe('results helpers', () => {
  it('only buyer posts are Fits', () => {
    expect(isFitAuthor('buyer')).toBe(true);
    expect(isFitAuthor('seller')).toBe(false);
    expect(isFitAuthor('both')).toBe(false);
    expect(isFitAuthor(undefined)).toBe(false);
  });

  it('interleaves two lists', () => {
    expect(interleave([1, 2, 3], ['a'])).toEqual([1, 'a', 2, 3]);
  });

  it('chunks into rows of two', () => {
    expect(toColumnsRowMajor([1, 2, 3])).toEqual([[1, 2], [3]]);
  });
});
