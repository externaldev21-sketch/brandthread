/**
 * Decides whether analytics may send, from plain inputs so it can be tested.
 *
 * - Web: only after the visitor grants the Analytics category in the cookie
 *   banner (lib/cookieConsent.ts). No choice, or "Necessary only", means off.
 * - iOS / Android: the app has no cookie banner and no tracking prompt
 *   (docs/app-store/privacy-labels.md), so events are allowed, but they are
 *   anonymous or keyed by the opaque account id only, and the allow-list in
 *   events.ts keeps personal data out.
 * - Dev preview (`bt_preview`) and dev-bypass sessions never send.
 */
export type AnalyticsGateInput = {
  platform: string;
  webAnalyticsConsent: boolean;
  previewSession: boolean;
  devBypass: boolean;
};

export function analyticsAllowed(input: AnalyticsGateInput): { consent: boolean; suppressed: boolean } {
  const suppressed = input.previewSession || input.devBypass;
  const consent = input.platform === 'web' ? input.webAnalyticsConsent === true : true;
  return { consent, suppressed };
}
