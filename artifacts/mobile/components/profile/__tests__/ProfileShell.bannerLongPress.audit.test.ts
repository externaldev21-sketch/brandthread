/**
 * Audit (chunk 09): the own-profile avatar keeps "press and hold to switch
 * accounts" in banner mode too. The seller's own Profile tab always renders
 * banner mode (it passes onAddBanner), and its avatar is ProfileStoryAvatar
 * there — it used to get no onLongPress, so the switcher was unreachable.
 *
 * Source-structure test (last resort): ProfileShell pulls in the live
 * directory, FlatList choreography and expo-video; rendering it in the
 * vitest shim environment is not practical.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('../ProfileShell.tsx', import.meta.url), 'utf8');

describe('ProfileShell own-profile avatar long press', () => {
  it('passes onLongPress to every own-profile ProfileStoryAvatar (banner + video header)', () => {
    const avatars = src.split('<ProfileStoryAvatar').slice(1).map((chunk) => chunk.slice(0, chunk.indexOf('/>')));
    expect(avatars.length).toBe(2);
    for (const props of avatars) {
      expect(props).toContain('onLongPress={isOwnProfile ? avatar?.onLongPress : undefined}');
    }
  });
});
