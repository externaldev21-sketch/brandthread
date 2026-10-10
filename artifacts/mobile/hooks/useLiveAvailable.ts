import { useEffect, useState } from 'react';
import { useApi } from '@/lib/api';
import { parseLiveConfig, type LiveAvailability } from '@/lib/liveConfig';

// One fetch per app session, shared by every Go Live entry point.
let cached: LiveAvailability;
let inflight: Promise<LiveAvailability> | null = null;

/**
 * Whether live video (Agora) is configured on the API. Public endpoint, safe
 * for signed-out previews. Returns undefined until known; callers hide Go Live
 * only on an explicit false (see shouldShowGoLive).
 */
export function useLiveAvailable(): LiveAvailability {
  const api = useApi();
  const [value, setValue] = useState<LiveAvailability>(cached);

  useEffect(() => {
    if (cached !== undefined) return;
    let alive = true;
    inflight ??= api.config.live()
      .then((body) => (cached = parseLiveConfig(body)))
      .catch(() => undefined)
      .finally(() => { inflight = null; });
    inflight.then((v) => { if (alive) setValue(v); });
    return () => { alive = false; };
  }, [api]);

  return value;
}
