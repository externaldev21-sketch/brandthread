/** Shared rules for the quote-post composer (app/quote-post.tsx). Pure, no RN imports. */
export const QUOTE_MAX_LENGTH = 2200;

/** Route that opens the quote composer for a post, with an instant preview of the original. */
export function quotePostHref(post: { postId: string; author?: string; caption?: string; thumb?: string; mediaType?: string }): string {
  const q = new URLSearchParams();
  q.set('postId', post.postId);
  if (post.author) q.set('author', post.author);
  if (post.caption) q.set('caption', post.caption.slice(0, 280));
  if (post.thumb && /^https?:\/\//i.test(post.thumb)) q.set('thumb', post.thumb);
  if (post.mediaType) q.set('mediaType', post.mediaType);
  return `/quote-post?${q.toString()}`;
}

export function quoteErrorMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'QUOTE_TARGET_UNAVAILABLE' || code === 'QUOTE_OF_UNAVAILABLE') return 'This post is no longer available to quote.';
  if (code === 'REPOSTS_DISABLED') return 'The author turned off reposts for this post.';
  if (code === 'CONTENT_REJECTED') return 'This caption can’t be posted. Edit it and try again.';
  return 'Could not post your quote. Try again.';
}
