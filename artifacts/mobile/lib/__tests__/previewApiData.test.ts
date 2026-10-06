import { describe, expect, it, vi } from 'vitest';

const demoOrders = vi.hoisted(() => [{ id: 'preview-order-seller-1', totalCents: 18500, status: 'processing' }]);
// lib/previewOrders.ts gates itself on demo mode; stub it so this suite only
// checks what previewApiData does with it.
vi.mock('../previewOrders', () => ({ getPreviewSellerOrders: () => demoOrders }));

import { previewApiPaths, resolvePreviewApiResponse } from '../previewApiData';
import { getPreviewAccount } from '../previewAccount';

const NOW = new Date('2026-10-06T12:00:00.000Z');
const fresh = (role: 'seller' | 'buyer' = 'seller') => ({ role, demo: false, now: NOW } as const);
const demo = (role: 'seller' | 'buyer' = 'seller') => ({ role, demo: true, now: NOW } as const);

describe('previewApiData', () => {
  it('answers every endpoint the audit saw the preview call with a 401', () => {
    // From docs/audit/findings.json (security/preview) — the ones that exist on dev.
    for (const path of [
      '/api/v1/seller/profile', '/api/v1/auth/account/deletion-check', '/api/v1/discount-codes',
      '/api/v1/finance/balance', '/api/v1/integrations/klaviyo', '/api/v1/referrals/stats',
      '/api/v1/seller/connect/status', '/api/v1/shopify/status', '/api/v1/social/followers',
      '/api/v1/store/versions', '/api/v1/team/members', '/api/v1/waitlist/seller', '/api/v1/drops',
      '/api/v1/moderation/me', '/api/v1/seller/subscription/status', '/api/v1/auth/feed-gestures-tip',
      '/api/v1/social/following', '/api/v1/store', '/api/v1/products', '/api/v1/freelancers/me',
      '/api/v1/safety/muted-words', '/api/v1/social/blocks', '/api/v1/public/search/recent?limit=30',
      '/api/v1/bundles', '/api/v1/disputes', '/api/v1/finance/summary', '/api/v1/finance/transactions?limit=20',
      '/api/v1/seller/verification/status', '/api/v1/seller/settings/integrations', '/api/v1/seller/settings',
      '/api/v1/seller/locations', '/api/v1/seller/metafields', '/api/v1/finance/payouts?limit=10',
      '/api/v1/auth/privacy', '/api/v1/team/roles', '/api/v1/orders', '/api/v1/returns',
      '/api/v1/shipping-rates', '/api/v1/shipping-zones/settings', '/api/v1/shopify-imports/latest',
      '/api/v1/seller/settings/policies', '/api/v1/auth/me', '/api/v1/taxes/status',
      '/api/v1/team/activity?limit=20', '/api/v1/seller/vacation',
    ]) {
      expect(resolvePreviewApiResponse(path, fresh()), path).not.toBeNull();
    }
  });

  it('fresh lists are empty — a new account has nothing yet', () => {
    for (const path of ['/api/orders', '/api/products', '/api/discount-codes', '/api/drops', '/api/social/blocks', '/api/store/versions']) {
      expect(resolvePreviewApiResponse(path, fresh())!.data).toEqual([]);
    }
    expect(resolvePreviewApiResponse('/api/public/search/recent', fresh('buyer'))!.data).toEqual({ recent: [] });
    expect(resolvePreviewApiResponse('/api/safety/muted-words', fresh('buyer'))!.data).toEqual({ words: [], limit: 200 });
  });

  it('fresh profile carries only what onboarding sets — no sample bio, website, location or socials (QA-0087)', () => {
    const profile = resolvePreviewApiResponse('/api/seller/profile', fresh())!.data as Record<string, unknown>;
    const account = getPreviewAccount('seller', false);
    expect(profile).toMatchObject({
      displayName: account.name, username: account.username,
      bio: null, website: null, location: null, contactEmail: null, category: null, socialLinks: {},
      metrics: { revenueCents: 0, visitors: 0, orders: 0, conversionRate: 0 },
    });
  });

  it('demo fills the same identity in and serves the seeded orders the Orders tab shows (QA-0119)', () => {
    const profile = resolvePreviewApiResponse('/api/seller/profile', demo())!.data as Record<string, any>;
    expect(profile.displayName).toBe(getPreviewAccount('seller', false).name);
    expect(profile.bio).toBeTruthy();
    expect(profile.metrics.orders).toBe(demoOrders.length);
    expect(resolvePreviewApiResponse('/api/orders', demo())!.data).toBe(demoOrders);
    expect(resolvePreviewApiResponse('/api/orders', fresh())!.data).toEqual([]);
    // A buyer preview never sees the seller's orders.
    expect(resolvePreviewApiResponse('/api/orders', demo('buyer'))!.data).toEqual([]);
  });

  it('demo seller is coherent: paid orders imply connected payouts and a published store', () => {
    expect(resolvePreviewApiResponse('/api/seller/connect/status', demo())!.data).toMatchObject({ connected: true, payoutsEnabled: true });
    expect(resolvePreviewApiResponse('/api/seller/connect/status', fresh())!.data).toMatchObject({ connected: false, status: 'not_started' });
    expect(resolvePreviewApiResponse('/api/store', demo())!.data).toMatchObject({ status: 'published' });
    expect(resolvePreviewApiResponse('/api/store', fresh())!.data).toMatchObject({ status: 'draft', title: 'My Store' });
  });

  it('deletion check matches the server for each role, with nothing blocking a fresh account (QA-0069..0071)', () => {
    expect(resolvePreviewApiResponse('/api/auth/account/deletion-check', fresh('buyer'))!.data).toMatchObject({ canDelete: true, accountType: 'buyer', blockers: [] });
    expect(resolvePreviewApiResponse('/api/auth/account/deletion-check', fresh('seller'))!.data).toMatchObject({ canDelete: true, accountType: 'seller', blockers: [] });
  });

  it('team shows only the owner (QA-0169, QA-0171)', () => {
    const members = resolvePreviewApiResponse('/api/team/members', fresh())!.data as Array<Record<string, unknown>>;
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ role: 'owner', isOwner: true, status: 'active' });
  });

  it('does not answer paths it does not know (the guard then rejects them locally)', () => {
    expect(resolvePreviewApiResponse('/api/seller/giveaways/rules-template?prizeText=x', fresh())).toBeNull();
    expect(resolvePreviewApiResponse('/api/seller/giveaways', fresh())!.data).toEqual({ giveaways: [] });
    expect(resolvePreviewApiResponse('/api/ai-helpers/caption', fresh())).toBeNull();
    expect(previewApiPaths().some((p) => p.startsWith('ai') || p.includes('upload'))).toBe(false);
  });
});

describe('previewAccount', () => {
  it('fresh has a name and username only; demo adds the rest', () => {
    const f = getPreviewAccount('buyer', false);
    expect(f.name).toBeTruthy();
    expect(f.username).toBeTruthy();
    expect([f.email, f.bio, f.website, f.location, f.pronouns, f.phone, f.instagram, f.tiktok]).toEqual(['', '', '', '', '', '', '', '']);
    const d = getPreviewAccount('buyer', true);
    expect(d.name).toBe(f.name);
    expect(d.email).toBeTruthy();
  });
});
