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
  it('seller-inbox: isSellerDevPreview() gates the conversations list load, not just !myId', () => {
    const src = read('app/seller-inbox.tsx');
    expect(src).toContain("import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';");
    expect(src).toContain('if (!myId || isSellerDevPreview()) {');
  });

  it('(buyer)/inbox: isBuyerDevPreview() gates the conversations list load, story tray, suggested people and compose directory', () => {
    const src = read('app/(buyer)/inbox.tsx');
    expect(src).toContain("import { isBuyerDevPreview } from '@/lib/devPreview';");
    expect(src).toContain('if (!userId || isBuyerDevPreview()) {');
    // loadStoryTray and loadSuggested each have their own identical guard.
    expect(src.match(/if \(!userId \|\| isBuyerDevPreview\(\)\) {/g)?.length).toBeGreaterThanOrEqual(3);
    // The compose sheet's follow-graph directory fetch (following/followers/
    // suggested) never reaches the real endpoints in dev-preview either.
    expect(src).toContain('] = isBuyerDevPreview()');
    expect(src).toContain('? [Promise.resolve([]), Promise.resolve([]), Promise.resolve([])]');
  });

  it('conversation-details: isPreview also covers any dev-preview session, not just a recognized seeded conversation id', () => {
    const src = read('app/conversation-details.tsx');
    expect(src).toContain("import { isSellerDevPreview, isBuyerDevPreview } from '@/lib/devPreview';");
    expect(src).toContain(
      'const isPreview = isPreviewConversationId(conversationId ?? undefined) || isSellerDevPreview() || isBuyerDevPreview();',
    );
  });

  it('conversation-group-create: dev-preview shows the honest empty directory instead of calling the real follow graph', () => {
    const src = read('app/conversation-group-create.tsx');
    expect(src).toContain("import { isSellerDevPreview, isBuyerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';");
    expect(src).toContain('if (isSellerDevPreview() || isBuyerDevPreview()) {');
    // Demo preview lists the seeded "Following" accounts; fresh preview stays empty.
    expect(src).toContain('setCandidates(isPreviewDemoMode() ? PREVIEW_FOLLOWING : []);');
    // Creating the group never calls the protected endpoint in preview.
    expect(src).toContain('if (isSellerDevPreview() || isBuyerDevPreview()) return;');
  });
});
