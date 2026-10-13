/**
 * The sound file iOS/Android play for a new-order push. Must match the
 * bundled asset artifacts/mobile/assets/sounds/order_received.wav (registered
 * in app.json). Kept out of lib/push.ts so route tests that mock push still
 * get the real value.
 */
export const NEW_ORDER_PUSH_SOUND = "order_received.wav";
