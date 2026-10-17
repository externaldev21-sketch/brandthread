/**
 * "Add to Story" from the Thread share sheet: the composer receives only a
 * post id (`sharePostId`) and builds the story from the authoritative
 * GET /api/posts/:id payload — never from media/caption passed by the sender.
 */
import { buildPostUrl } from '@/lib/shareLinks';
import { isUUID } from '@/lib/engagementUtils';

export interface StoryPostShareSeed {
  postId: string;
  /** Poster (video) or first photo — what the reshare card shows. */
  imageUri: string | null;
  /** Canonical public https link (/p/:id) for the tappable link overlay. */
  postUrl: string;
  creatorName: string;
  caption: string;
}

export type StoryPostShareResult =
  | { ok: true; seed: StoryPostShareSeed }
  | { ok: false; reason: 'not_found' | 'not_shareable' };

export function storyPostShareHref(postId: string): string | null {
  if (!isUUID(postId)) return null;
  return `/buyer-story-create?sharePostId=${encodeURIComponent(postId)}`;
}

const MAX_CAPTION = 120;

export function storyPostShareSeed(raw: any, postId: string): StoryPostShareResult {
  if (!raw || typeof raw !== 'object' || raw.id !== postId || raw.deletedAt) {
    return { ok: false, reason: 'not_found' };
  }
  // Server-owned privacy decision: true only for publicly readable posts (or
  // the viewer's own). Anything else — missing included — is refused so a
  // friends-only post is never re-published into a story.
  if (raw.canReshareToStory !== true) return { ok: false, reason: 'not_shareable' };
  const postUrl = buildPostUrl(postId);
  if (!postUrl) return { ok: false, reason: 'not_shareable' };
  const isVideo = raw.mediaType === 'video';
  const firstPhoto = Array.isArray(raw.mediaUrls) ? raw.mediaUrls.find((u: unknown) => typeof u === 'string' && u) : undefined;
  const imageUri = (isVideo ? raw.thumbnailUrl : (firstPhoto || raw.mediaUrl || raw.thumbnailUrl)) || null;
  const creatorName = String(raw.seller?.brandName || raw.seller?.displayName || raw.author?.displayName || raw.displayName || 'Brandthread member');
  const fullCaption = typeof raw.caption === 'string' ? raw.caption.trim() : '';
  const caption = fullCaption.length > MAX_CAPTION ? `${fullCaption.slice(0, MAX_CAPTION - 1)}…` : fullCaption;
  return { ok: true, seed: { postId, imageUri, postUrl, creatorName, caption } };
}
