import { describe, it, expect, vi } from 'vitest';
import { persistPostAction, postActionPending, publishPostEngagement, subscribePostEngagement, type PostActionApi } from '../lib/postEngagement';

function client() {
  return {
    posts: { interact: vi.fn(async (_id: string, body: { value?: string }) => ({ action: body.value === 'remove' ? 'removed' : 'added', count: 12 })) },
    buyer: { saved: { save: vi.fn(async () => ({})), remove: vi.fn(async () => ({})) } },
  };
}
describe('One persisted rail action contract for feeds and viewers', () => {
  for (const kind of ['like', 'repost'] as const) for (const enabled of [true, false]) {
    it(`${kind} ${enabled ? 'adds' : 'removes'} explicitly and publishes authoritative counts`, async () => {
      const api = client();
      const listener = vi.fn(); const off = subscribePostEngagement('buyer', listener);
      try {
        const patch = await persistPostAction({ api: api as PostActionApi, account: 'buyer', postId: 'post', kind, enabled, count: 2 });
        expect(api.posts.interact).toHaveBeenCalledWith('post', { type: kind, value: enabled ? 'add' : 'remove' });
        expect(patch).toEqual(kind === 'like' ? { liked: enabled, likes: 12 } : { reposted: enabled, reposts: 12 });
        expect(listener).toHaveBeenCalledWith('post', patch);
      } finally { off(); }
    });
  }
  it('saves with required metadata and unsaves by post ID, not saved-row ID', async () => {
    const api = client();
    await persistPostAction({ api, account: 'buyer', postId: 'post', kind: 'save', enabled: true, count: 0, title: 'Caption' });
    expect(api.buyer.saved.save).toHaveBeenCalledWith(expect.objectContaining({ type: 'post', targetId: 'post', title: 'Caption' }));
    await persistPostAction({ api, account: 'buyer', postId: 'post', kind: 'save', enabled: false, count: 1 });
    expect(api.buyer.saved.remove).toHaveBeenCalledWith('post');
  });
  it('does not announce failed persistence and unlocks for explicit retry', async () => {
    const api = client(); api.posts.interact.mockRejectedValueOnce(new Error('offline'));
    const listener = vi.fn(); const off = subscribePostEngagement('buyer', listener);
    try {
      await expect(persistPostAction({ api, account: 'buyer', postId: 'post', kind: 'like', enabled: true, count: 0 })).rejects.toThrow('offline');
      expect(listener).not.toHaveBeenCalled();
      expect(postActionPending('buyer', 'post', 'like')).toBe(false);
    } finally { off(); }
  });
  it('never delivers one account’s engagement to a different account', () => {
    const listener = vi.fn(); const off = subscribePostEngagement('buyer-b', listener);
    publishPostEngagement('buyer-a', 'post', { saved: true });
    expect(listener).not.toHaveBeenCalled(); off();
    publishPostEngagement('buyer-b', 'post', { saved: true });
    expect(listener).not.toHaveBeenCalled();
  });
  it('deduplicates a rapid second tap while the write is pending', async () => {
    const api = client(); let finish!: (value: { action: string; count: number }) => void;
    api.posts.interact.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const input = { api, account: 'buyer', postId: 'post', kind: 'like' as const, enabled: true, count: 0 };
    const first = persistPostAction(input);
    expect(postActionPending('buyer', 'post', 'like')).toBe(true);
    await expect(persistPostAction(input)).rejects.toThrow('already');
    finish({ action: 'added', count: 1 }); await first;
    expect(api.posts.interact).toHaveBeenCalledTimes(1);
  });
});
