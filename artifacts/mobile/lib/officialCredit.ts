/** Creator-credit line for official @brandthread reposts (pure, no assets). */
import type { PostCredit } from '@/services/socialService';

/**
 * "Video: @handle" / "Photos: @handle · Name" / "Video: Name". The handle is
 * shown whether or not that creator is on Brandthread; tappability is the
 * caller's call (credit.userId).
 */
export function creditLabel(credit: Pick<PostCredit, 'handle' | 'name'>, kind: 'video' | 'photos'): string {
  const prefix = kind === 'video' ? 'Video' : 'Photos';
  const handle = credit.handle ? `@${credit.handle.replace(/^@+/, '')}` : null;
  const name = credit.name?.trim() || null;
  if (handle && name) return `${prefix}: ${handle} · ${name}`;
  return `${prefix}: ${handle ?? name ?? 'unknown creator'}`;
}
