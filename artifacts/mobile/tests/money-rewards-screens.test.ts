/**
 * Money & rewards screens: the Rewards points input drives Redeem, failed
 * loads never show fake defaults, and Thread Cash rules say "Check in daily".
 * Pure-logic checks for lib/loyaltyTerms.ts plus source-text structure checks
 * in the repo's usual style.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LOYALTY_MIN_REDEEM_POINTS, checkRedeemPoints, loyaltyPointsToCents,
} from '@/lib/loyaltyTerms';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('loyalty terms', () => {
  it('matches the server: 100 points = $1.00, minimum 100', () => {
    expect(loyaltyPointsToCents(100)).toBe(100);
    expect(loyaltyPointsToCents(1240)).toBe(1240);
    expect(LOYALTY_MIN_REDEEM_POINTS).toBe(100);
    const route = read('../api-server/src/routes/loyalty.ts');
    expect(route).toContain('const discountCents = points;');
    expect(route).toContain('points < 100');
  });

  it('validates the entered points against the minimum and the balance', () => {
    expect(checkRedeemPoints('', 500)).toEqual({ ok: false, points: 0, message: null });
    expect(checkRedeemPoints('50', 500)).toMatchObject({ ok: false, message: 'Use at least 100 points.' });
    expect(checkRedeemPoints('600', 500)).toMatchObject({ ok: false, message: 'You have 500 points available.' });
    expect(checkRedeemPoints('100', 50)).toMatchObject({ ok: false, message: 'You need at least 100 points to redeem.' });
    expect(checkRedeemPoints('250', 500)).toEqual({ ok: true, points: 250, discountCents: 250 });
  });
});

describe('Rewards screen', () => {
  const src = read('app/loyalty.tsx');
  it('drives Redeem and the preview from the entered points', () => {
    expect(src).toContain('checkRedeemPoints(redeemPts, balance)');
    expect(src).toContain('disabled={!canRedeem}');
    expect(src).toContain('redeemPoints: String(redeemCheck.points)');
    expect(src).not.toContain('redeeming');
    expect(src).not.toMatch(/'500 pts per referral'|headerBack/);
  });
  it('the cart prefills the points handed over from Rewards', () => {
    const cart = read('app/(buyer)/cart.tsx');
    expect(cart).toContain('redeemPoints: redeemPointsParam');
    expect(cart).toContain('setPointsInput(redeemPointsParam)');
  });
});

describe('Thread Cash screens', () => {
  it('rules say "Check in daily", never "keep the app open"', () => {
    const src = read('app/thread-cash.tsx');
    expect(src).toContain('Check in daily to earn Thread Cash');
    expect(src).not.toMatch(/Keep the app open/i);
  });
  it('a failed load shows a retry in the streak card, not default terms', () => {
    expect(read('app/thread-cash.tsx')).toContain('thread-cash-streak-retry');
  });
  it('the ledger clears rows and retries per filter, and Show more fails loudly', () => {
    const src = read('app/thread-cash-ledger.tsx');
    expect(src).toContain('thread-cash-ledger-retry');
    expect(src).toContain('thread-cash-ledger-more-retry');
    expect(src).toContain('seq !== requestSeq.current');
  });
  it('seller history hides running balances until the balance is known', () => {
    const src = read('app/thread-cash-history.tsx');
    expect(src).toContain("balanceAfter == null ? '—'");
    expect(src).not.toContain('formatCents(balanceCents ?? 0)');
  });
});

describe('gift card screens', () => {
  it('card history is keyed by card id with loading and retry', () => {
    const src = read('app/buyer-gift-cards.tsx');
    expect(src).toContain('historyById[card.id]');
    expect(src).toContain('gift-card-history-retry');
    expect(src).not.toContain('marginTop: 25');
  });
  it('buy screen retries a failed load and never sends a made-up billing name', () => {
    const src = read('app/gift-card-buy.tsx');
    expect(src).toContain('<ErrorState');
    expect(src).not.toContain('Gift card buyer');
    expect(src).toContain('name: buyerName');
  });
  it('invite landing uses the referral constants, not a hardcoded $10', () => {
    const src = read('app/invite/[code].tsx');
    expect(src).not.toContain('$10');
    expect(src).toContain('formatMoney(REFERRAL_GIVE_CENTS)');
  });
});
