/**
 * "Pin to your profile" (Instagram pattern; server: api-server routes/post-pins.ts).
 * Up to 3 pinned posts list first on the author's profile grid. Pinning a 4th
 * answers PIN_LIMIT; `pinPostWithReplacePrompt` then asks to replace the
 * oldest pin and retries with `replaceOldest`.
 */
import { Alert, Platform } from 'react-native';
import { serviceRequest } from '@/lib/serviceConfig';

export const MAX_PINS = 3;

export interface PinResult { pinned: boolean; pinnedAt?: string | null; replaced?: string | null; pins: string[] }

export async function pinPost(postId: string, opts: { replaceOldest?: boolean } = {}): Promise<PinResult> {
  return serviceRequest<PinResult>(`/api/posts/${encodeURIComponent(postId)}/pin`, {
    method: 'POST',
    body: JSON.stringify(opts.replaceOldest ? { replaceOldest: true } : {}),
  }, false);
}

export async function unpinPost(postId: string): Promise<PinResult> {
  return serviceRequest<PinResult>(`/api/posts/${encodeURIComponent(postId)}/pin`, { method: 'DELETE' });
}

export async function getMyPins(): Promise<string[]> {
  const res = await serviceRequest<{ pins: Array<{ postId: string }> }>('/api/posts/pins/mine');
  return (res.pins ?? []).map((p) => p.postId);
}

export function isPinLimitError(error: unknown): boolean {
  const e = error as { status?: number; body?: string } | null;
  if (e?.status !== 409 || !e.body) return false;
  try { return JSON.parse(e.body)?.code === 'PIN_LIMIT'; } catch { return false; }
}

/** Resolves true when the user chose to replace the oldest pin. */
export type ConfirmReplace = () => Promise<boolean>;

const REPLACE_TITLE = 'Replace pinned post?';
const REPLACE_BODY = `You can pin up to ${MAX_PINS} posts. Pinning this one unpins your oldest pinned post.`;

export const confirmReplaceOldest: ConfirmReplace = () => new Promise((resolve) => {
  if (Platform.OS === 'web') {
    // react-native-web's Alert.alert is a no-op; same fallback as create-post's discard confirm.
    // eslint-disable-next-line no-alert
    resolve(typeof window !== 'undefined' && window.confirm(`${REPLACE_TITLE}\n\n${REPLACE_BODY}`));
    return;
  }
  Alert.alert(
    REPLACE_TITLE,
    REPLACE_BODY,
    [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Replace', onPress: () => resolve(true) },
    ],
    { cancelable: true, onDismiss: () => resolve(false) },
  );
});

/**
 * Pins, asking to replace the oldest pin when 3 are already pinned.
 * Returns null when the user cancelled at the replace prompt.
 */
export async function pinPostWithReplacePrompt(
  postId: string,
  confirm: ConfirmReplace = confirmReplaceOldest,
  pin: typeof pinPost = pinPost,
): Promise<PinResult | null> {
  try {
    return await pin(postId);
  } catch (error) {
    if (!isPinLimitError(error)) throw error;
    if (!(await confirm())) return null;
    return pin(postId, { replaceOldest: true });
  }
}
