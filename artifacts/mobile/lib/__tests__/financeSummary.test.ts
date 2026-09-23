import { describe, expect, it } from 'vitest';
import {
  activityLabel, buildMoneyTiles, deadlineText, dropOrdersText, dropStateLabel, isEmptySummary, signedCents,
  type FinanceSummary,
} from '../financeSummary';

const money = (amount: number) => ({ amount, formatted: '' });

function summary(overrides: Partial<FinanceSummary> = {}): FinanceSummary {
  return {
    currency: 'usd',
    connected: true,
    stripeError: false,
    held: { ...money(12_345), drops: [{
      dropId: 'd1', name: 'Fall drop', escrowState: 'production', fulfillmentDeadlineAt: null,
      heldCents: 12_345, shortfallCents: 0, ordersHeld: 3, ordersReleased: 1, ordersRefunded: 0,
    }] },
    releasing: { ...money(2_000), count: 1 },
    available: money(5_000),
    pending: money(0),
    paidOut: { ...money(90_000), toBank: money(80_000) },
    owed: money(0),
    credit: money(0),
    lifetime: {
      grossSales: money(100_000), refunded: money(0), platformFees: money(5_000), processingFees: money(3_200),
    },
    activity: [],
    ...overrides,
  };
}

describe('buildMoneyTiles', () => {
  it('shows held, on the way, available and paid out from real amounts', () => {
    const tiles = buildMoneyTiles(summary());
    expect(tiles.map((t) => [t.label, t.value])).toEqual([
      ['Held', '$123.45'],
      ['On the way', '$20.00'],
      ['Available', '$50.00'],
      ['Paid out', '$900.00'],
    ]);
    expect(tiles[0].caption).toBe('1 preorder drop · paid per order as each ships');
    expect(tiles[1].caption).toBe('1 shipped order being transferred');
    expect(tiles[3].caption).toBe('$800.00 reached your bank');
  });

  it('never invents a Stripe balance it could not load', () => {
    const tiles = buildMoneyTiles(summary({ available: null, pending: null, stripeError: true }));
    expect(tiles[2]).toMatchObject({ value: '—', caption: "Couldn't reach Stripe" });
    expect(buildMoneyTiles(summary({ connected: false, available: null }))[2].caption).toBe('Connect Stripe to get paid');
  });

  it('mentions money still settling', () => {
    expect(buildMoneyTiles(summary({ pending: money(1_050) }))[2].caption).toBe('$10.50 still settling');
  });
});

describe('drop helpers', () => {
  it('labels every escrow state in plain English', () => {
    expect(dropStateLabel('collecting').label).toBe('Taking preorders');
    expect(dropStateLabel('failing')).toEqual({ label: 'Refunding buyers', tone: 'caution' });
    expect(dropStateLabel('failed')).toEqual({ label: 'Refunded', tone: 'negative' });
    expect(dropStateLabel(null).label).toBe('Not a preorder');
  });

  it('shows the ship-by deadline only while it matters', () => {
    const now = new Date('2026-09-01T12:00:00Z');
    expect(deadlineText({ escrowState: 'production', fulfillmentDeadlineAt: '2026-09-04T12:00:00Z' }, now))
      .toMatch(/^Ship by Sep \d+ \(3 days left\)$/);
    expect(deadlineText({ escrowState: 'production', fulfillmentDeadlineAt: '2026-10-30T12:00:00Z' }, now))
      .toMatch(/^Ship by Oct \d+$/);
    expect(deadlineText({ escrowState: 'fulfilling', fulfillmentDeadlineAt: '2026-08-01T00:00:00Z' }, now))
      .toBe('Deadline passed — unshipped orders are being refunded');
    expect(deadlineText({ escrowState: 'completed', fulfillmentDeadlineAt: '2026-10-30T12:00:00Z' }, now)).toBeNull();
    expect(deadlineText({ escrowState: 'collecting', fulfillmentDeadlineAt: null }, now)).toBeNull();
  });

  it('summarises order counts', () => {
    expect(dropOrdersText({ ordersHeld: 3, ordersReleased: 1, ordersRefunded: 2 })).toBe('3 waiting to ship · 1 paid out · 2 refunded');
    expect(dropOrdersText({ ordersHeld: 0, ordersReleased: 0, ordersRefunded: 0 })).toBe('No orders yet');
  });
});

describe('activity helpers', () => {
  it('names ledger events, falling back to the server description', () => {
    expect(activityLabel('order_released', null)).toBe('Released for a shipped order');
    expect(activityLabel('something_new', 'Server memo')).toBe('Server memo');
    expect(activityLabel('something_new', null)).toBe('Money movement');
  });

  it('formats signed amounts', () => {
    expect(signedCents(1_234)).toBe('+$12.34');
    expect(signedCents(-50)).toBe('−$0.50');
    expect(signedCents(0)).toBe('—');
  });

  it('recognises a brand-new seller', () => {
    expect(isEmptySummary(summary())).toBe(false);
    expect(isEmptySummary(summary({
      held: { ...money(0), drops: [] }, releasing: { ...money(0), count: 0 },
      paidOut: { ...money(0), toBank: null },
    }))).toBe(true);
  });
});
