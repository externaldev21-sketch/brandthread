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
    await expect(rebuildBrandMemory(null)).rejects.toThrow();
  });

  it('still fills the sample brand profile under demo=1', async () => {
    demo.on = true;
    const memory = await rebuildBrandMemory(null);
    expect(memory.brandVoice.value).toMatch(/Confident/);
    expect(memory.brandVoice.enabled).toBe(true);
  });
});

// The modules below bundle expo-asset image requires or React Native screens
// that vitest cannot import (see freshInstallPreview.test.ts), so their gates
// are verified via source inspection, matching that file's pattern.
describe('preview catalog / discover / suggestions return [] unless demo=1', () => {
  it('lib/previewCatalog.ts getPreviewCatalog gates before its cache', () => {
    expect(src('../previewCatalog.ts')).toMatch(
      /export function getPreviewCatalog\(\): PreviewCatalogProduct\[\] \{[\s\S]{0,140}if \(!isPreviewDemoMode\(\)\) return \[\];\s*if \(cached\) return cached;/,
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

  it('designService.exportProject throws instead of returning a mock:// export', () => {
    const s = src('../../services/designService.ts');
    const fn = s.slice(s.indexOf('export async function exportProject'));
    expect(fn.indexOf("if (!isPreviewDemoMode()) throw")).toBeGreaterThan(0);
    expect(fn.indexOf("if (!isPreviewDemoMode()) throw")).toBeLessThan(fn.indexOf('mock://export'));
  });
});

describe('screens gate their sample fallbacks on isPreviewDemoMode()', () => {
  it('calls: the only (simulated) provider is demo-only and screens hide call buttons otherwise', () => {
    const ctx = src('../calls/CallSessionContext.tsx');
    expect(ctx).toContain('const CALLS_AVAILABLE = isPreviewDemoMode();');
    expect(ctx).toMatch(/const startCall = useCallback\(async \(input: StartCallInput\) => \{\s*if \(!CALLS_AVAILABLE\) return;/);
    expect(src('../../app/buyer-conversation.tsx').match(/conv && !isAgentConv && callsAvailable && \(/g)).toHaveLength(2);
    expect(src('../../app/seller-conversation.tsx')).toContain('{id && callsAvailable && (');
  });

  it('buyer-search only blends preview videos/products/accounts under demo', () => {
    const s = src('../../app/buyer-search.tsx');
    expect(s).toContain('const demoFallback = previewMode && isPreviewDemoMode();');
    expect(s).toContain('peopleResult.length === 0 && demoFallback');
    expect(s).toContain('(demoFallback && trimmedQuery.length > 0 ? PREVIEW_VIDEOS');
    expect(s).toContain('(demoFallback && trimmedQuery.length > 0 && activeFilterCount === 0 ? PREVIEW_PRODUCTS');
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

  it('order-detail only renders a generated demo order under demo', () => {
    expect(src('../../app/order-detail.tsx')).toContain('const raw = isPreviewDemoMode() ? getGeneratedSellerOrder(id) : null;');
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
    const s = src('../../app/share-store.tsx');
    expect(s).toContain('const ready = isPreviewDemoMode() || (!loading && !!(profile?.username || profile?.brandName || profile?.displayName));');
    expect(s.match(/disabled=\{!ready\}/g)).toHaveLength(2);
  });

  it('seller preview conversation getters (thread, messages, buyer orders) are demo-gated like the buyer ones', () => {
    const s = src('../previewInbox.ts');
    expect(s).toContain('cachedSellerConversations = isPreviewDemoMode() ? SELLER_PREVIEW_CONVERSATION_SEEDS.map(toSellerConversation) : [];');
    expect(s).toContain('const seed = isPreviewDemoMode() ? sellerSeedById(conversationId) : undefined;');
    expect(s).toContain('const rows: PreviewBuyerOrderSeed[] = isPreviewDemoMode() ? seed?.buyerOrders ?? [] : [];');
  });
});
