import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

/** Less-AI pass items 41, 61, 63, 64. */
describe('lists, charts and badges', () => {
  it('charts draw one line with no gridlines', () => {
    expect(read('components/analytics/InsightCharts.tsx')).not.toMatch(/<Line\b/);
    expect(read('components/analytics/AnalyticsKit.tsx')).not.toMatch(/<Line\b/);
    expect(read('components/SellerDashboardChart.tsx')).not.toContain('emptyGridline');
  });

  it('status is a plain word, not a tinted pill', () => {
    const ui = read('components/BrandthreadUI.tsx');
    const badge = ui.slice(ui.indexOf('export function StatusBadge'), ui.indexOf('// ─── EmptyState'));
    expect(badge).not.toMatch(/backgroundColor/);
  });

  it('3-column grids use 1px gaps', () => {
    for (const rel of ['app/buyer-archive.tsx', 'app/live-replays.tsx', 'app/buyer-highlight-stories.tsx']) {
      expect(read(rel), rel).toMatch(/^const GAP = 1;$/m);
    }
  });

  it('one verified badge everywhere a person or brand is verified', () => {
    for (const rel of ['components/discover/DiscoverEntityCard.tsx', 'components/buyer-feed/CaptionBlock.tsx', 'components/search/BrandRow.tsx', 'components/search/PersonRow.tsx', 'components/live/LiveOverlays.tsx', 'components/onboarding/BrandsToFollowStep.tsx']) {
      const src = read(rel);
      expect(src, rel).toContain('<VerifiedBadge');
      expect(src, rel).not.toContain('name="check-circle"');
    }
  });
});
