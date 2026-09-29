/**
 * Audit workstream F, item 6 — confirms the push notification response
 * dedup that's already implemented (lib/notificationNavigation.test.ts's
 * "routes both warm and cold taps to Subscription only once" covers the
 * dedup CONTRACT at the function level) is actually WIRED correctly in
 * app/_layout.tsx: one shared handler closure (and therefore one shared
 * `handledNotificationIdsRef` Set) used by BOTH the warm
 * addNotificationResponseReceivedListener AND the cold-start
 * getLastNotificationResponseAsync path — not two separately-constructed
 * handlers that could each hold their own Set and silently stop deduping
 * against each other.
 *
 * app/_layout.tsx can't be unit-tested by importing it directly (huge
 * native dependency tree), so this is a source check, same pattern as
 * lib/__tests__/queryClient.accountSwitch.test.ts's wiring check.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('push notification response dedup is wired through one shared handler', () => {
  it('app/_layout.tsx creates exactly one navigateFromNotification closure, reused by both the warm listener and the cold-start path', () => {
    const src = readFileSync(resolve(__dirname, '../../app/_layout.tsx'), 'utf8');

    const constructions = src.match(/createNotificationResponseHandler\(/g) ?? [];
    expect(constructions, 'createNotificationResponseHandler should be called exactly once — a second call site would create a second, independent dedup Set').toHaveLength(1);

    // It must be built from a ref (survives re-renders / effect re-runs)
    // rather than a fresh Set literal, or a remount would reset dedup state.
    expect(src).toContain('createNotificationResponseHandler(\n      { push: (href) => router.push(href as never) },\n      handledNotificationIdsRef.current,\n    );');

    // The SAME `navigateFromNotification` name must be the one called from
    // both paths.
    const warmCallSite = src.includes('navigateFromNotification(response);');
    expect(warmCallSite).toBe(true);
    const callCount = (src.match(/navigateFromNotification\(response\);/g) ?? []).length;
    expect(callCount, 'navigateFromNotification(response) should be called from both the warm listener and the cold-start recovery path').toBe(2);
  });

  it('handledNotificationIdsRef is a stable ref (useRef), not re-created per render', () => {
    const src = readFileSync(resolve(__dirname, '../../app/_layout.tsx'), 'utf8');
    expect(src).toMatch(/handledNotificationIdsRef\s*=\s*useRef\(new Set<string>\(\)\)/);
  });
});
