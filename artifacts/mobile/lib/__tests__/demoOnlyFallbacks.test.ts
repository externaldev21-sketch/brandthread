import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Fake/sample data may only appear under the explicit `&demo=1` preview
// opt-in (isPreviewDemoMode(), lib/devPreview.ts) — never for a real account,
// never in a plain __DEV__ build, never in a fresh `?bt_preview=…` session.

const demo = vi.hoisted(() => ({ on: false }));

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    default: {
      getItem: (k: string) => Promise.resolve(store.get(k) ?? null),
      setItem: (k: string, v: string) => { store.set(k, v); return Promise.resolve(); },
      removeItem: (k: string) => { store.delete(k); return Promise.resolve(); },
    },
  };
});
vi.mock('@/lib/devPreview', () => ({
  isPreviewDemoMode: () => demo.on,
  // Preview role on, so rebuildBrandMemory skips the (absent) API and goes
  // straight to the fallback branch under test.
  isSellerDevPreview: () => true,
}));

import { rebuildBrandMemory } from '../../services/aiBrandMemory';

function src(relPath: string): string {
  return readFileSync(resolve(__dirname, relPath), 'utf8');
}

describe('services/aiBrandMemory.ts rebuildBrandMemory', () => {
  beforeEach(() => { demo.on = false; });

  it('throws (so the screen shows its rebuild-failed alert) instead of saving invented defaults outside demo', async () => {
    await expect(rebuildBrandMemory()).rejects.toThrow();
  });

  it('still fills the sample brand profile under demo=1', async () => {
    demo.on = true;
    const memory = await rebuildBrandMemory();
    expect(memory.brandVoice.value).toMatch(/Confident/);
    expect(memory.brandVoice.enabled).toBe(true);
  });
});

// The modules below bundle expo-asset image requires or React Native screens
// that vitest cannot import (see freshInstallPreview.test.ts), so their gates
// are verified via source inspection, matching that file's pattern.
describe('preview catalog / discover / suggestions return [] unless demo=1', () => {
  it('lib/previewCatalog.ts getPreviewCatalog gates before building the catalog', () => {
    expect(src('../previewCatalog.ts')).toMatch(
      /export function getPreviewCatalog\(\): PreviewCatalogProduct\[\] \{[\s\S]{0,140}if \(!isPreviewDemoMode\(\)\) return \[\];\s*return buildCatalog\(\);/,
    );
  });

  it('lib/previewActivity.ts getPreviewSuggestedPeople gates before its cache', () => {
    expect(src('../previewActivity.ts')).toMatch(
      /export function getPreviewSuggestedPeople\(\): PreviewSuggestedPerson\[\] \{\s*if \(!isPreviewDemoMode\(\)\) return \[\];\s*if \(cachedSuggestions\)/,
    );
  });

  it('lib/previewDiscover.ts getPreviewDiscoverPosts (incl. the buyer "fits" cast) gates before its cache', () => {
    expect(src('../previewDiscover.ts')).toMatch(
      /export function getPreviewDiscoverPosts\([^)]*\): DiscoverPost\[\] \{\s*if \(!isPreviewDemoMode\(\)\) return \[\];\s*if \(!cachedPosts\)/,
    );
  });
});

describe('services never fabricate a success outside demo', () => {
  it('orderService.addTracking rethrows instead of writing a fake shipment', () => {
    expect(src('../../services/orderService.ts')).toMatch(
      /\} catch \(err\) \{[\s\S]{0,140}if \(!isPreviewDemoMode\(\)\) throw err;/,
    );
  });

  it('designService has no mock:// export: design export renders real files on device', () => {
    const s = src('../../services/designService.ts');
    expect(s).not.toContain('export async function exportProject');
    expect(s).not.toContain('mock://export');
  });
});

describe('screens gate their sample fallbacks on isPreviewDemoMode()', () => {
  it('calls: the simulated provider is demo-only (real accounts get the server + Agora provider) and the thread hides call buttons when calls are unavailable', () => {
    const ctx = src('../calls/CallSessionContext.tsx');
    expect(ctx).toContain('const demo = isPreviewDemoMode();');
    expect(ctx).toMatch(/const provider = useMemo<CallProvider>\(\(\) => \(\s*demo\s*\?\s*createPreviewCallProvider\(\)\s*:\s*createAgoraCallProvider\(/);
    // The fake "incoming call" only rings on the simulated provider.
    expect(ctx).toMatch(/const simulateIncomingCall = useCallback\(\(input: StartCallInput\) => \{\s*if \(provider\.id !== 'preview'\) return;/);
    expect(ctx).toContain("callsAvailable: provider.id !== 'preview' || isPreviewDemoMode(),");
    // Buyer and seller conversations both render components/chat/ConversationThread.tsx.
    expect(src('../../components/chat/ConversationThread.tsx').match(/conv && !isAgentConv && callsAvailable && !requestLocked && \(/g)).toHaveLength(2);
  });

  it('buyer-search only blends preview videos/products/accounts under demo', () => {
    const s = src('../../app/buyer-search.tsx');
    expect(s).toContain('const demoMode = previewMode && isPreviewDemoMode();');
    // Every previewFallback(...) call site (top overview, tab first page, tab
    // error) must be gated on demoMode, not on the plain preview flag.
    const callSites = [...s.matchAll(/previewFallback\(/g)]
      .map((m) => m.index!)
      .filter((i) => !s.slice(Math.max(0, i - 9), i).endsWith('function '));
    expect(callSites.length).toBeGreaterThanOrEqual(3);
    for (const i of callSites) {
      const guard = s.slice(Math.max(0, i - 80), i);
      expect(guard, `ungated previewFallback at offset ${i}: …${guard}`).toMatch(/\bdemoMode\b/);
      expect(guard, `previewFallback at offset ${i} is gated on previewMode: …${guard}`).not.toMatch(/\bpreviewMode\b/);
    }
  });

  it('feed only injects the fashion preview posts under demo, not in every __DEV__ build', () => {
    const s = src('../../app/(tabs)/feed.tsx');
    expect(s).not.toMatch(/__DEV__ && !isCreatorFeed/);
    expect(s.match(/isPreviewDemoMode\(\) && !isCreatorFeed/g)).toHaveLength(2);
  });

  it('live cohost/moderation screens use the canonical gate, not a raw ?demo=1 param', () => {
    for (const f of ['live-cohost.tsx', 'live-cohost-invite.tsx', 'live-moderation.tsx', 'ai-helper.tsx']) {
      const s = src(`../../app/${f}`);
      expect(s, f).toContain('const demo = isPreviewDemoMode();');
      expect(s, f).not.toContain("params.demo === '1'");
    }
  });

  it('order-detail only renders a generated demo order inside a preview', () => {
    // order-detail / fulfill-batch read local preview orders through
    // lib/previewOrderEdits.ts loadPreviewSellerOrder; a generated
    // `preview-demo-order-*` id must not render for a real (non-preview) account.
    expect(src('../../app/order-detail.tsx')).toContain('const previewRaw = loadPreviewSellerOrder(id);');
    const edits = src('../previewOrderEdits.ts');
    const body = edits.slice(edits.indexOf('export function loadPreviewSellerOrder'));
    const generatedAt = body.indexOf('getGeneratedSellerOrder(');
    expect(generatedAt).toBeGreaterThan(0);
    expect(body.slice(0, generatedAt)).toMatch(/isPreviewDemoMode\(\)|isSellerDevPreview\(\)/);
  });

  it('post comments only seed sample comments under demo', () => {
    expect(src('../../app/buyer-post-comments.tsx')).toContain(
      "cached ?? (isPreviewDemoMode() ? flatten(buildPreviewComments(",
    );
  });

  it('buyer profile only applies the preview Thread Cash streak/balance under demo', () => {
    expect(src('../../app/(buyer)/profile.tsx')).toContain(
      'if (!active || !isPreviewThreadCashEnabled() || !isPreviewDemoMode()) return;',
    );
  });

  it('share-store never offers the placeholder link for copy/share outside demo', () => {
    // app/share-store.tsx renders components/store/ShareStoreSheet.tsx's
    // ShareStoreContent, whose link comes from hooks/useStoreLink.ts.
    expect(src('../../app/share-store.tsx')).toContain('<ShareStoreContent ');
    const hook = src('../../hooks/useStoreLink.ts');
    expect(hook).toMatch(/if \(isSellerDevPreview\(\)\) \{\s*setProfile\(isPreviewDemoMode\(\)\s*\? \{ username: PREVIEW_SELLER_IDENTITY\.username/);
    expect(hook).toMatch(/: null\);\s*setLoading\(false\);\s*return;/);
    const sheet = src('../../components/store/ShareStoreSheet.tsx');
    // copy, system share and per-app share all refuse without a real link…
    expect(sheet.match(/if \(!link\.url\) return;/g)).toHaveLength(3);
    // …and the body shows "Pick a username" instead of an invented one.
    expect(sheet).toContain('testID="share-store-no-username"');
  });

  it('seller preview conversation getters (thread, messages, buyer orders) are demo-gated like the buyer ones', () => {
    const s = src('../previewInbox.ts');
    expect(s).toContain('cachedSellerConversations = isPreviewDemoMode() ? SELLER_PREVIEW_CONVERSATION_SEEDS.map(toSellerConversation) : [];');
    expect(s).toContain('const seed = isPreviewDemoMode() ? sellerSeedById(conversationId) : undefined;');
    expect(s).toContain('const rows: PreviewBuyerOrderSeed[] = isPreviewDemoMode() ? seed?.buyerOrders ?? [] : [];');
  });
});
