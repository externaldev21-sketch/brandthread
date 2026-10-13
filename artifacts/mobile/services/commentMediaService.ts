/**
 * Photo replies in comments (F6 item 83).
 *
 *  1. uploadCommentPhoto — POST /api/comment-media/upload. The server
 *     re-encodes, screens and stores the photo; a rejected photo throws
 *     ApiError(422, code IMAGE_REJECTED) and never gets a URL.
 *  2. createComment — POST /api/posts/:postId/comments with the optional
 *     `media: { id }` of that upload. The body may be empty when a photo is
 *     attached.
 */
import { serviceRequest } from '@/lib/serviceConfig';
import type { CommentMedia, CreatedComment } from '@/lib/safetyTypes';

export async function uploadCommentPhoto(body: { data: string; mimeType: string }): Promise<CommentMedia> {
  const res = await serviceRequest<{ media: CommentMedia }>('/api/comment-media/upload', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.media;
}

export function createComment(
  postId: string,
  input: { body: string; parentId?: string | null; mediaId?: string | null },
): Promise<CreatedComment> {
  return serviceRequest<CreatedComment>(`/api/posts/${encodeURIComponent(postId)}/comments`, {
    method: 'POST',
    body: JSON.stringify({
      body: input.body,
      ...(input.parentId ? { parentId: input.parentId } : {}),
      ...(input.mediaId ? { media: { id: input.mediaId } } : {}),
    }),
  });
}
