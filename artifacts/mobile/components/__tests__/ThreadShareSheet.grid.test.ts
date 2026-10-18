import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/services/socialService', () => ({
  MY_USER_ID: 'me',
  createOrGetConversation: vi.fn(),
  getAcceptedFriends: vi.fn(),
  getConversations: vi.fn(),
  sendMessage: vi.fn(),
}));

import { buildSendToTargets, SEND_TO_MAX, SHARE_GRID_COLUMNS, SHARE_TILE_DARK, shareTileWidth } from '@/lib/shareSheetGrid';

const source = readFileSync(resolve(process.cwd(), 'components/ThreadShareSheet.tsx'), 'utf8');

const person = (userId: string, name: string) => ({ userId, name, handle: name.toLowerCase(), initials: name.slice(0, 2).toUpperCase(), color: '#123456', accountType: 'buyer' as const });
const me = person('me', 'Me');
const conv = (id: string, other: ReturnType<typeof person>, ts: number, extra: Record<string, unknown> = {}) => ({
  id, type: 'buyer_to_buyer', participants: [me, other], lastMessageTs: ts, unreadCount: 0,
  isFriendshipActive: true, isArchived: false, isRequest: false, ...extra,
}) as never;
const friend = (userId: string, name: string) => ({
  id: `f-${userId}`, userId, name, handle: name.toLowerCase(), initials: name.slice(0, 2).toUpperCase(), color: '#654321',
  status: 'accepted', mutualFriendsCount: 0, updatedAt: '2026-10-17T00:00:00.000Z',
}) as never;

describe('Share sheet "Send to" row (#30)', () => {
  it('puts recent 1:1 chats first (newest first), then friends not already listed', () => {
    const rows = buildSendToTargets(
      [conv('c-old', person('a', 'Ann'), 1), conv('c-new', person('b', 'Ben'), 5)],
      [friend('b', 'Ben'), friend('c', 'Cy')],
    );
    expect(rows.map(r => r.userId)).toEqual(['b', 'a', 'c']);
    expect(rows[0].conversationId).toBe('c-new');
    expect(rows[2].conversationId).toBeUndefined();
  });

  it('skips requests, archived and group chats, and caps the row', () => {
    const rows = buildSendToTargets([
      conv('r', person('r', 'Req'), 9, { isRequest: true }),
      conv('x', person('x', 'Arch'), 8, { isArchived: true }),
      { ...(conv('g', person('g1', 'G1'), 7) as object), participants: [me, person('g1', 'G1'), person('g2', 'G2')] } as never,
    ], Array.from({ length: 20 }, (_, i) => friend(`f${i}`, `F${i}`)));
    expect(rows.find(r => ['r', 'x', 'g1'].includes(r.userId))).toBeUndefined();
    expect(rows).toHaveLength(SEND_TO_MAX);
  });
});

describe('Share sheet grid (#34, #35)', () => {
  it('uses an even 5-column tile width at 390pt', () => {
    expect(SHARE_GRID_COLUMNS).toBe(5);
    expect(shareTileWidth(390)).toBe(74);
    expect(shareTileWidth(390) * 5).toBeLessThanOrEqual(390 - 16);
  });

  it('gives dark sheets #2A2A2A circles', () => {
    expect(SHARE_TILE_DARK).toBe('#2A2A2A');
  });

  it('keeps a Repost slot first in the people row', () => {
    const row = source.indexOf('thread-share-row-people');
    expect(row).toBeGreaterThan(-1);
    expect(source.indexOf("label={reposted ? 'Remove repost' : 'Repost'}", row)).toBeGreaterThan(row);
    expect(source.indexOf("label={reposted ? 'Remove repost' : 'Repost'}", row)).toBeLessThan(source.indexOf('friends.map', row));
  });
});
