/**
 * Where Stripe sends a creator after Connect onboarding (BT-323). The old URL
 * (https://brandthread.app/api-server/seller/connect/...) 404'd. These paths
 * are served by affiliateConnectRedirectRouter (routes/affiliate-creator.ts),
 * mounted at /api/affiliate/connect with no session (Stripe's redirect has none).
 */
import { APP_SCHEME } from "../connectOnboarding";
import { getWebOrigin } from "../webOrigin";

export const CREATOR_CONNECT_RETURN_PATH = "/api/affiliate/connect/return";
export const CREATOR_CONNECT_REFRESH_PATH = "/api/affiliate/connect/refresh";

/** Phones go back to Creator program in the app; a desktop browser to the web page. */
export function creatorConnectLanding(userAgent: string | undefined, outcome: "returned" | "refresh"): string {
  const onPhone = /iPhone|iPad|iPod|Android/i.test(userAgent ?? "");
  return onPhone
    ? `${APP_SCHEME}://creator-program?payouts=${outcome}`
    : `${getWebOrigin()}/creator-program?payouts=${outcome}`;
}
