/**
 * Foreground feedback for an incoming push (components/notifications/
 * NotificationBanner). New orders get the bundled order sound once plus one
 * success haptic, unless the seller turned "New order sound" off — the server
 * then flags the push `silent` and the banner stays quiet.
 */
import { Platform } from 'react-native';
import { hapticLight, hapticSuccess } from '@/lib/haptics';

export const NEW_ORDER_PUSH_TYPE = 'new_order_received';

export type BannerFeedback = 'none' | 'tap' | 'newOrder';

export function isNewOrderPush(data: Record<string, unknown> | null | undefined): boolean {
  return data?.type === NEW_ORDER_PUSH_TYPE;
}

/** Which feedback a foreground banner gives for this push's data. */
export function bannerFeedbackFor(data: Record<string, unknown> | null | undefined): BannerFeedback {
  if (!isNewOrderPush(data)) return 'tap';
  return data?.silent === true ? 'none' : 'newOrder';
}

async function playNewOrderSound(): Promise<void> {
  const [{ createAudioPlayer }, { NEW_ORDER_SOUND }] = await Promise.all([
    import('expo-audio'), import('@/lib/newOrderSoundSource'),
  ]);
  const player = createAudioPlayer(NEW_ORDER_SOUND);
  const sub = player.addListener('playbackStatusUpdate', (status: { didJustFinish?: boolean }) => {
    if (!status.didJustFinish) return;
    sub.remove();
    player.remove();
  });
  player.play();
}

/** Play the banner's feedback. Never throws. */
export function playBannerFeedback(data: Record<string, unknown> | null | undefined): void {
  if (Platform.OS === 'web') return;
  const feedback = bannerFeedbackFor(data);
  if (feedback === 'none') return;
  if (feedback === 'tap') {
    hapticLight();
    return;
  }
  hapticSuccess();
  // Lazy so the audio module only loads when a new order actually arrives.
  void playNewOrderSound().catch(() => {});
}
