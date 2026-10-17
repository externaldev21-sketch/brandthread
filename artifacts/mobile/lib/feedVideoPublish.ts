/** Feed encodes finish before publication. Do not apply the normal 15-second
 * read timeout to video publishing; retries must remain explicit mutations. */
export function isFeedMediaWrite(path: string, body: unknown): boolean {
  if (!/^\/posts(?:\/[A-Za-z0-9_-]+)?$/.test(path) || !body || typeof body !== 'object') return false;
  const data = body as Record<string, unknown>;
  return data.mediaType === 'video' || ['mediaPath', 'mediaUrl', 'mediaUrls', 'slides']
    .some(key => data[key] != null);
}
