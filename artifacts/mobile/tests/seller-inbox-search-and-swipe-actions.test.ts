import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const route = read('app/seller-inbox.tsx');
const src = read('components/inbox/MessagesInbox.tsx');

/**
 * Seller messages = buyer messages (Dev's call): app/seller-inbox.tsx renders
 * the ONE shared inbox (components/inbox/MessagesInbox.tsx) as its seller
 * variant — the same search, swipe actions (mark read, pin, mute,
 * delete/archive) and long-press menu as the buyer inbox, with no duplicate
 * implementation left to drift.
 */
describe('seller inbox renders the shared buyer inbox', () => {
  it('the route is a thin wrapper around MessagesInbox variant="seller"', () => {
    expect(route).toContain("import { MessagesInbox } from '@/components/inbox/MessagesInbox';");
    expect(route).toContain('<MessagesInbox variant="seller" />');
  });
});

describe('seller inbox: search', () => {
  it('has the same header search action and inline search field as the buyer inbox', () => {
    expect(src).toContain("{ name: 'search', onPress: openMessagesSearch, accessibilityLabel: 'Search messages', testID: 'inbox-header-search' },");
    expect(src).toContain('ref={messagesSearchInputRef}');
  });

  it('filters by the other participant’s name/handle, the last message, and (seller) order context', () => {
    expect(src).toContain('participant?.name, participant?.handle, conv.lastMessage,');
    expect(src).toContain('...(isSeller ? [conv.contextOrderNumber, conv.contextProductName] : []),');
  });

  it('never filters out unread/read state — only archived/request rows and the search query', () => {
    expect(src).toContain('if (conv.isArchived || conv.isRequest || pendingDeleteIds.has(conv.id)) return false;');
  });
});

describe('seller inbox: swipe actions', () => {
  it('uses the shared InboxSwipeRow component', () => {
    expect(src).toContain("import InboxSwipeRow, { type InboxSwipeAction } from '@/components/inbox/InboxSwipeRow';");
    expect(src).toContain('<InboxSwipeRow rowId={conv.id} actions={swipeActions}>');
  });

  it('offers mark-read, pin/unpin, mute and delete', () => {
    expect(src).toContain("key: 'read',");
    expect(src).toContain("key: 'pin',");
    expect(src).toContain("key: 'mute',");
    expect(src).toContain("key: 'delete',");
  });

  it('a seeded seller preview conversation updates local state only, never hitting the network', () => {
    expect(src).toContain('(id: string) => (isSeller ? isSellerPreviewConversationId(id) : isPreviewConversationId(id)),');
    expect(src).toContain('if (isPreviewId(conv.id)) {');
  });

  it('pinned conversations sort to the top of the list', () => {
    expect(src).toContain('.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0));');
  });

  it('long-pressing a row offers Archive', () => {
    expect(src).toContain("showActionSheet('Options', undefined, [");
    expect(src).toContain("{ text: 'Archive', onPress: () => swipeArchiveConversation(conv), style: 'destructive' },");
  });

  it('a seller row opens the seller thread', () => {
    expect(src).toContain('? `/seller-conversation?id=${encodeURIComponent(conv.id)}`');
  });
});
