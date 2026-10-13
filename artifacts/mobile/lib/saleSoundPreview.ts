/**
 * Plays the bundled new-order sound once — the preview a seller hears when
 * they switch "Sale sound" on in Settings → Notifications.
 */
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

const SALE_SOUND = require('../assets/sounds/order_received.wav');

let player: AudioPlayer | null = null;

export function playSaleSoundPreview(): void {
  try {
    if (!player) player = createAudioPlayer(SALE_SOUND);
    void player.seekTo(0).catch(() => {});
    player.play();
  } catch {
    // Audio is best-effort: the setting itself already saved.
  }
}

