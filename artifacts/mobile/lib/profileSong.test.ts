import { describe, expect, it } from 'vitest';
import { profileSongLabel } from './profileSong';

describe('profileSongLabel', () => {
  it('reads title · artist', () => {
    expect(profileSongLabel({ title: 'blue', artist: 'yung kai' })).toBe('blue · yung kai');
  });
  it('drops a missing artist', () => {
    expect(profileSongLabel({ title: 'blue', artist: ' ' })).toBe('blue');
  });
  it('is null with no song or no title', () => {
    expect(profileSongLabel(null)).toBeNull();
    expect(profileSongLabel({ title: '', artist: 'x' })).toBeNull();
  });
});
