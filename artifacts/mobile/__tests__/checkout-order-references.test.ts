/**
 * Focused tests for the checkout → confirmed order reference lifecycle.
 *
 * Invariants under test:
 *   1. Fresh verification: both orderId AND orderNumber must be captured; orderId drives routing.
 *   2. Restored checkout: only entries with orderId in paidGroups produce a VerifiedOrder.
 *      Legacy entries with only orderNumber re-enter pending for reconciliation.
 *   3. Multi-seller: each seller group produces an independent VerifiedOrder; all are collected.
 *   4. Absent orderId: when verify returns orderId=null, entry stays pending; "View purchase"
 *      must NOT be exposed (no ID → no route).
 *   5. Correct route: buyer-order-detail is always navigated with orderId, never orderNumber.
 *   6. refreshOrders reconciliation: pending entries upgraded to VerifiedOrder when
 *      a subsequent verify call returns orderId.
 */

import { describe, it, expect } from 'vitest';

// ─── Type mirror (matches buyer-checkout.tsx VerifiedOrder) ───────────────────

interface VerifiedOrder {
  id: string;
  number: string;
  sellerId: string;
}

// ─── Mirrors the paidGroups record shape from cartTypes.ts ────────────────────

interface PaidGroupEntry {
  stripeSessionId: string;
  orderId?: string;
  orderNumber?: string;
  amountTotalCents?: number;
  guestAccessToken?: string;
}

// ─── Logic extracted from buyer-checkout for unit testing ─────────────────────

/**
 * Restores VerifiedOrder[] and pending session strings from a persisted paidGroups map.
 * Mirrors the restoration block inside BuyerCheckoutScreen's init useEffect.
 */
function restorePaidState(paidGroups: Record<string, PaidGroupEntry>): {
  verified: VerifiedOrder[];
  pending: string[];
} {
  const verified: VerifiedOrder[] = [];
  const pending: string[] = [];

  for (const [sellerId, payment] of Object.entries(paidGroups)) {
    if (payment.orderId && payment.orderNumber) {
      verified.push({ id: payment.orderId, number: payment.orderNumber, sellerId });
    } else if (payment.orderId && !payment.orderNumber) {
      // id present but no display number — still navigable; use id as display fallback
      verified.push({ id: payment.orderId, number: payment.orderId, sellerId });
    } else {
      // No orderId — needs re-verification
      pending.push(
        payment.guestAccessToken
          ? `${payment.stripeSessionId}|${payment.guestAccessToken}`
          : payment.stripeSessionId,
      );
    }
  }

  return { verified, pending };
}

/**
 * Processes a single verify response and returns the VerifiedOrder when orderId is present.
 * Mirrors the inner logic of pay() after the WebBrowser returns.
 */
function processVerifyResponse(
  sellerId: string,
  verification: { paymentStatus: string; orderId: string | null; orderNumber: string | null; amountTotal: number | null },
): VerifiedOrder | null {
  if (verification.paymentStatus !== 'paid') return null;
  if (!verification.orderId) return null;
  return {
    id: verification.orderId,
    number: verification.orderNumber ?? verification.orderId,
    sellerId,
  };
}

/**
 * Determines whether the "View purchase" button should be rendered.
 * Mirrors: `{firstVerified?.id && <TouchableOpacity ...>View purchase</TouchableOpacity>}`
 */
function viewPurchaseVisible(verifiedOrders: VerifiedOrder[]): boolean {
  return verifiedOrders.length > 0 && !!verifiedOrders[0].id;
}

/**
 * Returns the route target for buyer-order-detail.
 * Must always be orderId — never orderNumber.
 */
function orderDetailRoute(verifiedOrders: VerifiedOrder[]): string | null {
  const first = verifiedOrders[0];
  if (!first?.id) return null;
  return `/buyer-order-detail?id=${encodeURIComponent(first.id)}`;
}

/**
 * Serialises a VerifiedOrder into the paidGroups entry that would be persisted to AsyncStorage.
 */
function toPaidGroupEntry(vo: VerifiedOrder, stripeSessionId: string): PaidGroupEntry {
  return {
    stripeSessionId,
    orderId: vo.id,
    orderNumber: vo.number,
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('1. Fresh verification — verify response captured correctly', () => {
  it('produces a VerifiedOrder with both id and number when verify returns both', () => {
    const vo = processVerifyResponse('seller-A', {
      paymentStatus: 'paid',
      orderId: 'uuid-order-001',
      orderNumber: 'BT-1001',
      amountTotal: 4999,
    });
    expect(vo).not.toBeNull();
    expect(vo!.id).toBe('uuid-order-001');
    expect(vo!.number).toBe('BT-1001');
    expect(vo!.sellerId).toBe('seller-A');
  });

  it('falls back to orderId as display number when orderNumber is absent', () => {
    const vo = processVerifyResponse('seller-A', {
      paymentStatus: 'paid',
      orderId: 'uuid-order-002',
      orderNumber: null,
      amountTotal: null,
    });
    expect(vo!.id).toBe('uuid-order-002');
    expect(vo!.number).toBe('uuid-order-002'); // orderId used as display fallback
  });

  it('returns null when paymentStatus is not paid', () => {
    const vo = processVerifyResponse('seller-A', {
      paymentStatus: 'unpaid',
      orderId: 'uuid-order-003',
      orderNumber: 'BT-1003',
      amountTotal: null,
    });
    expect(vo).toBeNull();
  });

  it('returns null when orderId is absent even if payment is paid', () => {
    const vo = processVerifyResponse('seller-A', {
      paymentStatus: 'paid',
      orderId: null,
      orderNumber: 'BT-1004',
      amountTotal: 5000,
    });
    expect(vo).toBeNull();
  });

  it('persists orderId alongside orderNumber to paidGroups entry', () => {
    const vo: VerifiedOrder = { id: 'uuid-order-005', number: 'BT-1005', sellerId: 'seller-A' };
    const entry = toPaidGroupEntry(vo, 'cs_stripe_abc');
    expect(entry.orderId).toBe('uuid-order-005');
    expect(entry.orderNumber).toBe('BT-1005');
    expect(entry.stripeSessionId).toBe('cs_stripe_abc');
  });
});

describe('2. Restored checkout — paidGroups → VerifiedOrder[]', () => {
  it('fully verified entry (orderId + orderNumber) → VerifiedOrder, no pending', () => {
    const { verified, pending } = restorePaidState({
      'seller-A': { stripeSessionId: 'cs_1', orderId: 'uuid-001', orderNumber: 'BT-1001' },
    });
    expect(verified).toHaveLength(1);
    expect(verified[0].id).toBe('uuid-001');
    expect(verified[0].number).toBe('BT-1001');
    expect(pending).toHaveLength(0);
  });

  it('legacy entry (only orderNumber, no orderId) → pending for re-verification', () => {
    const { verified, pending } = restorePaidState({
      'seller-A': { stripeSessionId: 'cs_2', orderNumber: 'BT-1002' },
    });
    expect(verified).toHaveLength(0);
    expect(pending).toContain('cs_2');
  });

  it('entry with orderId but no orderNumber → navigable, id used as display', () => {
    const { verified, pending } = restorePaidState({
      'seller-A': { stripeSessionId: 'cs_3', orderId: 'uuid-003' },
    });
    expect(verified).toHaveLength(1);
    expect(verified[0].id).toBe('uuid-003');
    expect(verified[0].number).toBe('uuid-003'); // fallback: id as display
    expect(pending).toHaveLength(0);
  });

  it('entry with no orderId and no orderNumber → pending', () => {
    const { verified, pending } = restorePaidState({
      'seller-A': { stripeSessionId: 'cs_4' },
    });
    expect(verified).toHaveLength(0);
    expect(pending).toContain('cs_4');
  });

  it('guest entry encodes stripeSessionId|guestAccessToken into pending', () => {
    const { pending } = restorePaidState({
      'seller-A': {
        stripeSessionId: 'cs_guest_5',
        guestAccessToken: 'ga_token_xyz',
      },
    });
    expect(pending).toContain('cs_guest_5|ga_token_xyz');
  });

  it('mixed entries: verified and pending coexist correctly', () => {
    const { verified, pending } = restorePaidState({
      'seller-A': { stripeSessionId: 'cs_6', orderId: 'uuid-006', orderNumber: 'BT-1006' },
      'seller-B': { stripeSessionId: 'cs_7' }, // no orderId
    });
    expect(verified).toHaveLength(1);
    expect(verified[0].sellerId).toBe('seller-A');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toBe('cs_7');
  });
});

describe('3. Multi-seller — each group produces independent VerifiedOrder', () => {
  it('two seller groups both verified → two VerifiedOrders', () => {
    const voA = processVerifyResponse('seller-A', {
      paymentStatus: 'paid',
      orderId: 'uuid-A',
      orderNumber: 'BT-A',
      amountTotal: 2500,
    });
    const voB = processVerifyResponse('seller-B', {
      paymentStatus: 'paid',
      orderId: 'uuid-B',
      orderNumber: 'BT-B',
      amountTotal: 3500,
    });
    const confirmed = [voA!, voB!];
    expect(confirmed).toHaveLength(2);
    expect(confirmed[0].id).toBe('uuid-A');
    expect(confirmed[1].id).toBe('uuid-B');
    // Each has a distinct sellerId
    expect(confirmed.map(o => o.sellerId)).toEqual(['seller-A', 'seller-B']);
  });

  it('paidGroups persistence carries orderId for all sellers', () => {
    const entries: Record<string, PaidGroupEntry> = {};
    for (const vo of [
      { id: 'uuid-A', number: 'BT-A', sellerId: 'seller-A' },
      { id: 'uuid-B', number: 'BT-B', sellerId: 'seller-B' },
    ] satisfies VerifiedOrder[]) {
      entries[vo.sellerId] = toPaidGroupEntry(vo, `cs_${vo.sellerId}`);
    }
    expect(entries['seller-A'].orderId).toBe('uuid-A');
    expect(entries['seller-B'].orderId).toBe('uuid-B');

    // Restore round-trip
    const { verified } = restorePaidState(entries);
    expect(verified).toHaveLength(2);
    expect(verified.map(v => v.id).sort()).toEqual(['uuid-A', 'uuid-B']);
  });
});

describe('4. Absent orderId — View purchase hidden, never routed', () => {
  it('viewPurchaseVisible is false when verifiedOrders is empty', () => {
    expect(viewPurchaseVisible([])).toBe(false);
  });

  it('viewPurchaseVisible is true only when at least one VerifiedOrder with id exists', () => {
    const orders: VerifiedOrder[] = [{ id: 'uuid-001', number: 'BT-1001', sellerId: 'seller-A' }];
    expect(viewPurchaseVisible(orders)).toBe(true);
  });

  it('orderDetailRoute returns null when no verified orders', () => {
    expect(orderDetailRoute([])).toBeNull();
  });

  it('orderDetailRoute is null if first entry has empty id (should not occur in practice)', () => {
    // Defensive: if somehow an entry with empty id snuck in
    const orders: VerifiedOrder[] = [{ id: '', number: 'BT-X', sellerId: 'seller-A' }];
    expect(orderDetailRoute(orders)).toBeNull();
  });
});

describe('5. Correct route — orderId drives navigation, orderNumber is display only', () => {
  it('orderDetailRoute uses orderId as the ?id= query parameter', () => {
    const orders: VerifiedOrder[] = [{ id: 'uuid-order-nav-001', number: 'BT-9001', sellerId: 'seller-A' }];
    const route = orderDetailRoute(orders);
    expect(route).toBe('/buyer-order-detail?id=uuid-order-nav-001');
    // Must NOT contain the orderNumber
    expect(route).not.toContain('BT-9001');
  });

  it('orderDetailRoute URI-encodes the orderId', () => {
    const orders: VerifiedOrder[] = [{ id: 'order id with spaces', number: 'BT-X', sellerId: 's' }];
    const route = orderDetailRoute(orders);
    expect(route).toBe('/buyer-order-detail?id=order%20id%20with%20spaces');
  });

  it('orderDetailRoute uses first seller when multiple verified orders exist', () => {
    const orders: VerifiedOrder[] = [
      { id: 'uuid-first', number: 'BT-1', sellerId: 'seller-A' },
      { id: 'uuid-second', number: 'BT-2', sellerId: 'seller-B' },
    ];
    const route = orderDetailRoute(orders);
    expect(route).toBe('/buyer-order-detail?id=uuid-first');
  });
});

describe('6. refreshOrders reconciliation — pending upgraded when orderId arrives', () => {
  /**
   * Simulates one reconciliation pass: a set of pending session strings
   * each get verified; those that return orderId are promoted to VerifiedOrder.
   */
  function reconcile(
    pending: string[],
    paidGroups: Record<string, PaidGroupEntry>,
    verifyFn: (sessionId: string, guestToken?: string) => {
      orderId: string | null;
      orderNumber: string | null;
      amountTotal: number | null;
    },
  ): { promoted: VerifiedOrder[]; stillPending: string[] } {
    const promoted: VerifiedOrder[] = [];
    const stillPending: string[] = [];

    for (const token of pending) {
      const [sessionId, guestToken] = token.split('|');
      const result = verifyFn(sessionId, guestToken);
      if (result.orderId) {
        const sellerId = Object.entries(paidGroups)
          .find(([, p]) => p.stripeSessionId === sessionId)?.[0] ?? '';
        promoted.push({
          id: result.orderId,
          number: result.orderNumber ?? result.orderId,
          sellerId,
        });
      } else {
        stillPending.push(token);
      }
    }
    return { promoted, stillPending };
  }

  it('pending session upgraded to VerifiedOrder when orderId becomes available', () => {
    const paidGroups: Record<string, PaidGroupEntry> = {
      'seller-A': { stripeSessionId: 'cs_pending_1' },
    };
    const { promoted, stillPending } = reconcile(
      ['cs_pending_1'],
      paidGroups,
      () => ({ orderId: 'uuid-reconciled-1', orderNumber: 'BT-R001', amountTotal: 4200 }),
    );
    expect(promoted).toHaveLength(1);
    expect(promoted[0].id).toBe('uuid-reconciled-1');
    expect(promoted[0].number).toBe('BT-R001');
    expect(stillPending).toHaveLength(0);
  });

  it('session stays pending when orderId is still null after reconciliation', () => {
    const paidGroups: Record<string, PaidGroupEntry> = {
      'seller-A': { stripeSessionId: 'cs_pending_2' },
    };
    const { promoted, stillPending } = reconcile(
      ['cs_pending_2'],
      paidGroups,
      () => ({ orderId: null, orderNumber: null, amountTotal: null }),
    );
    expect(promoted).toHaveLength(0);
    expect(stillPending).toContain('cs_pending_2');
  });

  it('guest pending token (sid|guestToken) is split correctly for reconciliation', () => {
    const paidGroups: Record<string, PaidGroupEntry> = {
      'seller-A': { stripeSessionId: 'cs_guest_3', guestAccessToken: 'ga_xyz' },
    };
    const calls: Array<{ sessionId: string; guestToken?: string }> = [];
    const { promoted } = reconcile(
      ['cs_guest_3|ga_xyz'],
      paidGroups,
      (sessionId, guestToken) => {
        calls.push({ sessionId, guestToken });
        return { orderId: 'uuid-guest-3', orderNumber: 'BT-G003', amountTotal: 1500 };
      },
    );
    expect(calls[0].sessionId).toBe('cs_guest_3');
    expect(calls[0].guestToken).toBe('ga_xyz');
    expect(promoted[0].id).toBe('uuid-guest-3');
  });

  it('partial reconciliation: one resolves, one stays pending', () => {
    const paidGroups: Record<string, PaidGroupEntry> = {
      'seller-A': { stripeSessionId: 'cs_A' },
      'seller-B': { stripeSessionId: 'cs_B' },
    };
    let callCount = 0;
    const { promoted, stillPending } = reconcile(
      ['cs_A', 'cs_B'],
      paidGroups,
      (sessionId) => {
        callCount++;
        if (sessionId === 'cs_A') return { orderId: 'uuid-A', orderNumber: 'BT-A', amountTotal: null };
        return { orderId: null, orderNumber: null, amountTotal: null };
      },
    );
    expect(callCount).toBe(2);
    expect(promoted).toHaveLength(1);
    expect(promoted[0].id).toBe('uuid-A');
    expect(stillPending).toContain('cs_B');
  });
});

describe('Type invariants — paidGroups schema', () => {
  it('orderId and orderNumber are independent optional fields', () => {
    // Both present
    const both: PaidGroupEntry = { stripeSessionId: 'cs_1', orderId: 'id', orderNumber: 'num' };
    expect(both.orderId).toBe('id');
    expect(both.orderNumber).toBe('num');

    // Only orderId (new sessions)
    const idOnly: PaidGroupEntry = { stripeSessionId: 'cs_2', orderId: 'id2' };
    expect(idOnly.orderId).toBe('id2');
    expect(idOnly.orderNumber).toBeUndefined();

    // Neither (pre-browser return)
    const neither: PaidGroupEntry = { stripeSessionId: 'cs_3' };
    expect(neither.orderId).toBeUndefined();
    expect(neither.orderNumber).toBeUndefined();
  });
});
