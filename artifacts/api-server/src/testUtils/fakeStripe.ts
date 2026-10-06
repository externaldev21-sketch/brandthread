/**
 * In-memory Stripe stand-in for end-to-end commerce tests.
 *
 * Every `stripe.<resource>.<method>(...)` call is recorded in `calls` and
 * answered with a plausible object, so whole-app tests can drive checkout,
 * webhooks, refunds, transfers and payouts against the REAL routers and the
 * REAL database without touching the network. Only the SDK boundary is
 * faked — never our own money logic.
 *
 * `webhooks.constructEvent` returns the request body parsed as JSON, so a
 * test posts the exact event object it wants the webhook route to handle.
 */
import crypto from "node:crypto";

export type FakeStripeCall = { path: string; args: unknown[] };

export interface FakeStripe {
  client: any;
  calls: FakeStripeCall[];
  callsTo(path: string): FakeStripeCall[];
  /** Objects created through the fake, by id (sessions, intents, refunds…). */
  objects: Map<string, any>;
  reset(): void;
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

export function createFakeStripe(): FakeStripe {
  const calls: FakeStripeCall[] = [];
  const objects = new Map<string, any>();

  const store = (obj: any) => {
    objects.set(obj.id, obj);
    return obj;
  };

  const handlers: Record<string, (...args: any[]) => any> = {
    "checkout.sessions.create": (params: any) => {
      const sid = id("cs_test");
      const amount = (params?.line_items ?? []).reduce(
        (sum: number, li: any) => sum + (li.price_data?.unit_amount ?? 0) * (li.quantity ?? 1),
        0,
      );
      return store({
        id: sid,
        object: "checkout.session",
        url: `https://checkout.stripe.test/${sid}`,
        status: "open",
        payment_status: "unpaid",
        amount_total: amount,
        metadata: params?.metadata ?? {},
        payment_intent: null,
        params,
      });
    },
    "checkout.sessions.retrieve": (sid: string) =>
      objects.get(sid) ?? { id: sid, status: "open", payment_status: "unpaid", metadata: {} },
    "checkout.sessions.expire": (sid: string) => ({ ...(objects.get(sid) ?? { id: sid }), status: "expired" }),
    "checkout.sessions.list": () => ({ data: [], has_more: false }),
    "paymentIntents.create": (params: any) =>
      store({
        id: id("pi_test"),
        object: "payment_intent",
        status: "requires_payment_method",
        client_secret: `${id("pi_secret")}`,
        amount: params?.amount,
        currency: params?.currency ?? "usd",
        metadata: params?.metadata ?? {},
        params,
      }),
    "paymentIntents.retrieve": (pid: string) =>
      objects.get(pid) ?? {
        id: pid,
        status: "succeeded",
        latest_charge: { id: id("ch_test"), balance_transaction: { fee: 0 } },
        metadata: {},
      },
    "paymentIntents.cancel": (pid: string) => ({ ...(objects.get(pid) ?? { id: pid }), status: "canceled" }),
    "refunds.create": (params: any) =>
      store({ id: id("re_test"), object: "refund", status: "succeeded", amount: params?.amount, params }),
    "transfers.create": (params: any) =>
      store({ id: id("tr_test"), object: "transfer", amount: params?.amount, destination: params?.destination, params }),
    "transfers.list": () => ({ data: [], has_more: false }),
    "accounts.retrieve": (acct: string) => ({
      id: acct ?? id("acct_test"),
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: { currently_due: [], past_due: [], disabled_reason: null },
    }),
    "balance.retrieve": () => ({ available: [{ amount: 0, currency: "usd" }], pending: [{ amount: 0, currency: "usd" }] }),
    "balanceTransactions.list": () => ({ data: [], has_more: false }),
    "payouts.list": () => ({ data: [], has_more: false }),
    "customers.create": () => store({ id: id("cus_test"), object: "customer" }),
    "customers.retrieve": (cid: string) => ({ id: cid, invoice_settings: { default_payment_method: null } }),
    "customers.update": (cid: string) => ({ id: cid }),
    "paymentMethods.list": () => ({ data: [], has_more: false }),
    "charges.retrieve": (cid: string) => ({ id: cid, balance_transaction: { fee: 0 } }),
    "disputes.update": (did: string) => ({ id: did, status: "under_review" }),
    "webhooks.constructEvent": (body: Buffer | string) =>
      JSON.parse(Buffer.isBuffer(body) ? body.toString("utf8") : String(body)),
  };

  const resource = (path: string[]): any =>
    new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") return undefined; // never look like a promise
        return resource([...path, String(prop)]);
      },
      apply(_t, _this, args) {
        const key = path.join(".");
        calls.push({ path: key, args });
        const handler = handlers[key];
        const result = handler ? handler(...args) : { id: id("obj_test"), object: key };
        // constructEvent is synchronous in the real SDK.
        return key === "webhooks.constructEvent" ? result : Promise.resolve(result);
      },
    });

  const client = resource([]);

  return {
    client,
    calls,
    objects,
    callsTo: (path) => calls.filter((c) => c.path === path),
    reset() {
      calls.length = 0;
      objects.clear();
    },
  };
}
