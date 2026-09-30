import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// Fresh-install preview: `?bt_preview=buyer` (and `?bt_preview=seller`) alone
// must be a brand-new, zero-state account. The hand-authored demo cast (5
// friends, seeded chats/stories/notifications, saved items, orders, Thread
// Cash balance) must only appear behind the explicit `&demo=1` opt-in
// (isPreviewDemoMode(), lib/devPreview.ts).
//
// Most of the affected modules (lib/previewInbox.ts, previewActivity.ts,
// previewStories.ts) bundle expo-asset image requires that Rollup/Vite
// cannot parse under vitest (same constraint documented in
// lib/__tests__/devPreview.test.ts and previewInbox.test.ts), so their
// demo-gating is verified via source inspection here rather than by
// importing and calling them directly.

function src(relPath: string): string {
  return readFileSync(resolve(__dirname, relPath), "utf8");
}

describe("fresh-install: personal preview modules gate their seeded cast on isPreviewDemoMode()", () => {
  it("previewInbox.ts: conversations and notifications are demo-gated", () => {
    const s = src("../previewInbox.ts");
    expect(s).toContain("import { isPreviewDemoMode } from './devPreview';");
    expect(s).toMatch(/cachedConversations = isPreviewDemoMode\(\) \? allSeeds\(\)\.map\(toConversation\) : \[\];/);
    expect(s).toMatch(/cachedNotifications = !isPreviewDemoMode\(\) \? \[\] : PREVIEW_FOLLOWER_SEEDS\.map/);
  });

  it("previewActivity.ts: the personal activity feed and live-arrival cosmetic are demo-gated, suggestions stay public", () => {
    const s = src("../previewActivity.ts");
    expect(s).toContain("import { isPreviewDemoMode } from './devPreview';");
    expect(s).toMatch(/if \(!isPreviewDemoMode\(\)\) \{ cached = \[\]; return cached; \}/);
    expect(s).toContain("isPreviewActivityEnabled() && isPreviewDemoMode() && !liveArrivalDelivered");
    // getPreviewSuggestedPeople (reused by Discover's public People row) must
    // NOT be demo-gated — a fresh user can still see suggested public sellers.
    const suggestedFn = s.slice(s.indexOf("export function getPreviewSuggestedPeople"));
    expect(suggestedFn.slice(0, 400)).not.toContain("isPreviewDemoMode");
  });

  it("previewStories.ts: the story tray is demo-gated", () => {
    const s = src("../previewStories.ts");
    expect(s).toContain("import { isPreviewDemoMode } from './devPreview';");
    expect(s).toMatch(/export function getPreviewStoryTrayRows[\s\S]{0,80}if \(!isPreviewDemoMode\(\)\) return \[\];/);
    expect(s).toMatch(/export function getPreviewStoryFor[\s\S]{0,80}if \(!isPreviewDemoMode\(\)\) return null;/);
  });

  it("previewNotes.ts: other people's notes are demo-gated, posting my own note is not", () => {
    const s = src("../previewNotes.ts");
    expect(s).toContain("import { isPreviewDemoMode } from './devPreview';");
    expect(s).toMatch(/export function getPreviewNotesForTray[\s\S]{0,80}if \(!isPreviewDemoMode\(\)\) return \[\];/);
    // postPreviewNote/getPreviewMyNote must stay unconditional — that's the
    // real write-through action, not seeded demo content.
    expect(s).not.toMatch(/export function postPreviewNote[\s\S]{0,120}isPreviewDemoMode/);
  });

  it("previewThreadCash.ts: the seeded $18.45/4-day-streak status only returns under demo=1, and the fresh status is a real zero state", () => {
    const s = src("../previewThreadCash.ts");
    expect(s).toContain("import { isPreviewDemoMode } from './devPreview';");
    expect(s).toContain("return isPreviewDemoMode() ? PREVIEW_THREAD_CASH_STATUS : FRESH_THREAD_CASH_STATUS;");
    expect(s).toMatch(/FRESH_THREAD_CASH_STATUS[\s\S]{0,60}balanceCents: 0,/);
    expect(s).toMatch(/currentStreak: 0,/);
    expect(s).toMatch(/alreadyCheckedInToday: false,/);
  });

  it("previewOrders.ts: the seeded preview-order-01 row is demo-gated, session-placed orders are not", () => {
    const s = src("../previewOrders.ts");
    expect(s).toContain("import { isPreviewDemoMode } from './devPreview';");
    expect(s).toMatch(/if \(!isPreviewDemoMode\(\) \|\| id !== 'preview-order-01'\) return null;/);
    // The write-through `placed` map lookup must run BEFORE the demo check,
    // so a real session checkout always shows regardless of demo=1.
    const placedLookupIndex = s.indexOf("const placedOrder = placed.get(id!);");
    const demoGateIndex = s.indexOf("if (!isPreviewDemoMode() || id !== 'preview-order-01') return null;");
    expect(placedLookupIndex).toBeGreaterThan(0);
    expect(demoGateIndex).toBeGreaterThan(placedLookupIndex);
  });

  it("app/(buyer)/friends.tsx: the seeded following/stories/friend-activity fallback is demo-gated", () => {
    const s = src("../../app/(buyer)/friends.tsx");
    expect(s).toContain("isBuyerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';");
    expect(s).toMatch(/if \(isPreviewDemoMode\(\)\) \{\s*setApiFollowing\(PREVIEW_FOLLOWING\);/);
  });

  it("services/socialService.ts: buyer post creation works in ANY preview session (not gated on demo=1 — it's real session state, not seeded content)", () => {
    const s = src("../../services/socialService.ts");
    expect(s).toContain("if (isBuyerDevPreview()) return previewMyPosts;");
    expect(s).toContain("if (!isBuyerDevPreview()) throw new Error('Buyer post publishing is not available yet.');");
  });

  it("lib/live/liveProvider.ts: the seeded preview live streams (fake viewer counts, scripted chat) only render under demo=1, a fresh preview forces the real empty state", () => {
    const s = src("../live/liveProvider.ts");
    expect(s).toContain("import { isBuyerDevPreview, isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';");
    // forceEmpty must be the inverse of demo mode, not a separate opt-out
    // query param — that inversion (default show, an explicit opt-out param
    // to see the real empty state) was the actual fresh-install leak: a
    // plain `?bt_preview=buyer` always showed the fake "Maison Vela, 1,204
    // viewers" cast. The old opt-out param may still be mentioned in a
    // comment explaining the history; it must not appear in any live code path.
    const functionsOnly = s.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(functionsOnly).not.toContain("bt_live");
    expect(s).toMatch(/function previewForcesEmpty\(\)[\s\S]{0,80}return !\(BOOT_DEMO \|\| isPreviewDemoMode\(\)\);/);
  });

  it("lib/live/previewLiveProvider.ts: the seeded upcoming-lives schedule and suggested creators (fake follower counts) only return under demo=1 — app/live.tsx's LiveEmptyState must see real empty arrays on a fresh install, not just an empty stream list", () => {
    const s = src("../live/previewLiveProvider.ts");
    expect(s).toMatch(/async listUpcoming\(\): Promise<UpcomingLive\[\]> \{\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*if \(forceEmpty\) return \[\];/);
    expect(s).toMatch(/async listSuggestedCreators\(\): Promise<SuggestedCreator\[\]> \{\s*if \(forceEmpty\) return \[\];/);
  });

  it("app/live-feed.tsx: the sample fashion-runway rooms (fake viewer counts, scripted chat) only render under demo=1, a fresh preview shows the real LiveEmptyState", () => {
    const s = src("../../app/live-feed.tsx");
    expect(s).toContain("import { isPreviewDemoMode } from '@/lib/devPreview';");
    expect(s).toContain("import { LiveEmptyState } from '@/components/live/LiveEmptyState';");
    expect(s).toMatch(/const showDemoRooms = isPreviewDemoMode\(\);/);
    expect(s).toMatch(/const \[rooms, setRooms\] = useState<LiveRoom\[\]>\(\s*showDemoRooms/);
    // The empty branch must actually use the shared LiveEmptyState, not a
    // bespoke "no lives" screen that could itself drift from the pattern.
    expect(s).toMatch(/rooms\.length === 0[\s\S]{0,40}<LiveEmptyState/);
  });
});

describe("fresh-install: devPreview.ts's isPreviewDemoMode is the single shared gate", () => {
  it("is exported and used consistently across every personal preview module touched here", () => {
    const devPreviewSrc = src("../devPreview.ts");
    expect(devPreviewSrc).toContain("export function isPreviewDemoMode");
    const consumers = [
      "../previewInbox.ts", "../previewActivity.ts", "../previewStories.ts",
      "../previewNotes.ts", "../previewThreadCash.ts", "../previewOrders.ts",
    ];
    for (const path of consumers) {
      expect(src(path), `${path} should import isPreviewDemoMode from ./devPreview`).toContain("from './devPreview'");
    }
    // lib/live/ is a subdirectory, so its import is the @/lib alias instead.
    expect(src("../live/liveProvider.ts")).toContain("from '@/lib/devPreview'");
  });
});
