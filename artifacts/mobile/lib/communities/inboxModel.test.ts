import { describe, expect, it } from 'vitest';
import type { Community } from './types';
import { loudUnreadTotal } from './types';
import {
  communityMatchesQuery, communityMuteActionLabel, communityPreviewText, communityRowPresentation, mergeInboxRows,
} from './inboxModel';

function community(over: Partial<Community> = {}): Community {
  return {
    id: 'c1', name: 'Embroidery', slug: 'embroidery', description: 'Stitch talk', kind: 'official', verified: true,
    visibility: 'public', requireApproval: false, memberCount: 10, joined: true, role: 'member', muted: false,
    unreadCount: 0, createdAt: '2026-01-01T00:00:00.000Z', ...over,
  };
}

describe('communityPreviewText', () => {
  it('prefixes the sender first name', () => {
    expect(communityPreviewText(community({ lastMessage: 'new drop tonight', lastMessageSenderName: 'Mara Lopez' }))).toBe('Mara: new drop tonight');
  });
  it('falls back to the description, then to an empty line', () => {
    expect(communityPreviewText(community())).toBe('Stitch talk');
    expect(communityPreviewText(community({ description: '  ' }))).toBe('No messages yet');
  });
  it('omits the prefix when the sender is unknown', () => {
    expect(communityPreviewText(community({ lastMessage: 'hey' }))).toBe('hey');
  });
});

describe('communityRowPresentation', () => {
  it('unmuted unread is loud', () => {
    expect(communityRowPresentation({ muted: false, unreadCount: 3 })).toMatchObject({ loud: true, quietUnread: false, showMutedGlyph: false, countLabel: '3' });
  });
  it('muted unread is quiet with the muted glyph', () => {
    expect(communityRowPresentation({ muted: true, unreadCount: 5 })).toMatchObject({ loud: false, quietUnread: true, showMutedGlyph: true });
  });
  it('muted read keeps the glyph only; read unmuted shows nothing', () => {
    expect(communityRowPresentation({ muted: true, unreadCount: 0 })).toMatchObject({ loud: false, quietUnread: false, showMutedGlyph: true });
    expect(communityRowPresentation({ muted: false, unreadCount: 0 })).toMatchObject({ loud: false, quietUnread: false, showMutedGlyph: false });
  });
  it('caps the count label', () => {
    expect(communityRowPresentation({ muted: false, unreadCount: 250 }).countLabel).toBe('99+');
  });
});

describe('communityMuteActionLabel', () => {
  it('toggles copy', () => {
    expect(communityMuteActionLabel({ muted: false }).label).toBe('Mute');
    expect(communityMuteActionLabel({ muted: true })).toEqual({ label: 'Unmute', icon: 'bell' });
  });
});

describe('mergeInboxRows', () => {
  type Dm = { id: string; ts?: number; pinned?: boolean };
  const opts = { getKey: (d: Dm) => d.id, getTs: (d: Dm) => d.ts, isPinned: (d: Dm) => !!d.pinned };
  const keys = (rows: ReturnType<typeof mergeInboxRows<Dm>>) => rows.map((r) => r.key);

  it('interleaves by recency and keeps pinned DMs first', () => {
    const dms: Dm[] = [{ id: 'agent', pinned: true, ts: 1 }, { id: 'd1', ts: 500 }, { id: 'd2', ts: 100 }];
    const cs = [community({ id: 'a', lastMessageTs: 300 }), community({ id: 'b', lastMessageTs: 900 }), community({ id: 'c', lastMessageTs: 50 })];
    expect(keys(mergeInboxRows(dms, cs, opts))).toEqual(['agent', 'community-b', 'd1', 'community-a', 'd2', 'community-c']);
  });
  it('does not reorder DMs and handles empty inputs', () => {
    const dms: Dm[] = [{ id: 'x', ts: 1 }, { id: 'y', ts: 9 }];
    expect(keys(mergeInboxRows(dms, [], opts))).toEqual(['x', 'y']);
    expect(keys(mergeInboxRows([], [community({ id: 'z' })], opts))).toEqual(['community-z']);
  });
  it('places a community with no messages by its creation time', () => {
    const dms: Dm[] = [{ id: 'old', ts: Date.parse('2025-01-01') }];
    expect(keys(mergeInboxRows(dms, [community({ id: 'n' })], opts))).toEqual(['community-n', 'old']);
  });
});

describe('communityMatchesQuery', () => {
  it('matches name or last message', () => {
    expect(communityMatchesQuery(community({ name: 'Denim Heads' }), 'denim')).toBe(true);
    expect(communityMatchesQuery(community({ lastMessage: 'selvedge' }), 'selv')).toBe(true);
    expect(communityMatchesQuery(community(), 'zzz')).toBe(false);
    expect(communityMatchesQuery(community(), '')).toBe(true);
  });
});

describe('tab badge total', () => {
  it('excludes muted communities', () => {
    expect(loudUnreadTotal([{ muted: false, unreadCount: 2 }, { muted: true, unreadCount: 9 }])).toBe(2);
    expect(loudUnreadTotal([{ muted: true, unreadCount: 4 }])).toBe(0);
  });
});
