import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/CachedImage', () => ({ CachedImage: () => null }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/hooks/useColors', () => ({ useColors: () => ({}) }));
vi.mock('@expo/vector-icons', () => ({ Feather: { glyphMap: {} } }));

import { initialsOf } from '../CommunityAvatar';

describe('community monogram initials', () => {
  it('uses the first two meaningful words', () => {
    expect(initialsOf('Cut and Sew Club')).toBe('CS');
    expect(initialsOf('Selvedge Lab')).toBe('SL');
    expect(initialsOf('The Archive')).toBe('A');
    expect(initialsOf('  denim  ')).toBe('D');
    expect(initialsOf('#1 Fans')).toBe('1F');
    expect(initialsOf('')).toBe('?');
  });
});
