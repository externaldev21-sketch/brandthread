/**
 * The signed-out buyer preview's demo identity — the same "Ava Buyer" /
 * @ava the buyer profile tab (app/(buyer)/profile.tsx) and the account
 * switcher show. Only handed out under `?bt_preview=buyer&demo=1`; fresh
 * preview and every real account get null, so screens fall back to the
 * account's own (possibly empty) profile and never show a fake identity.
 */
import { isBuyerDevPreview, isPreviewDemoMode } from './devPreview';

export const PREVIEW_BUYER_IDENTITY = { name: 'Ava Buyer', username: 'ava' } as const;

export function previewBuyerIdentity(
  demo: boolean = isBuyerDevPreview() && isPreviewDemoMode(),
): typeof PREVIEW_BUYER_IDENTITY | null {
  return demo ? PREVIEW_BUYER_IDENTITY : null;
}

/** https://brandthread.app/u/<slug>, or null when there is no usable username. */
export function profileShareUrl(username: string | null | undefined): string | null {
  const slug = (username ?? '').trim().replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  return slug ? `https://brandthread.app/u/${slug}` : null;
}
