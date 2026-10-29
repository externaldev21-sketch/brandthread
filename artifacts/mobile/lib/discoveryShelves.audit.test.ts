import { describe, expect, it } from 'vitest';
import { followersLabel } from './discoveryShelves';

describe('followersLabel above a million', () => {
  it('uses M instead of "1000K" / "2500K"', () => {
    expect(followersLabel(999_960)).toBe('1M followers');
    expect(followersLabel(2_500_000)).toBe('2.5M followers');
  });

  it('keeps the K form below that', () => {
    expect(followersLabel(1250)).toBe('1.3K followers');
    expect(followersLabel(999_900)).toBe('999.9K followers');
  });
});
