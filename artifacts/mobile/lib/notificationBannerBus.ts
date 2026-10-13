/**
 * Minimal pub/sub so app/_layout.tsx's foreground push listener (which has
 * no JSX of its own) can hand a notification to
 * components/notifications/NotificationBanner without threading props
 * through the whole navigation tree.
 */
export type BannerPayload = {
  id: string;
  title: string;
  body: string;
  category?: string;
  data?: Record<string, unknown>;
  /** Which haptic the banner fires when it appears. Defaults to a light tap. */
  haptic?: 'light' | 'success' | 'none';
};

type Listener = (payload: BannerPayload) => void;

let listener: Listener | null = null;

export function setNotificationBannerListener(fn: Listener | null): void {
  listener = fn;
}

export function showNotificationBanner(payload: BannerPayload): void {
  listener?.(payload);
}
