import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) =>
  readFileSync(resolve(__dirname, '..', relativePath), 'utf8');

/**
 * Half-done audit follow-up (activity/notifications core: activity-center
 * (shared by (buyer)/activity), activity-people, buyer-your-activity, and
 * the shared LoginActivity component (login-activity, buyer-login-activity)).
 * Same root cause as tests/messaging-dev-preview-no-network.test.ts and
 * tests/profile-dev-preview-no-network.test.ts: a "try the real API first,
 * fall back to preview data on failure" loader still makes the real,
 * backend-less-in-preview call first, and the audit's Clerk stub (a fake
 * signed-in user) means even a plain `!userId` guard doesn't skip it.
 */
describe('activity/login-activity screens never hit the real API in dev-preview, however Clerk is stubbed', () => {
  it('activity-center.tsx: loadSuggested and loadFirstPage check isPreviewActivityEnabled() BEFORE calling the real endpoint, not just in a catch/fallback after', () => {
    const src = read('app/activity-center.tsx');
    expect(src).toContain('if (isPreviewActivityEnabled()) { showPreviewSuggestions(); return; }');
    // loadFirstPage's preview branch runs before its own try/await, not inside the catch.
    const loadFirstPageIdx = src.indexOf('const loadFirstPage = useCallback');
    const previewBranchIdx = src.indexOf('if (isPreviewActivityEnabled()) {', loadFirstPageIdx);
    const awaitIdx = src.indexOf('await getActivity(', loadFirstPageIdx);
    expect(previewBranchIdx).toBeGreaterThan(loadFirstPageIdx);
    expect(previewBranchIdx).toBeLessThan(awaitIdx);
  });

  it('activity-people.tsx: the actor lookup checks isPreviewActivityEnabled() before calling getGroupedActivityActors()', () => {
    const src = read('app/activity-people.tsx');
    const loadIdx = src.indexOf('const load = useCallback');
    const previewBranchIdx = src.indexOf('if (isPreviewActivityEnabled()) {', loadIdx);
    const awaitIdx = src.indexOf('await getGroupedActivityActors(', loadIdx);
    expect(previewBranchIdx).toBeGreaterThan(loadIdx);
    expect(previewBranchIdx).toBeLessThan(awaitIdx);
  });

  it('buyer-your-activity.tsx: loadData also checks isBuyerDevPreview(), not just !userId, before calling getSavedItems()', () => {
    const src = read('app/buyer-your-activity.tsx');
    expect(src).toContain("import { isBuyerDevPreview } from '@/lib/devPreview';");
    expect(src).toContain('if (!userId || isBuyerDevPreview()) {');
  });

  it('components/security/LoginActivity.tsx (shared by login-activity.tsx and buyer-login-activity.tsx): the real Clerk session list is skipped in any dev-preview session', () => {
    const src = read('components/security/LoginActivity.tsx');
    expect(src).toContain("import { isSellerDevPreview, isBuyerDevPreview } from '@/lib/devPreview';");
    expect(src).toContain('if (isSellerDevPreview() || isBuyerDevPreview()) {');
    expect(src).toContain('setSessions([previewCurrentSession()]);');
  });
});
