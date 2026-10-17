import { describe, expect, it } from 'vitest';
import {
  conversationMatchesInboxFilter, communityMatchesInboxFilter, isConversationMuted, INBOX_FILTERS,
  inboxFilterLabel, type InboxFilter,
} from '@/lib/inboxFilter';

const NOW = Date.parse('2026-10-17T12:00:00.000Z');

type Conv = Parameters<typeof conversationMatchesInboxFilter>[0];
function conv(overrides: Partial<Conv> = {}): Conv {
  return {
    type: 'buyer_to_buyer',
    participants: [
      { userId: 'me', name: 'Me', handle: '@me', initials: 'M', color: '#000', accountType: 'buyer' as const },
      { userId: 'them', name: 'Them', handle: '@them', initials: 'T', color: '#000', accountType: 'buyer' as const },
    ],
    unreadCount: 0,
    isArchived: false,
    isRequest: false,
    isPinned: undefined,
    mutedUntil: undefined,
    ...overrides,
  };
}

const matches = (c: Conv, f: InboxFilter) => conversationMatchesInboxFilter(c, f, NOW);

describe('conversationMatchesInboxFilter', () => {
  it('All shows every non-archived, non-request chat', () => {
    expect(matches(conv(), 'all')).toBe(true);
    expect(matches(conv({ isArchived: true }), 'all')).toBe(false);
    expect(matches(conv({ isRequest: true }), 'all')).toBe(false);
  });

  it('Archived shows only archived chats (never requests)', () => {
    expect(matches(conv({ isArchived: true }), 'archived')).toBe(true);
    expect(matches(conv(), 'archived')).toBe(false);
    expect(matches(conv({ isArchived: true, isRequest: true }), 'archived')).toBe(false);
  });

  it('every other filter excludes archived chats', () => {
    const archivedUnreadPinned = conv({ isArchived: true, unreadCount: 3, isPinned: true });
    for (const f of ['unread', 'friends', 'pinned', 'muted', 'shops', 'groups'] as InboxFilter[]) {
      expect(matches(archivedUnreadPinned, f)).toBe(false);
    }
  });

  it('Unread / Pinned', () => {
    expect(matches(conv({ unreadCount: 2 }), 'unread')).toBe(true);
    expect(matches(conv({ unreadCount: 0 }), 'unread')).toBe(false);
    expect(matches(conv({ isPinned: true }), 'pinned')).toBe(true);
    expect(matches(conv(), 'pinned')).toBe(false);
  });

  it('Friends = buyer_to_buyer 1:1, Shops = any buyer_to_seller type', () => {
    expect(matches(conv({ type: 'buyer_to_buyer' }), 'friends')).toBe(true);
    expect(matches(conv({ type: 'buyer_to_seller' }), 'friends')).toBe(false);
    for (const type of ['buyer_to_seller', 'buyer_to_seller_product', 'buyer_to_seller_order'] as const) {
      expect(matches(conv({ type }), 'shops')).toBe(true);
    }
    expect(matches(conv({ type: 'buyer_to_buyer' }), 'shops')).toBe(false);
  });

  it('Groups = server "group" type or more than two participants', () => {
    expect(matches(conv({ type: 'group' as never }), 'groups')).toBe(true);
    const three = conv();
    three.participants = [...three.participants, { userId: 'x', name: 'X', handle: '@x', initials: 'X', color: '#000', accountType: 'buyer' as const }];
    expect(matches(three, 'groups')).toBe(true);
    expect(matches(three, 'friends')).toBe(false);
    expect(matches(conv(), 'groups')).toBe(false);
  });

  it('Muted only counts a mute that has not expired', () => {
    expect(matches(conv({ mutedUntil: '9999-12-31T00:00:00.000Z' }), 'muted')).toBe(true);
    expect(matches(conv({ mutedUntil: '2026-10-17T11:00:00.000Z' }), 'muted')).toBe(false);
    expect(matches(conv(), 'muted')).toBe(false);
    expect(isConversationMuted({ mutedUntil: 'garbage' }, NOW)).toBe(false);
  });
});

describe('communityMatchesInboxFilter', () => {
  it('community group chats show under All/Groups, and Unread/Muted by their own state', () => {
    expect(communityMatchesInboxFilter({ unreadCount: 0, muted: false }, 'all')).toBe(true);
    expect(communityMatchesInboxFilter({ unreadCount: 0, muted: false }, 'groups')).toBe(true);
    expect(communityMatchesInboxFilter({ unreadCount: 1, muted: false }, 'unread')).toBe(true);
    expect(communityMatchesInboxFilter({ unreadCount: 0, muted: false }, 'unread')).toBe(false);
    expect(communityMatchesInboxFilter({ unreadCount: 0, muted: true }, 'muted')).toBe(true);
    for (const f of ['archived', 'pinned', 'friends', 'shops'] as InboxFilter[]) {
      expect(communityMatchesInboxFilter({ unreadCount: 5, muted: true }, f)).toBe(false);
    }
  });
});

describe('INBOX_FILTERS', () => {
  it('has a label for every filter, starting with All', () => {
    expect(INBOX_FILTERS[0].key).toBe('all');
    expect(inboxFilterLabel('archived')).toBe('Archived');
  });
});
