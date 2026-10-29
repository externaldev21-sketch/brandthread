/**
 * Audit (chunk 09): after the profile song changes (edit profile → back), a
 * tap must play the NEW song's preview, never resume the old one the player
 * still holds.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  status: { isLoaded: false, currentTime: 0, didJustFinish: false },
  player: { play: vi.fn(), pause: vi.fn(), replace: vi.fn() },
}));

vi.mock('expo-audio', () => ({
  setAudioModeAsync: async () => {},
  useAudioPlayer: () => h.player,
  useAudioPlayerStatus: () => h.status,
}));
vi.mock('@/contexts/AppThemeContext', () => ({ useAppTheme: () => ({ theme: { text: '#fff' } }) }));

import { ProfileSongPlayButton } from '../ProfileSongPlayButton';

const songA = { title: 'A', artist: 'X', previewUrl: 'https://cdn.test/a.m4a' };
const songB = { title: 'B', artist: 'Y', previewUrl: 'https://cdn.test/b.m4a' };

async function tap(r: ReactTestRenderer) {
  const button = r.root.findByProps({ testID: 'profile-song' });
  await act(async () => { await button.props.onPress(); });
  await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
}

describe('ProfileSongPlayButton', () => {
  it('loads the new song instead of resuming the previous one', async () => {
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<ProfileSongPlayButton song={songA as never} label="A · X" />); });
    await tap(r); // play A
    expect(h.player.replace).toHaveBeenLastCalledWith({ uri: songA.previewUrl });
    // A has played for a while; the song changes while A is still loaded.
    h.status.isLoaded = true;
    h.status.currentTime = 12;
    await act(async () => { r.update(<ProfileSongPlayButton song={songB as never} label="B · Y" />); });
    h.player.replace.mockClear();
    await tap(r); // play B
    expect(h.player.replace).toHaveBeenCalledWith({ uri: songB.previewUrl });
  });

  it('still resumes the same song from where it paused', async () => {
    h.status.isLoaded = false; h.status.currentTime = 0;
    h.player.replace.mockClear();
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<ProfileSongPlayButton song={songA as never} label="A · X" />); });
    await tap(r); // play
    h.status.isLoaded = true; h.status.currentTime = 5;
    await tap(r); // pause
    h.player.replace.mockClear();
    await tap(r); // resume
    expect(h.player.replace).not.toHaveBeenCalled();
  });
});
