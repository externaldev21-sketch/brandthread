/**
 * Seller "sale alert" preferences — the cha-ching sound and the success
 * haptic a seller gets when a new order lands (Settings → Notifications →
 * New order alerts).
 *
 * Both live in `users.notification_preferences` under their own keys (not
 * the category map), default ON, and only ever change how a new-order alert
 * feels — never whether it is delivered. That stays with the `new_orders`
 * category and the master push switch.
 */

export const SALE_SOUND_KEY = "sale_sound";
export const SALE_HAPTIC_KEY = "sale_haptic";

/** Must match the file bundled at artifacts/mobile/assets/sounds/. */
export const SALE_SOUND_FILE = "order_received.wav";
/** Android channel registered with the custom sound in the mobile root layout. */
export const SALE_SOUND_CHANNEL = "orders";
export const DEFAULT_CHANNEL = "default";

export type SaleAlertPrefs = { saleSound: boolean; saleHaptic: boolean };

export function readSaleAlertPrefs(preferences: unknown): SaleAlertPrefs {
  const prefs = preferences && typeof preferences === "object" && !Array.isArray(preferences)
    ? (preferences as Record<string, unknown>)
    : {};
  return {
    saleSound: prefs[SALE_SOUND_KEY] !== false,
    saleHaptic: prefs[SALE_HAPTIC_KEY] !== false,
  };
}

/**
 * Sound + Android channel for a seller's new-order push. With the sale sound
 * off the alert still arrives, with the platform's standard sound.
 */
export function newOrderPushDelivery(preferences: unknown): { pushSound: string | null; pushChannelId: string } {
  const { saleSound } = readSaleAlertPrefs(preferences);
  return saleSound
    ? { pushSound: SALE_SOUND_FILE, pushChannelId: SALE_SOUND_CHANNEL }
    : { pushSound: null, pushChannelId: DEFAULT_CHANNEL };
}

/** Validates a PUT body's `saleSound` / `saleHaptic` and returns the JSON patch. */
export function saleAlertPatch(body: { saleSound?: unknown; saleHaptic?: unknown }):
  | { ok: true; patch: Record<string, boolean> }
  | { ok: false; error: string } {
  const patch: Record<string, boolean> = {};
  if (body.saleSound !== undefined) {
    if (typeof body.saleSound !== "boolean") return { ok: false, error: "saleSound must be a boolean" };
    patch[SALE_SOUND_KEY] = body.saleSound;
  }
  if (body.saleHaptic !== undefined) {
    if (typeof body.saleHaptic !== "boolean") return { ok: false, error: "saleHaptic must be a boolean" };
    patch[SALE_HAPTIC_KEY] = body.saleHaptic;
  }
  return { ok: true, patch };
}
