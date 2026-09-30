import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rootLayout = readFileSync(resolve(__dirname, '..', 'app/_layout.tsx'), 'utf8');

/**
 * Live verification caught this: loading "/profile?bt_preview=seller"
 * directly (a full page load, not in-app navigation) rendered the BUYER's
 * own profile (app/(buyer)/profile.tsx) instead of the seller's
 * (app/(tabs)/profile.tsx). Root cause: route groups add no path segment,
 * so a bare URL like "/profile" — a name that exists, identically, in both
 * (buyer) and (tabs) — resolves to whichever same-named file Expo Router's
 * static route table prefers, regardless of `bt_preview=`.
 *
 * AuthGate already corrects exactly this class of mismatch for a real
 * signed-in account ("Role mismatch corrections" below, keyed off
 * storedRole vs inBuyerGroup/inTabsGroup) — but that logic sits AFTER an
 * early `if (devRole) { ...; return; }` that every preview-mode request
 * hits first, so preview sessions never reached it. Fixed by mirroring the
 * same correction inside that early-return branch for devRole.
 *
 * Follow-up (also caught live): the first version of this fix redirected to
 * the bare group root ("/(tabs)/"), which landed on the seller Dashboard
 * instead of the Profile that "/profile?bt_preview=seller" actually asked
 * for. Fixed to preserve whatever comes after the group segment instead of
 * dropping it.
 */
describe('AuthGate corrects a (buyer)/(tabs) route-group mismatch in dev preview too, not just for a real signed-in account', () => {
  const devRoleBlock = () => {
    const start = rootLayout.indexOf('const devRole = PREVIEW_ROLE ?? webPreviewRole ?? DEV_BYPASS_ROLE;');
    const end = rootLayout.indexOf('if (!isLoaded) return;', start);
    expect(start, 'devRole block must exist').toBeGreaterThan(-1);
    expect(end, 'devRole block must be followed by the real-account gate').toBeGreaterThan(start);
    return rootLayout.slice(start, end);
  };

  it('corrects a buyer devRole landing in the (tabs) group back to (buyer), preserving the sub-path', () => {
    const block = devRoleBlock();
    expect(block).toContain("devRole === 'buyer' && inTabsGroup");
    expect(block).toContain('router.replace(`/(buyer)/${rest}` as never);');
  });

  it('corrects a seller devRole landing in the (buyer) group back to (tabs), preserving the sub-path', () => {
    const block = devRoleBlock();
    expect(block).toContain("devRole === 'seller' && inBuyerGroup");
    expect(block).toContain('router.replace(`/(tabs)/${rest}` as never);');
  });

  it('derives the preserved sub-path from every segment after the group itself', () => {
    const block = devRoleBlock();
    expect(block).toContain("const rest = (segments as string[]).slice(1).join('/');");
  });

  it("never fires this correction at the bare '/' root — that redirect is app/index.tsx's own job, and firing here too would race it", () => {
    const block = devRoleBlock();
    expect(block).toContain('if (!atRoot) {');
  });

  it('still returns unconditionally afterward, so the real-account (Clerk/onboarding) gate below never runs during a preview session', () => {
    const block = devRoleBlock();
    // The correction is nested inside the same `if (devRole)` body, which
    // still ends in its own bare `return;` right before the closing brace
    // — not a conditional one, and not removed by the new correction logic.
    expect(block).toMatch(/\n\s*return;\n\s*}\s*$/);
  });
});
