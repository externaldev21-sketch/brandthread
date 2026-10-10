/**
 * Where the Share store sheet can send the store link. Messages and WhatsApp
 * take the link directly; Instagram, TikTok and Snapchat have no public
 * "share a link" URL, so the link is copied first and the app opened, ready
 * to paste into a bio, story or DM. Anything that can't open falls back to
 * the system share sheet.
 *
 * Pure module (no react-native imports) so the URL building is unit tested.
 */
export type ShareTargetKey = 'messages' | 'instagram' | 'tiktok' | 'whatsapp' | 'snapchat' | 'more';

export interface ShareTarget {
  key: ShareTargetKey;
  label: string;
  /** Copy the link before opening the app (apps without a link-share URL). */
  copyFirst: boolean;
}

export const SHARE_TARGETS: readonly ShareTarget[] = [
  { key: 'messages', label: 'Messages', copyFirst: false },
  { key: 'instagram', label: 'Instagram', copyFirst: true },
  { key: 'tiktok', label: 'TikTok', copyFirst: true },
  { key: 'whatsapp', label: 'WhatsApp', copyFirst: false },
  { key: 'snapchat', label: 'Snapchat', copyFirst: true },
  { key: 'more', label: 'More', copyFirst: false },
];

/**
 * URLs to try in order for a target on a platform; empty means "use the
 * system share sheet". `os` is Platform.OS.
 */
export function shareTargetUrls(key: ShareTargetKey, link: string, os: string): string[] {
  const text = encodeURIComponent(link);
  switch (key) {
    case 'messages':
      if (os === 'ios') return [`sms:&body=${text}`];
      if (os === 'android') return [`sms:?body=${text}`];
      return [];
    case 'whatsapp':
      return os === 'web' ? [`https://wa.me/?text=${text}`] : [`whatsapp://send?text=${text}`, `https://wa.me/?text=${text}`];
    case 'instagram':
      return os === 'web' ? [] : ['instagram://app'];
    case 'tiktok':
      return os === 'web' ? [] : os === 'ios' ? ['snssdk1233://', 'tiktok://'] : ['snssdk1233://'];
    case 'snapchat':
      return os === 'web' ? [] : ['snapchat://'];
    default:
      return [];
  }
}
