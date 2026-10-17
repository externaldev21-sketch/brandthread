/** Shared, account-scoped write contract for feed and post viewers. */
export type PostAction = 'like' | 'save' | 'repost';
export type PostEngagementPatch = {
  liked?: boolean; likes?: number; saved?: boolean; saves?: number;
  reposted?: boolean; reposts?: number; shares?: number;
};
export interface PostActionApi {
  posts: { interact(id: string, body: { type: 'like' | 'repost' | 'share'; value?: string }): Promise<{ action: string; count?: number }> };
  buyer: { saved: {
    save(body: { type: string; targetId: string; title: string; subtitle?: string; accentColor?: string }): Promise<unknown>;
    remove(id: string): Promise<unknown>;
  } };
}
const pending = new Set<string>();
const listeners = new Set<(account: string, postId: string, patch: PostEngagementPatch) => void>();
const key = (account: string, id: string, kind: string) => JSON.stringify([account, id, kind]);
export const postActionPending = (account: string, id: string, kind: PostAction) => pending.has(key(account, id, kind));
export function publishPostEngagement(account: string, id: string, patch: PostEngagementPatch) {
  listeners.forEach(listener => listener(account, id, patch));
}
export function subscribePostEngagement(account: string, listener: (id: string, patch: PostEngagementPatch) => void) {
  const scoped = (owner: string, id: string, patch: PostEngagementPatch) => { if (owner === account) listener(id, patch); };
  listeners.add(scoped);
  return () => { listeners.delete(scoped); };
}
export async function persistPostAction(input: {
  api: PostActionApi; account: string; postId: string; kind: PostAction;
  enabled: boolean; count: number; title?: string; subtitle?: string; accentColor?: string;
}): Promise<PostEngagementPatch> {
  const { api, account, postId, kind, enabled } = input;
  if (!account) throw new Error('Sign in to update this post');
  const lock = key(account, postId, kind);
  if (pending.has(lock)) throw new Error('This action is already being saved');
  pending.add(lock);
  try {
    let count = Math.max(0, input.count + (enabled ? 1 : -1));
    if (kind === 'save') {
      if (enabled) await api.buyer.saved.save({ type: 'post', targetId: postId, title: input.title || 'Post', subtitle: input.subtitle, accentColor: input.accentColor });
      else await api.buyer.saved.remove(postId);
    } else {
      const result = await api.posts.interact(postId, { type: kind, value: enabled ? 'add' : 'remove' });
      if ((result.action === 'added') !== enabled) throw new Error('Post action was not saved');
      if (typeof result.count === 'number') count = result.count;
    }
    const patch: PostEngagementPatch = kind === 'like' ? { liked: enabled, likes: count }
      : kind === 'save' ? { saved: enabled, saves: count } : { reposted: enabled, reposts: count };
    publishPostEngagement(account, postId, patch);
    return patch;
  } finally { pending.delete(lock); }
}
