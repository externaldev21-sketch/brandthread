import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(resolve(process.cwd(), 'app/seller-inbox.tsx'), 'utf8');

/**
 * Seller messages parity (Dev's call): app/seller-inbox.tsx brought closer to
 * app/(buyer)/inbox.tsx — search, unread dots (already there), and the same
 * swipe actions (mark read, pin, mute, delete/archive) via the shared
 * InboxSwipeRow component and services/socialService.ts mutations, so
 * neither screen duplicates the logic.
 */
describe('seller-inbox.tsx: search', () => {
  it('has a search toggle in the header and an inline SearchBar', () => {
    expect(src).toContain("import { PressableScale, SearchBar, useUndoToast } from '@/components/BrandthreadUI';");
    expect(src).toContain("icon: 'search',");
    expect(src).toContain('onPress: () => setSearchOpen((open) => !open),');
    expect(src).toContain('<SearchBar value={query} onChange={setQuery} placeholder="Search messages…" />');
  });

  it('filters by the other participant’s name/handle, the last message, and order context', () => {
    expect(src).toContain('const haystack = [other?.name, other?.handle, c.lastMessage, c.contextOrderNumber, c.contextProductName]');
  });

  it('never filters out unread/read state — only archived/request rows and the search query', () => {
    // Message requests now get their own Requests tab (item 76 — every
    // role pair can land a seller in Requests, not just buyer<->buyer), so
    // the main Inbox list also excludes c.isRequest alongside c.isArchived.
    expect(src).toContain('if (c.isRequest || pendingDeleteIds.has(c.id)) return false;');
    expect(src).toContain('if (showArchived ? !c.isArchived : c.isArchived) return false;');
  });
});

describe('seller-inbox.tsx: swipe actions', () => {
  it('uses the same shared InboxSwipeRow component as the buyer inbox, not a duplicate', () => {
    expect(src).toContain("import InboxSwipeRow, { type InboxSwipeAction } from '@/components/inbox/InboxSwipeRow';");
    expect(src).toContain('<InboxSwipeRow rowId={item.id} actions={swipeActions}>');
  });

  it('offers mark-read, pin/unpin, mute and delete, matching the buyer inbox’s action set', () => {
    expect(src).toContain("key: 'read',");
    expect(src).toContain("key: 'pin',");
    expect(src).toContain("key: 'mute',");
    expect(src).toContain("key: 'delete',");
  });

  it('reuses services/socialService.ts mutations rather than a parallel implementation', () => {
    expect(src).toContain("markConversationRead, archiveConversation, deleteConversationForMe, muteConversation, setConversationPinned,");
    expect(src).toContain("} from '@/services/socialService';");
  });

  it('swipe Mute is the real per-chat mute (not a person-level mute), and Delete is delete-for-me', () => {
    expect(src).not.toContain('muteUser');
    expect(src).toContain('await muteConversation(c.id, nextMuted ? -1 : null);');
    expect(src).toContain('await deleteConversationForMe(c.id);');
  });

  it('a seeded preview conversation updates local state only, never hitting the network', () => {
    expect(src).toContain('isSellerPreviewConversationId');
    expect(src).toContain('if (isSellerPreviewConversationId(c.id)) return;');
  });

  it('pinned conversations sort to the top of the list', () => {
    expect(src).toContain('.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0)),');
  });

  it('long-pressing a row offers Archive, or Unarchive for an archived chat', () => {
    expect(src).toContain("showActionSheet('Options', undefined, [");
    expect(src).toContain("{ text: 'Archive', onPress: () => setArchived(c, true), style: 'destructive' },");
    expect(src).toContain("{ text: 'Unarchive', onPress: () => setArchived(c, false) }");
  });
});
