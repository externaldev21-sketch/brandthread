import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, fetchMock, table } = vi.hoisted(() => {
  const table = () => new Proxy({}, {
    get: (_target, property) => `column.${String(property)}`,
  });

  return {
    dbMock: {
      select: vi.fn(),
    },
    fetchMock: vi.fn(),
    table,
  };
});

vi.mock("@workspace/db", () => ({
  db: dbMock,
  checkoutSessions: table(),
  orders: table(),
  orderItems: table(),
  productVariants: table(),
  products: table(),
  users: table(),
  notificationsFeed: table(),
  disputes: table(),
  dropWallets: table(),
  dropWalletTransactions: table(),
  freelancers: table(),
  freelancerJobs: table(),
  revenueCatWebhookEvents: table(),
  manufacturers: table(),
  sampleOrders: table(),
  manufacturerActivityEvents: table(),
  pushTokens: table(),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  ne: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("../lib/stripe", () => ({
  STRIPE_WEBHOOK_SECRET: "test-secret",
  stripe: {
    webhooks: {
      constructEvent: vi.fn(),
    },
  },
}));
vi.mock("../lib/freelancerEscrow", () => ({ refundJobPayment: vi.fn() }));
vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock("../lib/nativeEntitlements", () => ({ reconcileRevenueCatEntitlement: vi.fn() }));
vi.mock("./loyalty", () => ({
  awardLoyaltyPointsOnce: vi.fn(),
  consumeLoyaltyRedemption: vi.fn(),
  releaseLoyaltyRedemption: vi.fn(),
}));
vi.mock("../lib/brandthreadEmail", () => ({
  isOrderConfirmationEligibleStatus: vi.fn(() => true),
  sendOrderConfirmationEmail: vi.fn(),
}));
vi.mock("./notifications-feed", () => ({ publishNotification: vi.fn() }));
vi.mock("../lib/connectReadiness", () => ({ connectReadiness: vi.fn() }));
vi.mock("../lib/stripeWebhookLedger", () => ({
  claimStripeWebhookEvent: vi.fn(),
  completeStripeWebhookEvent: vi.fn(),
  failStripeWebhookEvent: vi.fn(),
  renewStripeWebhookLease: vi.fn(),
  waitForStripeWebhookOutcome: vi.fn(),
  STRIPE_WEBHOOK_HEARTBEAT_MS: 10_000,
}));

import { handleSubscriptionTrialWillEnd } from "./webhooks";

function queryReturning<T>(rows: T) {
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    limit: vi.fn(() => Promise.resolve(rows)),
    then: (
      onFulfilled?: (value: T) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(onFulfilled, onRejected),
  };
  return query;
}

function queueSelect<T>(rows: T) {
  dbMock.select.mockImplementationOnce(() => queryReturning(rows));
}

const trialEnd = Math.floor(new Date("2026-09-14T12:00:00.000Z").getTime() / 1000);

describe("customer.subscription.trial_will_end webhook", () => {
  beforeEach(() => {
    dbMock.select.mockReset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("sends the exact charge, trial date, and Subscription route to a seller device", async () => {
    queueSelect([{ clerkId: "clerk_seller_123" }]);
    queueSelect([{ token: "ExponentPushToken[trial-warning]" }]);

    await handleSubscriptionTrialWillEnd({
      id: "sub_trial_123",
      customer: "cus_seller_123",
      trial_end: trialEnd,
      items: {
        data: [
          { quantity: 1, price: { unit_amount: 1999 } },
          { quantity: 2, price: { unit_amount: 500 } },
        ],
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, request] = fetchMock.mock.calls[0] as [
      string,
      { body: string },
    ];
    expect(JSON.parse(request.body)).toEqual([{
      to: "ExponentPushToken[trial-warning]",
      title: "Your free trial ends soon",
      body: "Your 5-day trial ends in 3 days — you'll be charged $29.99 on Sep 14, 2026 unless you cancel.",
      data: {
        type: "subscription_trial_will_end",
        route: "/subscription",
      },
      sound: "default",
    }]);
  });

  it("succeeds without trying Expo when the seller has no registered token", async () => {
    queueSelect([{ clerkId: "clerk_seller_123" }]);
    queueSelect([]);
    fetchMock.mockRejectedValue(new Error("Expo should not be called"));

    await expect(handleSubscriptionTrialWillEnd({
      id: "sub_trial_no_token",
      customer: "cus_seller_123",
      trial_end: trialEnd,
      items: { data: [{ price: { unit_amount: 2999 } }] },
    })).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});