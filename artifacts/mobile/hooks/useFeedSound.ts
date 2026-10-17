/**
 * Feed sound: always on, like TikTok. There is no mute control — a buyer who
 * doesn't want sound pauses the video instead.
 *
 * Native: on from the first frame. The iOS audio session is set to play even
 * with the silent switch on and to stop other apps' audio while feed video
 * plays (TikTok's behaviour).
 *
 * Web: browsers block unmuted autoplay until the page gets a user gesture, so
 * the feed starts muted only until the first tap/scroll/key press anywhere,
 * then unmutes for good (every later video plays with sound). No UI either way.
 */
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { setAudioModeAsync } from 'expo-audio';

/** Events that count as the user gesture browsers require before unmuted playback. */
export const WEB_SOUND_UNLOCK_EVENTS = ['pointerdown', 'touchstart', 'keydown', 'wheel'] as const;

let webSoundUnlocked = false;

export function initialFeedSoundOn(os: string = Platform.OS): boolean {
  return os !== 'web' || webSoundUnlocked;
}

export function useFeedSound(): boolean {
  const [soundOn, setSoundOn] = useState(() => initialFeedSoundOn());

  useEffect(() => {
    if (Platform.OS === 'web') return;
    void setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'doNotMix' }).catch(() => {});
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || soundOn || typeof window === 'undefined') return undefined;
    const unlock = () => {
      webSoundUnlocked = true;
      setSoundOn(true);
    };
    for (const name of WEB_SOUND_UNLOCK_EVENTS) window.addEventListener(name, unlock, { once: true, capture: true, passive: true });
    return () => {
      for (const name of WEB_SOUND_UNLOCK_EVENTS) window.removeEventListener(name, unlock, { capture: true });
    };
  }, [soundOn]);

  return soundOn;
}
