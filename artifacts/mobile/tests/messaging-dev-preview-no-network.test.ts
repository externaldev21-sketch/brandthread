import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) =>
  readFileSync(resolve(__dirname, '..', relativePath), 'utf8');

/**
 * Half-done audit follow-up (messaging core: seller-inbox, seller-conversation,
 * buyer-conversation, conversation-details, conversation-group-create,
 * (buyer)/inbox — the "6 hard" findings Dev called out).
 *
 * The audit's Clerk stub fakes a signed-in user (so protected screens render
 * at all), which means `myId`/`userId` reads as truthy even in a dev-preview
 * session — a guard that only checked `!myId`/`!userId` before falling back
 * to preview/seed data therefore still reached the real (here, backend-less)
 * API first and logged a real console 404, even though the screen visually
 * recovered via its catch-block fallback. Fixed by also checking
 * isSellerDevPreview()/isBuyerDevPreview() (lib/devPreview.ts), which reads
 * the bt_preview URL param / persisted role directly — independent of
 * whatever Clerk reports — so a dev-preview session never attempts the real
 * network call regardless of how Clerk is stubbed.
 */
describe('messaging screens never hit the real API in dev-preview, however Clerk is stubbed', () => {
  // Both inboxes render the one shared components/inbox/MessagesInbox.tsx;
  // `isPreviewSession()` is isBuyerDevPreview() for the buyer variant and
  // isSellerDevPreview() for the seller variant.
  it('the shared inbox resolves the preview session per variant', () => {
    const src = read('components/inbox/MessagesInbox.tsx');
    expect(src).toContain("import { isBuyerDevPreview, isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';");
    expect(src).toContain('() => (isSeller ? isSellerDevPreview() : isBuyerDevPreview()),');
    expect(read('app/seller-inbox.tsx')).toContain('<MessagesInbox variant="seller" />');
    expect(read('app/(buyer)/inbox.tsx')).toContain('<MessagesInbox variant="buyer" />');
  });

  it('inbox: the preview session gates the conversations list load, story tray, suggested people and compose directory', () => {
    const src = read('components/inbox/MessagesInbox.tsx');
    expect(src).toContain('if (!userId || isPreviewSession()) {');
    // loadData, loadStoryTray and loadSuggested each have their own guard.
    expect(src.match(/if \(!userId \|\| isPreviewSession\(\)/g)?.length).toBeGreaterThanOrEqual(3);
    // The compose sheet's follow-graph directory fetch (following/followers/
    // suggested) never reaches the real endpoints in dev-preview either.
    expect(src).toContain('] = isPreviewSession()');
    expect(src).toContain('? [Promise.resolve([]), Promise.resolve([]), Promise.resolve([])]');
  });

  it('conversation-details: isPreview also covers any dev-preview session, not just a recognized seeded conversation id', () => {
    const src = read('app/conversation-details.tsx');
    expect(src).toContain("import { isSellerDevPreview, isBuyerDevPreview } from '@/lib/devPreview';");
    expect(src).toContain(
      'const isPreview = isPreviewConversationId(params.id) || isSellerDevPreview() || isBuyerDevPreview();',
    );
  });

  it('conversation-group-create: dev-preview shows the honest empty directory instead of calling the real follow graph', () => {
    const src = read('app/conversation-group-create.tsx');
    expect(src).toContain("import { isSellerDevPreview, isBuyerDevPreview } from '@/lib/devPreview';");
    expect(src).toContain('if (isSellerDevPreview() || isBuyerDevPreview()) {');
    expect(src).toContain('setCandidates([]);');
  });
});
