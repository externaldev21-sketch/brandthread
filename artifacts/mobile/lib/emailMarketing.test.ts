import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/devPreview', () => ({ isPreviewDemoMode: () => false, isSellerDevPreview: () => false }));

import { AUDIENCE_LABEL, DEMO_CAMPAIGNS, EMPTY_AUDIENCE, appendSubscriberPage, emailMode, emptyBody, pct, signupTotal } from './emailMarketing';

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

describe('Recent signups paging', () => {
  const row = (id: string) => ({ id, email: `${id}@example.com`, status: 'subscribed', source: 'store_site', createdAt: '2026-01-01T00:00:00.000Z' });
  it('totals every status on the list', () => {
    expect(signupTotal({ subscribed: 128, unsubscribed: 6, pending: 0, bounced: 1 })).toBe(135);
    expect(signupTotal({})).toBe(0);
  });
  it('appends the next page, skipping rows already shown, and takes its hasMore', () => {
    const first = { ...EMPTY_AUDIENCE, subscribers: [row('a'), row('b')], hasMore: true };
    const next = { ...EMPTY_AUDIENCE, subscribers: [row('b'), row('c')], hasMore: false };
    const merged = appendSubscriberPage(first, next);
    expect(merged.subscribers.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(merged.hasMore).toBe(false);
  });
});
