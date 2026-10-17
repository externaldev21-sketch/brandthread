/**
 * Live streaming / replay availability (GET /api/live/status) and the human
 * copy for "not set up yet" states. The server only sends booleans and stable
 * codes; never show a raw server/env message to the seller.
 */

export const LIVE_NOT_CONFIGURED_CODE = 'LIVE_NOT_CONFIGURED';

export interface LiveAvailabilityStatus {
  streaming: { available: boolean; code: string | null };
  replays: { available: boolean; code: string | null };
}

export const LIVE_NOT_CONFIGURED_TITLE = "Live streaming isn't set up yet";
export const LIVE_NOT_CONFIGURED_BODY =
  "Brandthread hasn't switched on live streaming yet. You'll be able to go live as soon as it's ready.";
export const REPLAYS_NOT_ENABLED_NOTE = "Replays aren't enabled yet, so this live won't be saved.";
export const REPLAYS_NOT_ENABLED_TITLE = "Replays aren't enabled yet";
export const REPLAYS_NOT_ENABLED_BODY =
  "Lives aren't being recorded yet, so there's nothing to replay. Saved lives will show up here once replays are turned on.";

/** True when the error from POST /api/live/start means "not configured". */
export function isLiveNotConfiguredError(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null | undefined;
  if (e?.code === LIVE_NOT_CONFIGURED_CODE) return true;
  // Older servers answered a raw "AGORA_APP_ID not configured" string.
  return typeof e?.message === 'string' && /AGORA_APP_ID not configured/i.test(e.message);
}

/** Seller-facing message for a failed "Go live" (strips the "API 503:" prefix). */
export function liveStartErrorMessage(error: unknown): string {
  if (isLiveNotConfiguredError(error)) return LIVE_NOT_CONFIGURED_BODY;
  const message = (error as { message?: unknown } | null | undefined)?.message;
  if (typeof message === 'string' && message.trim()) {
    const stripped = message.replace(/^API \d{3}:\s*/, '').trim();
    if (stripped) return stripped;
  }
  return 'Please check your connection and try again.';
}
