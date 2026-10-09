/**
 * Seller analytics reports (Analytics tab + Product stats / Threads and videos
 * / Audience / Goals / Export / Advanced analytics):
 *  - the range pills are the Dashboard's own (same ids, labels, order, default Today)
 *  - the demo fixtures and the empty fixtures match the API shapes and never
 *    fabricate data in fresh mode
 *  - every report screen reads its data through sellerInsightsService, whose
 *    preview branch runs before any network call
 *  - "Best time to post" is gone everywhere
 *  - the Reports list only points at real routes and the Advanced row is the
 *    only PRO-badged one
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { previewBuckets, previewInsights } from '@/lib/previewSellerInsights';

// The service and the Reports list pull in react-native (Platform, views),
// which vitest cannot parse; only the plain data they export is needed here.
vi.mock('react-native', () => ({ Platform: { OS: 'web' }, View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', StyleSheet: { create: (o: unknown) => o } }));
vi.mock('expo-haptics', () => ({ selectionAsync: () => undefined }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));
vi.mock('@/hooks/useColors', () => ({ useColors: () => ({}) }));
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest: async () => { throw new Error('network'); } }));
vi.mock('@/lib/devPreview', () => ({ isSellerDevPreview: () => false, isPreviewDemoMode: () => false }));
import { DEFAULT_INSIGHT_RANGE, INSIGHT_RANGES, type InsightRange } from '@/services/sellerInsightsService';
import { ANALYTICS_REPORTS } from '@/components/analytics/AnalyticsReportsList';

const ROOT = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const RANGES: InsightRange[] = ['today', 'week', 'month', 'year', 'all'];
const NOW = new Date(2026, 8, 18, 16, 30); // Fri Sep 18 2026, 4:30 pm local

describe('range pills', () => {
  it('match the Dashboard pills exactly and default to Today', () => {
    // DASHBOARD_RANGES lives in SellerDashboardChart.tsx (reanimated, gestures,
    // SVG) — read the literal from source instead of importing the component.
    const src = read('components/SellerDashboardChart.tsx');
    const block = src.slice(src.indexOf('export const DASHBOARD_RANGES'), src.indexOf('];', src.indexOf('export const DASHBOARD_RANGES')));
    const dashboard = [...block.matchAll(/id: '(\w+)', label: '(\w+)'/g)].map(m => ({ id: m[1], label: m[2] }));
    expect(dashboard.length).toBe(5);
    expect(INSIGHT_RANGES.map(r => r.key)).toEqual(dashboard.map(r => r.id));
    expect(INSIGHT_RANGES.map(r => r.label)).toEqual(dashboard.map(r => r.label));
    expect(DEFAULT_INSIGHT_RANGE).toBe('today');
  });
});

describe('preview fixtures', () => {
  it('bucket the local calendar like the API: hourly today, Sunday-first week, calendar month and year', () => {
    expect(previewBuckets('today', NOW).starts.map(d => d.getHours())).toEqual(Array.from({ length: 17 }, (_, i) => i));
    const week = previewBuckets('week', NOW).starts;
    expect(week[0].getDay()).toBe(0);
    expect(week.length).toBe(6); // Sun..Fri
    expect(previewBuckets('month', NOW).starts.length).toBe(18);
    expect(previewBuckets('year', NOW).starts.map(d => d.getMonth())).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(previewBuckets('all', NOW).window.step).toBe('1 week');
  });
  it('fresh mode is all real zeros and empty lists for every range', () => {
    for (const range of RANGES) {
      const f = previewInsights(range, 'empty', NOW);
      expect(f.products.products).toEqual([]);
      expect(f.products.totals.views).toBe(0);
      expect(f.products.buckets.every(b => b.views === 0 && b.purchases === 0)).toBe(true);
      expect(f.content.posts).toEqual([]);
      expect(f.content.totals.views).toBe(0);
      expect(f.audience.followers.total).toBe(0);
      expect(f.audience.devices).toEqual([]);
      expect(f.audience.topCountries).toEqual([]);
      expect(f.advanced.totals.orders).toBe(0);
      expect(f.goals).toEqual([]);
    }
  });
  it('demo mode is populated, deterministic and internally consistent', () => {
    for (const range of RANGES) {
      const a = previewInsights(range, 'demo', NOW);
      const b = previewInsights(range, 'demo', NOW);
      expect(a).toEqual(b);
      expect(a.products.totals.views).toBeGreaterThan(0);
      expect(a.products.buckets.reduce((s, x) => s + x.views, 0)).toBe(a.products.totals.views);
      expect(a.products.products.every(p => p.imageUrl)).toBe(true);
      expect(a.content.posts.length).toBeGreaterThan(0);
      expect(a.content.posts.every(p => p.thumbnailUrl)).toBe(true);
      expect(a.audience.devices.map(d => d.device)).toEqual(['ios', 'android', 'web']);
      expect(a.audience.topCountries.every(c => c.people >= 5)).toBe(true);
      expect(a.advanced.channels.reduce((s, c) => s + c.revenueCents, 0)).toBe(a.advanced.totals.revenueCents);
      expect(a.goals.length).toBe(3);
      if (range === 'all') {
        expect(a.products.previous).toBeNull();
        expect(a.products.deltas.viewsPct).toBeNull();
      } else {
        expect(a.products.previous).not.toBeNull();
      }
    }
  });
});

describe('report screens', () => {
  const SCREENS = ['analytics-product-stats', 'analytics-content', 'analytics-audience', 'analytics-goals', 'analytics-export', 'analytics-advanced'];
  it('exist, are registered in the root stack, and are listed as Reports', () => {
    for (const name of SCREENS) {
      expect(existsSync(resolve(ROOT, `app/${name}.tsx`))).toBe(true);
      expect(read('app/_layout.tsx')).toContain(`<Stack.Screen name="${name}"`);
      expect(ANALYTICS_REPORTS.map(r => r.href)).toContain(`/${name}`);
    }
    expect(ANALYTICS_REPORTS.filter(r => r.badge).map(r => r.href)).toEqual(['/analytics-advanced']);
    expect(read('app/(tabs)/analytics.tsx')).toContain('<AnalyticsReportsList />');
  });
  it('read only through sellerInsightsService, whose preview branch runs before the network', () => {
    for (const name of SCREENS) {
      const src = read(`app/${name}.tsx`);
      expect(src).toContain("from '@/services/sellerInsightsService'");
      expect(src).not.toMatch(/serviceRequest\(|fetch\(/);
    }
    const svc = read('services/sellerInsightsService.ts');
    for (const fn of ['getProductStats', 'getContentStats', 'getAudienceStats', 'getAdvancedStats', 'getGoals']) {
      const i = svc.indexOf(`export async function ${fn}(`);
      const preview = svc.indexOf('previewMode()', i);
      const request = svc.indexOf('serviceRequest', i);
      expect(preview).toBeGreaterThan(i);
      expect(preview).toBeLessThan(request);
    }
    expect(read('hooks/useSellerInsight.ts')).toContain('if (!previewMode() && (!isLoaded || !userId)) return;');
  });
  it('use the shared header with no subtitle and keep content clear of the tab bar', () => {
    for (const name of [...SCREENS, '(tabs)/analytics']) {
      const src = read(`app/${name}.tsx`);
      expect(src).not.toMatch(/<ScreenHeader[^>]*subtitle=/);
      expect(src).toMatch(/InsightFrame|useReportBottomInset/);
    }
    expect(read('components/analytics/InsightFrame.tsx')).toContain('useTabBarMetrics(2).occupiedHeight');
  });
  it('gate Advanced analytics on the real plan entitlement, client and server', () => {
    const src = read('app/analytics-advanced.tsx');
    expect(src).toContain("import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';");
    expect(src).toContain("plan === 'pro'");
    const api = readFileSync(resolve(ROOT, '../api-server/src/routes/analytics-insights.ts'), 'utf8');
    expect(api).toContain('router.get("/advanced", requirePlan("pro")');
  });
});

describe('best time to post is removed', () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(tsx?|mjs|sql|yaml)$/.test(entry.name)) out.push(full);
    }
    return out;
  };
  it('nothing references it in the mobile app, the API or the database package', () => {
    const files = [...walk(ROOT), ...walk(resolve(ROOT, '../api-server/src')), ...walk(resolve(ROOT, '../../lib/db'))]
      .filter(f => !/\.test\.tsx?$/.test(f)); // tests may assert the old route is gone
    const hits = files.filter(f => /best[-_ ]time|bestTime|BestTime/i.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
    expect(existsSync(resolve(ROOT, 'app/analytics-best-time.tsx'))).toBe(false);
  });
});
