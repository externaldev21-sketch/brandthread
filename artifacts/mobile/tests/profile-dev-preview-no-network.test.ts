import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) =>
  readFileSync(resolve(__dirname, '..', relativePath), 'utf8');

/**
 * Half-done audit follow-up (profile core: seller's own profile tab, buyer's
 * own profile tab, and buyer-other-profile). Same root cause as
 * tests/messaging-dev-preview-no-network.test.ts: the audit's Clerk stub
 * fakes a signed-in user, so a guard that only checks `!userId` still
 * reaches the real (here, backend-less) API and logs a console 404. Fixed
 * by also checking isSellerDevPreview()/isBuyerDevPreview() (lib/devPreview.ts),
 * which reads the bt_preview URL param / persisted role directly —
 * independent of whatever Clerk reports.
 */
describe('profile screens never hit the real API in dev-preview, however Clerk is stubbed', () => {
  it('(tabs)/profile.tsx: every data loader also checks isSellerDevPreview(), not just !userId', () => {
    const src = read('app/(tabs)/profile.tsx');
    expect(src).toContain("import { isSellerDevPreview } from '@/lib/devPreview';");
    // loadPosts, loadMyStories, loadProfile, loadSocialCounts, loadShopCount,
    // loadPage, loadShopProducts and loadUnreadMessages (the seller action
    // row's Messages badge, added for the Edit+Messages action-row redesign)
    // each have their own identical guard.
    expect(src.match(/if \(!authLoaded \|\| !userId \|\| isSellerDevPreview\(\)\) return;/g)?.length).toBe(8);
    expect(src).toContain('if (authLoaded && userId && !isSellerDevPreview()) void loadPage();');
    // Preview never loads Clerk, so it settles without waiting on authLoaded.
    expect(src).toContain('if ((authLoaded && !userId) || isSellerDevPreview()) { setPostsLoading(false); setStatsInitialLoading(false); }');
  });

  it('(buyer)/profile.tsx: loadCounts, the saved-items/orders load, the story ring and Thread Cash all also check isBuyerDevPreview()', () => {
    const src = read('app/(buyer)/profile.tsx');
    expect(src).toContain("import { isBuyerDevPreview } from '@/lib/devPreview';");
    expect(src).toContain('if (!id || isBuyerDevPreview()) return;');
    expect(src).toContain('const devPreview = isBuyerDevPreview();');
    expect(src).toContain('devPreview ? Promise.resolve([]) : getSavedItems(),');
    expect(src).toContain('if (user?.id && !isBuyerDevPreview()) {');
    expect(src).toContain('if (!user?.id || isBuyerDevPreview()) {');
  });

  it('components/profile/ProfileCover.tsx: the own-profile coachmark load checks isSellerDevPreview()/isBuyerDevPreview()', () => {
    const src = read('components/profile/ProfileCover.tsx');
    expect(src).toContain("import { isSellerDevPreview, isBuyerDevPreview } from '@/lib/devPreview';");
    expect(src).toContain('if (!own || isSellerDevPreview() || isBuyerDevPreview()) return;');
  });

  it('buyer-other-profile.tsx: no seeded "other person" data exists in preview, so the profile load treats any dev-preview session like an unresolved id', () => {
    const src = read('app/buyer-other-profile.tsx');
    expect(src).toContain("import { isBuyerDevPreview, isSellerDevPreview } from '@/lib/devPreview';");
    expect(src).toContain("if (!userId || userId.startsWith('u_') || isBuyerDevPreview() || isSellerDevPreview()) {");
  });

  it('buyer-other-profile.tsx: never trusts route params (name/handle/initials/etc.) in dev-preview, since the audit\'s own generic synthetic fallback ("preview-1") would otherwise render as visible preview-wording text', () => {
    const src = read('app/buyer-other-profile.tsx');
    expect(src).toContain('const trustRouteParams = !isBuyerDevPreview() && !isSellerDevPreview();');
    expect(src).toContain("const name     = (trustRouteParams && params.name)     || 'Unknown';");
  });
});
