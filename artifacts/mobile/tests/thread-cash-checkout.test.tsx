/**
 * Item 109: Thread Cash at checkout.
 *  - the pure rules (ceiling after promo + loyalty, 50¢ card minimum, cap,
 *    unavailable reasons), the re-totalled session and the breakdown lines;
 *  - the seller's payout lines;
 *  - the toggle hook against a fake wallet that behaves like the server:
 *    on applies all it can, off returns the balance, and while on it
 *    follows the order total when a promo code changes it.
 */
import React, { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const wallet = vi.hoisted(() => {
  const state = {
    balance: 0,
    cap: null as number | null,
    tokens: new Map<string, { amount: number; open: boolean }>(),
    seq: 0,
    failNextRedeem: null as string | null,
    calls: [] as string[],
  };
  // Set below, once lib/networkNotice is imported: the API's own error type.
  const errors = { make: (status: number, message: string): Error => new Error(`${status} ${message}`) };
  const error = (status: number, message: string) => errors.make(status, message);
  const api = {
    threadCash: {
      get: vi.fn(async () => ({
        balanceCents: state.balance,
        openRedemptions: [...state.tokens.entries()].filter(([, t]) => t.open).map(([token, t]) => ({ token, amountCents: t.amount, createdAt: '' })),
        config: { maxRedemptionPerOrderCents: state.cap },
        streak: {},
      })),
      redeem: vi.fn(async ({ amountCents }: { amountCents: number }) => {
        state.calls.push(`redeem ${amountCents}`);
        if (state.failNextRedeem) {
          const message = state.failNextRedeem;
          state.failNextRedeem = null;
          throw error(400, message);
        }
        if (amountCents > state.balance) throw error(400, 'Insufficient Thread Cash.');
        state.balance -= amountCents;
        const token = `TCASH-${++state.seq}`;
        state.tokens.set(token, { amount: amountCents, open: true });
        return { ok: true, token, discountCents: amountCents };
      }),
      cancelRedemption: vi.fn(async (token: string) => {
        state.calls.push(`cancel ${token}`);
        const held = state.tokens.get(token);
        if (held?.open) {
          held.open = false;
          state.balance += held.amount;
        }
        return { ok: true, returnedCents: held?.amount ?? 0, balanceCents: state.balance };
      }),
    },
  };
  return { state, api, errors };
});

vi.mock('@/lib/api', () => ({ useApi: () => wallet.api }));
vi.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(36).slice(2)}` }));

import {
  sellerThreadCashPayout, staleRedemptionTokens, threadCashCeilingCents, threadCashTargetCents,
  threadCashUnavailableReason, withThreadCashRedemption,
} from '@/lib/threadCashCheckout';
import { getCheckoutDisplayTotals } from '@/lib/checkoutReadiness';
import { useCheckoutThreadCash, type CheckoutThreadCash } from '@/hooks/useCheckoutThreadCash';
import type { CheckoutSession, CheckoutThreadCashRedemption } from '@/services/cartTypes';
import { ApiError } from '@/lib/networkNotice';

// What the server sends for a ThreadCashError: `{ error, code }`.
wallet.errors.make = (status, message) => new ApiError(status, JSON.stringify({ error: message }));

afterEach(() => {
  wallet.state.balance = 0;
  wallet.state.cap = null;
  wallet.state.tokens.clear();
  wallet.state.calls.length = 0;
  wallet.state.failNextRedeem = null;
});

function session(over: Partial<CheckoutSession> = {}): CheckoutSession {
  return {
    id: 's1', cartId: 'c1', step: 'information', savedAddresses: [],
    deliveryGroups: [{ sellerId: 'seller', sellerName: 'Atelier Noire', items: [], selectedMethodId: 'm', availableMethods: [], hasPreOrder: false }],
    discounts: [],
    summary: { subtotalCents: 5_000, discountTotalCents: 0, shippingTotalCents: 1_200, taxTotalCents: 0, totalCents: 6_200, currency: 'USD' },
    acknowledgments: [], isBuyNow: false, idempotencyKey: 'key-1', createdAt: '', updatedAt: '',
    ...over,
  } as CheckoutSession;
}

describe('Thread Cash checkout rules', () => {
  it('ceiling: order after promo and loyalty, minus the 50¢ card minimum', () => {
    expect(threadCashCeilingCents({ subtotalCents: 5_000, shippingCents: 1_200 })).toBe(6_150);
    expect(threadCashCeilingCents({ subtotalCents: 5_000, shippingCents: 1_200, promoCents: 1_000, loyaltyCents: 200 })).toBe(4_950);
    expect(threadCashCeilingCents({ subtotalCents: 40, shippingCents: 0 })).toBe(0);
  });

  it('on applies the smallest of balance, ceiling and the admin cap', () => {
    expect(threadCashTargetCents({ availableCents: 3_000, ceilingCents: 6_150 })).toBe(3_000);
    expect(threadCashTargetCents({ availableCents: 9_000, ceilingCents: 6_150 })).toBe(6_150);
    expect(threadCashTargetCents({ availableCents: 9_000, ceilingCents: 6_150, perOrderCapCents: 2_500 })).toBe(2_500);
    expect(threadCashUnavailableReason({ availableCents: 0, ceilingCents: 100 })).toBe('no_balance');
    expect(threadCashUnavailableReason({ availableCents: 500, ceilingCents: 0 })).toBe('order_too_small');
    expect(threadCashUnavailableReason({ availableCents: 500, ceilingCents: 100 })).toBeNull();
  });

  it('leftovers: every open redemption except the one this checkout holds', () => {
    expect(staleRedemptionTokens([{ token: 'TCASH-A' }, { token: 'tcash-b' }], 'TCASH-B')).toEqual(['TCASH-A']);
    expect(staleRedemptionTokens(undefined, null)).toEqual([]);
  });

  it('re-totals the session, starts a new payment attempt, and the breakdown adds up with a promo', () => {
    const withPromo = session({ discounts: [{ code: 'TENOFF', isValid: true, appliedAmountCents: 1_000 } as any] });
    const applied = withThreadCashRedemption(withPromo, { token: 'T', discountCents: 2_000 }, 'key-2');
    expect(applied.idempotencyKey).toBe('key-2');
    expect(applied.summary).toMatchObject({ discountTotalCents: 2_000, totalCents: 4_200 });
    const totals = getCheckoutDisplayTotals(applied);
    expect(totals).toMatchObject({ promoCents: 1_000, rewardsCents: 0, threadCashCents: 2_000, orderTotalCents: 5_200, totalCents: 3_200 });
    // Subtotal + shipping − promo = order total; − Thread Cash = card.
    expect(totals.subtotalCents + totals.shippingCents - totals.promoCents).toBe(totals.orderTotalCents);
    expect(totals.orderTotalCents - totals.threadCashCents).toBe(totals.totalCents);

    const off = withThreadCashRedemption(applied, undefined, 'key-3');
    expect(off.summary).toMatchObject({ discountTotalCents: 0, totalCents: 6_200 });
    expect(getCheckoutDisplayTotals(off)).toMatchObject({ threadCashCents: 0, totalCents: 5_200 });
  });

  it('a promo added after Thread Cash still takes its full amount first (never capped by what Thread Cash left)', () => {
    // $110 order, $109.50 Thread Cash on (card $0.50), then TENOFF.
    const hoodie = session({ summary: { subtotalCents: 9_800, discountTotalCents: 0, shippingTotalCents: 1_200, taxTotalCents: 0, totalCents: 11_000, currency: 'USD' } as any });
    const on = withThreadCashRedemption(hoodie, { token: 'T', discountCents: 10_950 }, 'k1');
    const withPromo = { ...on, discounts: [{ code: 'TENOFF', isValid: true, appliedAmountCents: 1_000 } as any] };
    const totals = getCheckoutDisplayTotals(withPromo);
    expect(totals.promoCents).toBe(1_000);
    expect(totals.orderTotalCents).toBe(10_000);
    // The ceiling the toggle follows is computed from these: $100 − 50¢.
    expect(threadCashCeilingCents({ subtotalCents: totals.subtotalCents, shippingCents: totals.shippingCents, promoCents: totals.promoCents })).toBe(9_950);
    // Resized, the card keeps its 50¢.
    const resized = getCheckoutDisplayTotals(withThreadCashRedemption(withPromo, { token: 'T2', discountCents: 9_950 }, 'k2'));
    expect(resized).toMatchObject({ promoCents: 1_000, threadCashCents: 9_950, orderTotalCents: 10_000, totalCents: 50 });
  });

  it('keeps loyalty rewards separate from Thread Cash', () => {
    const s = withThreadCashRedemption(session({ loyaltyRedemption: { token: 'L', discountCents: 300, pointsRedeemed: 300 } as any }), { token: 'T', discountCents: 1_000 }, 'k');
    expect(getCheckoutDisplayTotals(s)).toMatchObject({ rewardsCents: 300, threadCashCents: 1_000, totalCents: 4_900 });
  });
});

describe("seller's payout on a Thread Cash order", () => {
  it('card + Thread Cash − fees, with the promo as a note (never taken twice)', () => {
    const payout = sellerThreadCashPayout({
      totalCents: 3_200, discountAmountCents: 3_000, threadCashAppliedCents: 2_000, platformFeeCents: 200, processingFeeChargedCents: 181,
    })!;
    expect(payout.lines.map(l => [l.key, l.cents])).toEqual([['card', 3_200], ['thread_cash', 2_000], ['platform_fee', -200], ['processing', -181]]);
    expect(payout.lines[0].note).toBe('After your $10.00 promo code');
    expect(payout.lines[1].note).toBe('Paid to you by Brandthread');
    expect(payout.payoutCents).toBe(3_200 + 2_000 - 200 - 181);
    expect(payout.lines.reduce((sum, l) => sum + l.cents, 0)).toBe(payout.payoutCents);
  });

  it('is absent for an order without Thread Cash', () => {
    expect(sellerThreadCashPayout({ totalCents: 5_000, threadCashAppliedCents: 0 })).toBeNull();
    expect(sellerThreadCashPayout({})).toBeNull();
  });
});

// ─── The toggle hook ──────────────────────────────────────────────────────────

let latest!: CheckoutThreadCash;
let latestRedemption: CheckoutThreadCashRedemption | null = null;
let setCeiling!: (cents: number) => void;

function Harness({ initialCeiling, initialRedemption = null }: { initialCeiling: number; initialRedemption?: CheckoutThreadCashRedemption | null }) {
  const [ceilingCents, setCeilingState] = useState(initialCeiling);
  const [redemption, setRedemption] = useState<CheckoutThreadCashRedemption | null>(initialRedemption);
  setCeiling = setCeilingState;
  latestRedemption = redemption;
  latest = useCheckoutThreadCash({
    enabled: true, redemption, ceilingCents,
    onChange: async (next) => { setRedemption(next ?? null); },
  });
  return null;
}

async function settle(ms = 0) {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, ms));
  });
}

async function mount(props: React.ComponentProps<typeof Harness>) {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<Harness {...props} />); });
  await settle();
  return renderer;
}

describe('useCheckoutThreadCash', () => {
  it('loads the balance and first returns leftovers from abandoned checkouts', async () => {
    wallet.state.balance = 1_000;
    wallet.state.tokens.set('TCASH-OLD', { amount: 700, open: true });
    const r = await mount({ initialCeiling: 6_150 });
    expect(wallet.state.calls).toEqual(['cancel TCASH-OLD']);
    expect(latest).toMatchObject({ ready: true, balanceCents: 1_700, targetCents: 1_700, unavailable: null });
    r.unmount();
  });

  it('on applies all it can; off gives it all back', async () => {
    wallet.state.balance = 3_000;
    const r = await mount({ initialCeiling: 6_150 });
    await act(async () => { latest.setOn(true); });
    await settle();
    expect(latestRedemption).toMatchObject({ discountCents: 3_000 });
    expect(latest).toMatchObject({ appliedCents: 3_000, balanceCents: 0, busy: false });

    await act(async () => { latest.setOn(false); });
    await settle();
    expect(latestRedemption).toBeNull();
    expect(wallet.state.balance).toBe(3_000);
    expect(latest.balanceCents).toBe(3_000);
    r.unmount();
  });

  it('follows the total: a promo shrinks it, removing the promo grows it back', async () => {
    wallet.state.balance = 6_000;
    const r = await mount({ initialCeiling: 6_150 });
    await act(async () => { latest.setOn(true); });
    await settle();
    expect(latest.appliedCents).toBe(6_000);

    // TENOFF: the order can now take $51.50.
    await act(async () => { setCeiling(5_150); });
    await settle(450);
    expect(latest.appliedCents).toBe(5_150);
    expect(latest.notice).toBe('Updated to $51.50 to fit your new total.');
    expect(wallet.state.balance).toBe(850);

    await act(async () => { setCeiling(6_150); });
    await settle(450);
    expect(latest.appliedCents).toBe(6_000);
    expect(wallet.state.balance).toBe(0);
    // Every step returned the old token before taking a new one: nothing is left open.
    expect([...wallet.state.tokens.values()].filter(t => t.open)).toHaveLength(1);
    r.unmount();
  });

  it('turns itself off, with a note, when the order can no longer take any', async () => {
    wallet.state.balance = 500;
    const r = await mount({ initialCeiling: 6_150 });
    await act(async () => { latest.setOn(true); });
    await settle();
    await act(async () => { setCeiling(0); });
    await settle(450);
    expect(latestRedemption).toBeNull();
    expect(wallet.state.balance).toBe(500);
    expect(latest.notice).toMatch(/needs at least \$0\.50 on your card/);
    expect(latest.unavailable).toBe('order_too_small');
    r.unmount();
  });

  it("shows the server's reason when it refuses, and leaves the balance intact", async () => {
    wallet.state.balance = 2_000;
    wallet.state.failNextRedeem = 'Your Thread Cash account has been frozen. Contact support.';
    const r = await mount({ initialCeiling: 6_150 });
    await act(async () => { latest.setOn(true); });
    await settle();
    expect(latest.error).toBe('Your Thread Cash account has been frozen. Contact support.');
    expect(latestRedemption).toBeNull();
    expect(latest.balanceCents).toBe(2_000);
    r.unmount();
  });

  it('shows "no balance" and "order too small" as reasons, not a dead switch', async () => {
    const r = await mount({ initialCeiling: 6_150 });
    expect(latest.unavailable).toBe('no_balance');
    r.unmount();
    wallet.state.balance = 900;
    const r2 = await mount({ initialCeiling: 0 });
    expect(latest.unavailable).toBe('order_too_small');
    r2.unmount();
  });
});
