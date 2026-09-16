/**
 * The shared network notice is intentionally disabled.
 *
 * Network failures remain classified and reportable by networkNotice.ts for
 * internal consumers and tests, but page-read failures must not add global
 * banners, retry affordances, or connection-related copy to the UI.
 */
export default function NetworkNoticeBanner() {
  return null;
}