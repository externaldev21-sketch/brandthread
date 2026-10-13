/**
 * Whether profile songs are on: the client flag AND the server saying a
 * licensed preview source is configured. Both default to off, so with no
 * provider set up the Music row and the profile line never render.
 */
import { useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';

let serverEnabled: boolean | null = null;

export function useProfileMusicEnabled(): boolean {
  const flag = useFeatureFlag('profileMusic');
  const api = useApi();
  const [enabled, setEnabled] = useState<boolean>(serverEnabled === true);
  useEffect(() => {
    if (!flag) return;
    if (serverEnabled !== null) { setEnabled(serverEnabled); return; }
    let active = true;
    api.profileMusic.config()
      .then((res) => { serverEnabled = !!res.enabled; if (active) setEnabled(serverEnabled); })
      .catch(() => {});
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flag]);
  return flag && enabled;
}
