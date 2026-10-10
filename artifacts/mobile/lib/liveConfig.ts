/**
 * Live video availability (BT-376). The API reports whether Agora is
 * configured at GET /api/config/live; when it is not, every Go Live entry
 * point is hidden (not disabled). See hooks/useLiveAvailable.ts.
 */

/** undefined = not known yet (or the check failed): keep the existing UI. */
export type LiveAvailability = boolean | undefined;

export function shouldShowGoLive(available: LiveAvailability): boolean {
  return available !== false;
}

export function parseLiveConfig(body: unknown): LiveAvailability {
  if (!body || typeof body !== 'object') return undefined;
  const v = (body as { liveAvailable?: unknown }).liveAvailable;
  return typeof v === 'boolean' ? v : undefined;
}
