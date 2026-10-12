/**
 * The banner a profile screen renders (TikTok-style profile banner).
 *
 *  - `server`: the banner from the screen's profile response
 *    (`resolveProfileBanner(data)`), null while unset / loading.
 *  - Own profiles also apply a banner change made in Edit profile the moment
 *    it lands (profile event), before the next refetch.
 *  - The dev web preview with `&demo=1&banner=image|video` shows a sample.
 */
import { useEffect, useState } from 'react';
import { subscribeProfileEvents } from '@/lib/profileEvents';
import { previewProfileBanner } from '@/lib/previewProfileBanner';
import type { ProfileBanner } from './profileBannerRules';

export function useProfileBannerState({
  server,
  ownerId,
  own,
}: {
  server: ProfileBanner | null;
  ownerId?: string | null;
  own: boolean;
}): ProfileBanner | null {
  // Opted out of React Compiler memoization: the dev-preview sample below
  // reads the URL, which a tab screen can see change after it first renders.
  'use no memo';
  const [local, setLocal] = useState<{ banner: ProfileBanner | null } | null>(null);

  // A fresh server value replaces any local change.
  useEffect(() => { setLocal(null); }, [server?.type, server?.url, server?.posterUrl]);

  useEffect(() => {
    if (!own) return undefined;
    return subscribeProfileEvents((event) => {
      if (event.type !== 'banner') return;
      if (ownerId && event.ownerId && event.ownerId !== ownerId) return;
      setLocal({ banner: event.banner });
    });
  }, [own, ownerId]);

  if (local) return local.banner;
  return server ?? previewProfileBanner(own ? 'own' : 'other');
}
