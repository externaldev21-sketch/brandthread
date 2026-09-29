/**
 * An in-memory Stripe for money tests. It behaves like Stripe where it
 * matters for correctness:
 *  - the same idempotency key returns the same object (no second payment);
 *  - failures can be "definitive" (4xx, nothing happened) or "ambiguous"
 *    (5xx/network: the request may or may not have gone through).
 * Test mode only — no network, no real keys. Webhook signing uses the real
 * Stripe SDK so signature verification is exercised for real.
 */
import Stripe from "stripe";

export const TEST_WEBHOOK_SECRET = "whsec_test_placeholder_for_money_tests";
const signer = new Stripe("sk_test_placeholder_for_money_tests");

type Failure = "definitive" | "ambiguous" | null;

function stripeError(kind: Exclude<Failure, null>, message: string) {
  return Object.assign(new Error(message), kind === "definitive"
    ? { statusCode: 400, type: "StripeInvalidRequestError", code: "resource_missing" }
    : { statusCode: 500, type: "StripeAPIError", code: "api_error" });
}

let counter = 0;
const nextId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(++counter).toString(36)}`;

function idempotent<T>(store: Map<string, T>, key: string | undefined, create: () => T): T {
  if (key && store.has(key)) return store.get(key)!;
  const value = create();
  if (key) store.set(key, value);
  return value;
}

export function createFakeStripe() {
  const state = {
    transfers: [] as any[],
    refunds: [] as any[],
    reversals: [] as any[],
    feeRefunds: [] as any[],
    transferKeys: new Map<string, any>(),
    refundKeys: new Map<string, any>(),
    reversalKeys: new Map<string, any>(),
    feeRefundKeys: new Map<string, any>(),
    /** Stripe fee reported for each PaymentIntent's charge (default 2.9% + 30¢ of amount). */
    chargeFees: new Map<string, number | null>(),
    /** Applies once to the next call, then resets. */
    failNextTransfer: null as Failure,
    /** An ambiguous failure AFTER Stripe created the transfer (lost response). */
    loseNextTransferResponse: false,
    failNextRefund: null as Failure,
    failNextReversal: null as Failure,
    retrieveFails: false,
    balanceAvailable: 0,
    balancePending: 0,
    payouts: [] as any[],
    /** Checkout Sessions created through the checkout route (item 109 tests). */
    checkoutSessions: new Map<string, any>(),
    checkoutSessionCreates: [] as Array<{ params: any; options: any }>,
    coupons: [] as any[],
    customers: [] as any[],
    /** PaymentIntents created by the one-page checkout route. */
    paymentIntents: new Map<string, any>(),
    paymentIntentKeys: new Map<string, any>(),
    paymentIntentCreates: [] as Array<{ params: any; options: any }>,
    /** Tax per Stripe Tax calculation (default 8% of the taxable amount). */
    taxRate: 0.08,
    taxFails: false,
    taxCalculations: [] as Array<{ params: any; options: any; id: string; tax: number }>,
    taxTransactions: [] as Array<{ params: any; options: any }>,
  };

  const stripe = {
    checkout: {
      sessions: {
        create: async (params: any, options: any = {}) => {
          state.checkoutSessionCreates.push({ params, options });
          const session = {
            id: nextId("cs_test"),
            object: "checkout.session",
            url: `https://checkout.stripe.test/pay/${state.checkoutSessionCreates.length}`,
            status: "open",
            payment_status: "unpaid",
            payment_intent: null,
            metadata: params.metadata ?? {},
          };
          state.checkoutSessions.set(session.id, session);
          return session;
        },
        retrieve: async (id: string) => {
          const session = state.checkoutSessions.get(id);
          if (!session) throw stripeError("definitive", "No such checkout session");
          return session;
        },
        /** Like Stripe: only an open session can be expired. */
        expire: async (id: string) => {
          const session = state.checkoutSessions.get(id);
          if (!session) throw stripeError("definitive", "No such checkout session");
          if (session.status !== "open") throw stripeError("definitive", `Session is ${session.status}`);
          session.status = "expired";
          return session;
        },
        list: async () => ({ data: [...state.checkoutSessions.values()], has_more: false }),
      },
    },
    coupons: {
      create: async (params: any) => {
        const coupon = { id: nextId("coupon"), ...params };
        state.coupons.push(coupon);
        return coupon;
      },
    },
    customers: {
      create: async (params: any) => {
        const customer = { id: nextId("cus"), ...params };
        state.customers.push(customer);
        return customer;
      },
      update: async (id: string, params: any) => ({ id, ...params }),
      retrieve: async (id: string) => ({ id, deleted: false }),
    },
    paymentIntents: {
      create: async (params: any, options: any = {}) => {
        state.paymentIntentCreates.push({ params, options });
        return idempotent(state.paymentIntentKeys, options?.idempotencyKey, () => {
          const id = nextId("pi_cart");
          const intent = {
            id,
            object: "payment_intent",
            client_secret: `${id}_secret_test`,
            status: "requires_payment_method",
            ...params,
          };
          state.paymentIntents.set(id, intent);
          return intent;
        });
      },
      cancel: async (id: string, params: any = {}) => {
        const intent = state.paymentIntents.get(id);
        if (!intent) throw stripeError("definitive", "No such payment_intent");
        if (intent.status === "succeeded") throw stripeError("definitive", "PaymentIntent already succeeded");
        intent.status = "canceled";
        intent.cancellation_reason = params.cancellation_reason ?? null;
        return intent;
      },
      retrieve: async (id: string) => {
        if (state.retrieveFails) throw stripeError("ambiguous", "Stripe unavailable");
        const fee = state.chargeFees.has(id) ? state.chargeFees.get(id)! : 320;
        return {
          ...(state.paymentIntents.get(id) ?? {}),
          id,
          latest_charge: {
            id: `ch_${id}`,
            balance_transaction: fee === null ? null : { id: `txn_${id}`, fee },
            transfer: `tr_dest_${id}`,
            application_fee: `fee_${id}`,
          },
        };
      },
    },
    transfers: {
      create: async (params: any, opts?: { idempotencyKey?: string }) => {
        if (state.failNextTransfer) {
          const kind = state.failNextTransfer;
          state.failNextTransfer = null;
          throw stripeError(kind, "Transfer failed");
        }
        const transfer = idempotent(state.transferKeys, opts?.idempotencyKey, () => {
          const created = { id: nextId("tr"), object: "transfer", ...params, idempotencyKey: opts?.idempotencyKey };
          state.transfers.push(created);
          return created;
        });
        if (state.loseNextTransferResponse) {
          state.loseNextTransferResponse = false;
          throw stripeError("ambiguous", "Connection reset after the transfer was created");
        }
        return transfer;
      },
      createReversal: async (transferId: string, params: any, opts?: { idempotencyKey?: string }) => {
        if (state.failNextReversal) {
          const kind = state.failNextReversal;
          state.failNextReversal = null;
          throw stripeError(kind, "Reversal failed");
        }
        return idempotent(state.reversalKeys, opts?.idempotencyKey, () => {
          const created = { id: nextId("trr"), transfer: transferId, ...params };
          state.reversals.push(created);
          return created;
        });
      },
    },
    refunds: {
      create: async (params: any, opts?: { idempotencyKey?: string }) => {
        if (state.failNextRefund) {
          const kind = state.failNextRefund;
          state.failNextRefund = null;
          throw stripeError(kind, "Refund failed");
        }
        return idempotent(state.refundKeys, opts?.idempotencyKey, () => {
          const created = { id: nextId("re"), status: "succeeded", ...params };
          state.refunds.push(created);
          return created;
        });
      },
    },
    applicationFees: {
      createRefund: async (feeId: string, params: any, opts?: { idempotencyKey?: string }) =>
        idempotent(state.feeRefundKeys, opts?.idempotencyKey, () => {
          const created = { id: nextId("fr"), fee: feeId, ...params };
          state.feeRefunds.push(created);
          return created;
        }),
    },
    tax: {
      calculations: {
        create: async (params: any, options: any = {}) => {
          if (state.taxFails) throw stripeError("definitive", "Stripe Tax is not set up for this account");
          const taxable = (params.line_items ?? []).reduce((sum: number, line: any) => sum + line.amount, 0)
            + (params.shipping_cost?.amount ?? 0);
          const tax = Math.round(taxable * state.taxRate);
          const id = nextId("taxcalc");
          state.taxCalculations.push({ params, options, id, tax });
          return { id, tax_amount_exclusive: tax };
        },
      },
      transactions: {
        createFromCalculation: async (params: any, options: any = {}) => {
          state.taxTransactions.push({ params, options });
          return { id: nextId("taxtxn"), ...params };
        },
      },
    },
    accounts: {
      retrieve: async (id: string) => ({
        id, charges_enabled: true, payouts_enabled: true, details_submitted: true,
      }),
    },
    balance: {
      retrieve: async () => ({
        available: [{ currency: "usd", amount: state.balanceAvailable }],
        pending: [{ currency: "usd", amount: state.balancePending }],
      }),
    },
    payouts: {
      list: async () => ({ data: state.payouts, has_more: false }),
    },
    webhooks: signer.webhooks,
  };

  function reset() {
    state.transfers.length = 0;
    state.refunds.length = 0;
    state.reversals.length = 0;
    state.feeRefunds.length = 0;
    state.transferKeys.clear();
    state.refundKeys.clear();
    state.reversalKeys.clear();
    state.feeRefundKeys.clear();
    state.chargeFees.clear();
    state.failNextTransfer = null;
    state.loseNextTransferResponse = false;
    state.failNextRefund = null;
    state.failNextReversal = null;
    state.retrieveFails = false;
    state.balanceAvailable = 0;
    state.balancePending = 0;
    state.payouts.length = 0;
    state.checkoutSessions.clear();
    state.checkoutSessionCreates.length = 0;
    state.coupons.length = 0;
    state.customers.length = 0;
    state.paymentIntents.clear();
    state.paymentIntentKeys.clear();
    state.paymentIntentCreates.length = 0;
    state.taxRate = 0.08;
    state.taxFails = false;
    state.taxCalculations.length = 0;
    state.taxTransactions.length = 0;
  }

  /** A signed webhook body + header, exactly as Stripe would deliver it. */
  function signedEvent(event: Record<string, unknown>, secret = TEST_WEBHOOK_SECRET) {
    const payload = JSON.stringify(event);
    const header = signer.webhooks.generateTestHeaderString({ payload, secret });
    return { payload, header };
  }

  return { stripe, state, reset, signedEvent };
}

export const fake = createFakeStripe();
