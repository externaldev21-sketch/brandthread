import { beforeEach, describe, expect, it, vi } from 'vitest';

const flags = vi.hoisted(() => ({ demo: false }));
vi.mock('../devPreview', () => ({
  isPreviewDemoMode: () => flags.demo,
  isBuyerDevPreview: () => true,
  isSellerDevPreview: () => false,
}));
vi.mock('../previewCatalog', () => ({ isPreviewCatalogEnabled: () => flags.demo }));

type Inbox = typeof import('../previewInbox');
let inbox: Inbox;

beforeEach(async () => {
  vi.resetModules();
  flags.demo = false;
  inbox = await import('../previewInbox');
});

const author = {
  authorId: 'story-author-1', authorName: 'Story Author', authorHandle: '@story',
  authorInitials: 'SA', authorColor: '#222',
};

describe('preview inbox runtime threads', () => {
  it('a seeded-thread mutation never duplicates a runtime (story reply) thread', () => {
    flags.demo = true;
    const runtime = inbox.getOrCreatePreviewConversationForAuthor(author);
    const seeded = inbox.getPreviewConversations().find((c) => c.id !== runtime.id && !c.isOfficial)!;
    inbox.setPreviewConversationPinned(seeded.id, true);
    inbox.setPreviewConversationTheme(seeded.id, 'ocean');
    inbox.setPreviewConversationDisappearing(seeded.id, true);
    const ids = inbox.getPreviewConversations().map((c) => c.id);
    expect(ids.filter((id) => id === runtime.id)).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
    expect(inbox.getPreviewConversation(seeded.id)).toMatchObject({ isPinned: true, themeId: 'ocean', disappearingEnabled: true });
  });

  it('accepting or deleting a seeded request keeps runtime threads listed once', () => {
    flags.demo = true;
    const runtime = inbox.getOrCreatePreviewConversationForAuthor(author);
    const request = inbox.getPreviewConversations().find((c) => c.isRequest)!;
    inbox.acceptPreviewConversationRequest(request.id);
    let ids = inbox.getPreviewConversations().map((c) => c.id);
    expect(ids.filter((id) => id === runtime.id)).toHaveLength(1);
    inbox.deletePreviewConversationRequest(request.id);
    ids = inbox.getPreviewConversations().map((c) => c.id);
    expect(ids.filter((id) => id === runtime.id)).toHaveLength(1);
    expect(ids).not.toContain(request.id);
  });

  it('a theme set on a runtime thread is what that thread then reads', () => {
    const runtime = inbox.getOrCreatePreviewConversationForAuthor(author);
    inbox.setPreviewConversationTheme(runtime.id, 'ocean');
    expect(inbox.getPreviewConversation(runtime.id)?.themeId).toBe('ocean');
    inbox.deletePreviewConversationRequest(runtime.id);
    expect(inbox.getPreviewConversation(runtime.id)).toBeNull();
  });
});

describe('preview inbox caches follow the URL-only demo mode', () => {
  it('follower notifications: a fresh page first never leaves a demo page empty, and back', () => {
    expect(inbox.getPreviewNotifications()).toEqual([]);
    flags.demo = true;
    expect(inbox.getPreviewNotifications().length).toBeGreaterThan(0);
    flags.demo = false;
    expect(inbox.getPreviewNotifications()).toEqual([]);
  });

  it('seller conversations: same', () => {
    expect(inbox.getSellerPreviewConversations()).toEqual([]);
    flags.demo = true;
    expect(inbox.getSellerPreviewConversations().length).toBeGreaterThan(0);
    flags.demo = false;
    expect(inbox.getSellerPreviewConversations()).toEqual([]);
  });
});
