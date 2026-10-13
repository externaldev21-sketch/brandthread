import { describe, expect, it } from 'vitest';
import { friendsSavedLabel } from './friendsSaved';

const person = (name: string) => ({ userId: name, name, handle: `@${name}`, initials: 'X', avatarUrl: null });

describe('friendsSavedLabel', () => {
  it('shows nothing when nobody you follow saved it', () => {
    expect(friendsSavedLabel(null)).toBeNull();
    expect(friendsSavedLabel({ count: 0, people: [] })).toBeNull();
  });
  it('names a single person', () => {
    expect(friendsSavedLabel({ count: 1, people: [person('Maya')] })).toBe('Maya saved this');
  });
  it('falls back when the one person has no name', () => {
    expect(friendsSavedLabel({ count: 1, people: [] })).toBe('1 friend saved this');
  });
  it('counts two or more', () => {
    expect(friendsSavedLabel({ count: 3, people: [person('a'), person('b'), person('c')] })).toBe('3 friends saved this');
  });
});
