/**
 * Product mentions in captions + "Behind the scenes" label.
 *   PUT /api/posts/:id/product-mentions  { mentions: [{ productId, label }] }
 *   PUT /api/posts/:id/labels            { bts }
 */
import { serviceRequest } from '@/lib/serviceConfig';
import { mapApiProductMentions, mentionsInCaption, type PostProductMention } from '@/lib/captionMentions';

export async function setPostProductMentions(postId: string, mentions: PostProductMention[]): Promise<PostProductMention[]> {
  const res = await serviceRequest<{ productMentions: unknown }>(
    `/api/posts/${encodeURIComponent(postId)}/product-mentions`,
    { method: 'PUT', body: JSON.stringify({ mentions: mentions.map((m) => ({ productId: m.productId, label: m.label })) }) },
  );
  return mapApiProductMentions(res?.productMentions);
}

export async function setPostBehindTheScenes(postId: string, bts: boolean): Promise<string[]> {
  const res = await serviceRequest<{ labels: string[] }>(
    `/api/posts/${encodeURIComponent(postId)}/labels`,
    { method: 'PUT', body: JSON.stringify({ bts }) },
  );
  return Array.isArray(res?.labels) ? res.labels : [];
}

/**
 * Saves a composed post's mentions + BTS label after the post itself saved.
 * Never throws: the post is already published, and these are additive.
 */
export async function syncPostExtras(
  postId: string,
  details: { caption: string; productMentions?: PostProductMention[]; bts?: boolean },
  opts: { editing?: boolean } = {},
): Promise<void> {
  if (!postId) return;
  // Only seller composers set these fields; undefined means "not offered here".
  const offered = details.productMentions !== undefined || details.bts !== undefined;
  if (!offered) return;
  const mentions = mentionsInCaption(details.caption, details.productMentions ?? []);
  const jobs: Promise<unknown>[] = [];
  if (mentions.length > 0 || opts.editing) jobs.push(setPostProductMentions(postId, mentions));
  if (details.bts || opts.editing) jobs.push(setPostBehindTheScenes(postId, !!details.bts));
  await Promise.allSettled(jobs);
}
