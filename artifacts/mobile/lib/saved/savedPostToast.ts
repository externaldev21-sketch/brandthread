/**
 * Instagram's saved-post bar (F6 item 89): after a post is saved, a bar slides
 * up with the post's thumbnail, "Saved" and a "Save to collection" action that
 * opens the "Save to…" sheet for that post. Built here (pure) and shown by the
 * app-root SaveHeartHost via the save-heart bus.
 */
import type { SaveHeartToast } from './saveHeartBus';

export interface SavedPostInfo {
  id: string;
  caption?: string | null;
  creator?: string | null;
  accentColor?: string | null;
  contentType?: 'photo' | 'slideshow' | 'video' | string;
  mediaUris?: string[] | null;
  videoPosterUri?: string | null;
}

/** Title the server stores for a saved post (it requires one): caption, else "<creator>'s post". */
export function savedPostTitle(post: Pick<SavedPostInfo, 'caption' | 'creator'>): string {
  return post.caption?.trim() || `${post.creator?.trim() || 'Post'}'s post`;
}

/** A still for the bar: the poster for videos, else the first photo. Remote URLs only. */
export function savedPostThumbnail(post: SavedPostInfo): string | undefined {
  const candidates = post.contentType === 'video'
    ? [post.videoPosterUri]
    : [post.mediaUris?.[0], post.videoPosterUri];
  return candidates.find((uri): uri is string => typeof uri === 'string' && /^https?:\/\//i.test(uri));
}

export function savedPostToast(post: SavedPostInfo): SaveHeartToast {
  const thumbnailUri = savedPostThumbnail(post);
  return {
    message: 'Saved',
    thumbnailUri,
    actionLabel: 'Save to collection',
    action: {
      kind: 'save-to-collection',
      thumbnailUri,
      item: {
        type: 'post',
        targetId: post.id,
        title: savedPostTitle(post),
        subtitle: post.creator ?? undefined,
        accentColor: post.accentColor ?? undefined,
      },
    },
  };
}
