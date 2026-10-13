import { describe, expect, it } from 'vitest';
import { recentShareTargets } from '../shareRecents';

const person = (userId: string, accountType: 'buyer' | 'seller' = 'buyer') =>
  ({ userId, name: userId.toUpperCase(), handle: `@${userId}`, initials: userId[0].toUpperCase(), color: '#111', accountType });
const conv = (id: string, ts: number, others: ReturnType<typeof person>[], extra: Record<string, unknown> = {}) =>
  ({ id, type: 'buyer_to_buyer', participants: [person('me-1'), ...others], lastMessageTs: ts, isRequest: false, unreadCount: 0, ...extra }) as any;
const friend = (userId: string) => ({ id: `f-${userId}`, userId, name: userId, handle: `@${userId}`, initials: 'F', color: '#222', status: 'accepted', mutualFriendsCount: 0, updatedAt: '' }) as any;

describe('recentShareTargets', () => {
  it('most recent chats first, then friends, without duplicates', () => {
    const out = recentShareTargets(
      [conv('c-old', 1, [person('ana')]), conv('c-new', 9, [person('bo', 'seller')]), conv('c-mid', 5, [person('cy')])],
      [friend('cy'), friend('dee')],
      'me-1',
    );
    expect(out.map((t) => t.userId)).toEqual(['bo', 'cy', 'ana', 'dee']);
    expect(out[0]).toMatchObject({ conversationId: 'c-new', accountType: 'seller' });
    expect(out[3].conversationId).toBeUndefined();
  });
  it('skips requests, the official agent thread and groups', () => {
    const out = recentShareTargets([
      conv('req', 9, [person('x')], { isRequest: true }),
      conv('agent', 8, [person('agent')], { isOfficial: true }),
      conv('group', 7, [person('g1'), person('g2')]),
    ], [], 'me-1');
    expect(out).toEqual([]);
  });
  it('caps the row', () => {
    const many = Array.from({ length: 20 }, (_, i) => conv(`c${i}`, i, [person(`p${i}`)]));
    expect(recentShareTargets(many, [], 'me-1', 10)).toHaveLength(10);
  });
});
