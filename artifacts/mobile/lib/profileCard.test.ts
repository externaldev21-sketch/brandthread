import { describe, expect, it } from 'vitest';
import { profileInitial } from './profileCard';

describe('profileInitial', () => {
  it('uses the first letter of the name', () => {
    expect(profileInitial({ name: '  bailey rivera', handle: 'b' })).toBe('B');
  });
  it('falls back to the handle without its @', () => {
    expect(profileInitial({ name: ' ', handle: '@noir' })).toBe('N');
  });
  it('is empty before anything is typed', () => {
    expect(profileInitial({ name: '', handle: '' })).toBe('');
  });
});
