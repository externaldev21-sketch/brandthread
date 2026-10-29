/**
 * Audit regression: a merge resurrected the old unconditional cohort table
 * next to the newer conditional one, so the report rendered the same
 * month-by-month cohort rows twice (and a zeroed table above the
 * "Cohorts fill in…" empty note). One table, or the empty note — never both.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const preview = vi.hoisted(() => ({ demo: true }));

vi.mock('@/lib/devPreview', () => ({
  isPreviewDemoMode: () => preview.demo,
  isSellerDevPreview: () => true,
}));
vi.mock('@/lib/api', () => ({ useApi: () => ({ analytics: { advanced: vi.fn() } }) }));
vi.mock('@/components/ScreenHeader', () => ({ ScreenHeader: () => null }));
vi.mock('@/components/ui/ErrorState', () => ({ ErrorState: () => null }));
vi.mock('@/components/analytics/ProLockedState', () => ({ ProLockedState: () => null }));
vi.mock('@/components/analytics/InsightFrame', () => ({ useReportBottomInset: () => 0 }));
vi.mock('@/components/analytics/AnalyticsKit', () => {
  const R = require('react') as typeof import('react');
  const Pass = ({ children }: { children?: React.ReactNode }) => R.createElement(R.Fragment, null, children);
  return {
    AnalyticsBarChart: () => null,
    AnalyticsSkeleton: () => null,
    Card: Pass,
    CardDivider: () => null,
    SectionTitle: Pass,
  };
});

const { default: CohortsReport } = await import('./CohortsReport');

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll((n) => (n.type as unknown) === 'Text')
    .map((n) => [n.props.children].flat().join(''));
}

async function render(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<CohortsReport />);
    await Promise.resolve();
  });
  return renderer;
}

describe('CohortsReport — cohort table renders once', () => {
  it('shows each cohort month exactly once', async () => {
    preview.demo = true;
    const renderer = await render();
    const all = texts(renderer);
    expect(all.filter((t) => t === 'Month')).toHaveLength(1);
    // The demo data's first cohort has 12 customers; one row, not two.
    expect(all.filter((t) => t === '12')).toHaveLength(1);
    renderer.unmount();
  });

  it('shows only the empty note (no zeroed table) when there are no cohorts', async () => {
    preview.demo = false;
    const renderer = await render();
    const all = texts(renderer);
    expect(all).toContain('Cohorts fill in as customers place orders.');
    expect(all.filter((t) => t === 'Month')).toHaveLength(0);
    renderer.unmount();
  });
});
