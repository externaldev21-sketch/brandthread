/**
 * Seller: a new order arrives. In the foreground the in-app banner plays the
 * success haptic (lib/haptics.ts `newOrder`); the push itself carries the
 * order chime, or the standard sound when Settings › Sounds & haptics › New
 * order sound is off (stored server-side as `new_order_sound`, applied in
 * api-server lib/push.ts so background pushes respect it too).
 */
export const NEW_ORDER_TYPE = 'new_order_received';
export const NEW_ORDER_SOUND_PREF = 'new_order_sound';

export function isNewOrderNotification(data: Record<string, unknown> | null | undefined): boolean {
  return data?.type === NEW_ORDER_TYPE;
}
