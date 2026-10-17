/**
 * GET /api/live/status as a hook: is live streaming switched on for this
 * server (AGORA_APP_ID set)? The LIVE tab, a show link and the seller's
 * go-live setup all read this first so a missing key shows one clean
 * "LIVE isn't available yet" state instead of a broken player or a failed
 * start.
 *
 * `unknown` (offline, signed-out preview) never blocks anything: screens
 * carry on and surface the real error if a call fails.
 */
import { useEffect, useState } from 'react';
import { serviceRequest } from '@/lib/serviceConfig';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { getLiveStreamProvider } from './liveProvider';
import type { LiveAvailabilityStatus } from './liveAvailability';

export type LiveAvailabilityState = 'loading' | 'available' | 'unavailable' | 'unknown';

let cached: LiveAvailabilityState | null = null;

export function liveStateFromStatus(status: LiveAvailabilityStatus | null | undefined): LiveAvailabilityState {
  if (!status?.streaming) return 'unknown';
  return status.streaming.available ? 'available' : 'unavailable';
}

async function loadLiveAvailability(): Promise<LiveAvailabilityState> {
  // `?bt_preview=…&demo=1` plays the bundled preview shows, which need no
  // server keys — the same opt-in every other preview dataset uses.
  if (getLiveStreamProvider().id === 'preview' && isPreviewDemoMode()) return 'available';
  try {
    return liveStateFromStatus(await serviceRequest<LiveAvailabilityStatus>('/api/live/status', {}, false));
  } catch {
    return 'unknown';
  }
}

export function useLiveAvailability(): LiveAvailabilityState {
  const [state, setState] = useState<LiveAvailabilityState>(cached ?? 'loading');
  useEffect(() => {
    let alive = true;
    void loadLiveAvailability().then(next => {
      // Only a definite answer is worth remembering across screens.
      if (next !== 'unknown') cached = next;
      if (alive) setState(next);
    });
    return () => { alive = false; };
  }, []);
  return state;
}

/** Tests only. */
export function resetLiveAvailabilityCache(): void {
  cached = null;
}
