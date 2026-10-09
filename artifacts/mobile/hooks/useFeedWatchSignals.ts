import { useEffect } from 'react';
import type { VideoPlayer } from 'expo-video';
import { useAuth } from '@clerk/expo';
import { createWatchSession } from '@/lib/feedWatchSession';
import { trackFeedEvent } from '@/services/feedEventsService';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Records watch time, rewatches and skips for a feed video as ranking
 * signals. A session runs while the clip is the active page and ends when
 * the viewer moves to another page; pausing or opening comments doesn't end
 * it. Signed-in only — the signed-out preview never calls the API.
 */
export function useFeedWatchSignals(player: VideoPlayer, active: boolean, postId?: string | null) {
  const { isSignedIn } = useAuth();
  useEffect(() => {
    if (!active || !isSignedIn || !postId || !UUID_RE.test(postId)) return;
    if (player.timeUpdateEventInterval <= 0) player.timeUpdateEventInterval = 0.5;
    const session = createWatchSession();
    const subscription = player.addListener('timeUpdate', ({ currentTime }) => {
      session.onTime(currentTime, player.duration, player.playing);
    });
    return () => {
      subscription.remove();
      for (const signal of session.finish()) {
        trackFeedEvent(postId, signal.type, 'value' in signal ? signal.value : undefined);
      }
    };
  }, [active, isSignedIn, player, postId]);
}
