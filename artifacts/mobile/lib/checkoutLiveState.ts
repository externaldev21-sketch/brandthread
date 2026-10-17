/** Pure half of lib/checkoutLive.ts (no React Native imports, so it unit-tests in node). */
export type CheckoutLive = {
  status: 'checking' | 'live' | 'off';
  applePay: boolean;
  googlePay: boolean;
};

export type ServerConfig = { live?: boolean; applePay?: boolean; googlePay?: boolean };

export const CHECKING: CheckoutLive = { status: 'checking', applePay: false, googlePay: false };
export const OFF: CheckoutLive = { status: 'off', applePay: false, googlePay: false };

/** Pure: the app's key + the server's answer → the state the screens render. */
export function resolveCheckoutLive(publishableKey: string, server: ServerConfig | null): CheckoutLive {
  if (!publishableKey.trim() || !server || server.live !== true) return OFF;
  return { status: 'live', applePay: server.applePay === true, googlePay: server.googlePay === true };
}
