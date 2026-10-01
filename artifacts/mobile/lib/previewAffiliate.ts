/**
 * Demo-only fixtures for the creator program screens. Returned only under the
 * explicit `&demo=1` preview opt-in (lib/devPreview.ts isPreviewDemoMode()).
 */
import { isPreviewDemoMode } from './devPreview';
import type { CreatorOverview, CreatorPayout, SellerAffiliateOverview } from './affiliateTypes';

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString();

export const EMPTY_CREATOR_OVERVIEW: CreatorOverview = {
  brands: [],
  totals: { clicks: 0, orders: 0, revenueCents: 0, earnedCents: 0, pendingCents: 0, payableCents: 0, paidCents: 0 },
  payout: { available: false, reason: 'Payouts are not configured on this server yet.', connected: false, ready: false },
};

export function getPreviewCreatorOverview(): CreatorOverview {
  if (!isPreviewDemoMode()) return EMPTY_CREATOR_OVERVIEW;
  return {
    brands: [
      {
        id: 'demo-a1', sellerId: 'demo-brand-1', status: 'active', code: 'MAYA10', brandName: 'Northline Studio', brandUsername: 'northline',
        brandImageUrl: null, programEnabled: true, commissionPercent: 12, buyerDiscountPercent: 10, windowDays: 30, holdDays: 30,
        minPayoutCents: 2500, shareLink: 'https://brandthread.app/u/northline?aff=MAYA10',
        stats: { clicks: 482, orders: 19, revenueCents: 142_300, earnedCents: 17_076, pendingCents: 6_480, payableCents: 4_200, paidCents: 6_396 },
      },
      {
        id: 'demo-a2', sellerId: 'demo-brand-2', status: 'active', code: 'MAYAK7', brandName: 'Kiln & Co', brandUsername: 'kilnco',
        brandImageUrl: null, programEnabled: true, commissionPercent: 8, buyerDiscountPercent: 0, windowDays: 14, holdDays: 30,
        minPayoutCents: 2500, shareLink: 'https://brandthread.app/u/kilnco?aff=MAYAK7',
        stats: { clicks: 131, orders: 5, revenueCents: 38_000, earnedCents: 3_040, pendingCents: 1_520, payableCents: 0, paidCents: 1_520 },
      },
      {
        id: 'demo-a3', sellerId: 'demo-brand-3', status: 'pending', code: 'MAYAW3', brandName: 'Wren Knitwear', brandUsername: 'wren',
        brandImageUrl: null, programEnabled: true, commissionPercent: 10, buyerDiscountPercent: 5, windowDays: 30, holdDays: 30,
        minPayoutCents: 2500, shareLink: null,
        stats: { clicks: 0, orders: 0, revenueCents: 0, earnedCents: 0, pendingCents: 0, payableCents: 0, paidCents: 0 },
      },
    ],
    totals: { clicks: 613, orders: 24, revenueCents: 180_300, earnedCents: 20_116, pendingCents: 8_000, payableCents: 4_200, paidCents: 7_916 },
    payout: { available: true, reason: null, connected: true, ready: true },
  };
}

export function getPreviewCreatorPayouts(): CreatorPayout[] {
  if (!isPreviewDemoMode()) return [];
  return [
    { id: 'demo-p1', sellerId: 'demo-brand-1', brandName: 'Northline Studio', amountCents: 6_396, state: 'paid', failureCode: null, paidAt: daysAgo(12), createdAt: daysAgo(12) },
    { id: 'demo-p2', sellerId: 'demo-brand-2', brandName: 'Kiln & Co', amountCents: 1_520, state: 'paid', failureCode: null, paidAt: daysAgo(40), createdAt: daysAgo(40) },
  ];
}

export const EMPTY_SELLER_OVERVIEW: SellerAffiliateOverview = {
  program: { enabled: false, commissionPercent: 10, buyerDiscountPercent: 0, windowDays: 30, holdDays: 30, minPayoutCents: 2500, autoApprove: false },
  creators: [],
  totals: { clicks: 0, orders: 0, revenueCents: 0, earnedCents: 0, pendingCents: 0, payableCents: 0, paidCents: 0 },
  programLink: 'https://brandthread.app/creator-program/join',
  payoutsAvailable: false,
};

export function getPreviewSellerOverview(): SellerAffiliateOverview {
  if (!isPreviewDemoMode()) return EMPTY_SELLER_OVERVIEW;
  const s = (clicks: number, orders: number, rev: number, earned: number, pend: number, pay: number, paid: number) =>
    ({ clicks, orders, revenueCents: rev, earnedCents: earned, pendingCents: pend, payableCents: pay, paidCents: paid });
  return {
    program: { enabled: true, commissionPercent: 12, buyerDiscountPercent: 10, windowDays: 30, holdDays: 30, minPayoutCents: 2500, autoApprove: false },
    creators: [
      { id: 'c1', creatorId: 'u1', status: 'active', origin: 'invite', code: 'MAYA10', commissionPercent: 12, hasOverride: false, username: 'mayarivera', displayName: 'Maya Rivera', avatarUrl: null, stats: s(482, 19, 142_300, 17_076, 6_480, 4_200, 6_396) },
      { id: 'c2', creatorId: 'u2', status: 'active', origin: 'apply', code: 'JONAH5', commissionPercent: 15, hasOverride: true, username: 'jonah.styles', displayName: 'Jonah Park', avatarUrl: null, stats: s(210, 8, 61_900, 9_285, 3_100, 0, 6_185) },
      { id: 'c3', creatorId: 'u3', status: 'pending', origin: 'apply', code: 'AMARA2', commissionPercent: 12, hasOverride: false, username: 'amara', displayName: 'Amara Chen', avatarUrl: null, stats: s(0, 0, 0, 0, 0, 0, 0) },
      { id: 'c4', creatorId: 'u4', status: 'paused', origin: 'invite', code: 'LEOK4', commissionPercent: 12, hasOverride: false, username: 'leok', displayName: 'Leo Kim', avatarUrl: null, stats: s(44, 1, 8_400, 1_008, 0, 0, 1_008) },
    ],
    totals: s(736, 28, 212_600, 27_369, 9_580, 4_200, 13_589),
    programLink: 'https://brandthread.app/creator-program/join?brand=northline',
    payoutsAvailable: true,
  };
}
