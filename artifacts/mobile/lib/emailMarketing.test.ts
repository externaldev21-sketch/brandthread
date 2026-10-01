import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/devPreview', () => ({ isPreviewDemoMode: () => false, isSellerDevPreview: () => false }));

import { AUDIENCE_LABEL, DEMO_CAMPAIGNS, emailMode, emptyBody, pct } from './emailMarketing';

describe('emailMarketing helpers', () => {
  it('never reports demo/preview mode outside a dev preview (real API path)', () => {
    expect(emailMode()).toBe('live');
  });
  it('computes rates without dividing by zero', () => {
    expect(pct(0, 0)).toBe('0%');
    expect(pct(1, 3)).toBe('33.3%');
  });
  it('labels every audience and starts with an empty body', () => {
    expect(Object.keys(AUDIENCE_LABEL).sort()).toEqual(['customers', 'followers', 'subscribers']);
    expect(emptyBody().productIds).toEqual([]);
  });
  it('demo fixtures never claim engagement tracking', () => {
    for (const c of DEMO_CAMPAIGNS) expect(c.tracking ?? false).toBe(false);
  });
});
