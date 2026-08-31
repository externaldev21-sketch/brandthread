import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";

const TEST_SUFFIX = crypto.randomBytes(6).toString("hex");
const BUYER_ID = `payment-methods-buyer-${TEST_SUFFIX}`;
const OTHER_BUYER_ID = `payment-methods-other-${TEST_SUFFIX}`;
const BUYER_CUSTOMER_ID = `cus_buyer_${TEST_SUFFIX}`;
const OTHER_CUSTOMER_ID = `cus_other_${TEST_SUFFIX}`;

const fakeStripe = vi.hoisted(() => {
  const detached: string[] = [];
  const customerUpdates: Array<{ id: string; params: any }> = [];
  const methods = new Map([
    [
      "pm_owner",
      {
        id: "pm_owner",
        customer: "",
        card: {
          brand: "visa",
          last4: "4242",
          exp_month: 12,
          exp_year: 2030,
          funding: "credit",
          country: "US",
        },
      },
    ],
    [
      "pm_other",
      {
        id: "pm_other",
        customer: "",
        card: {
          brand: "mastercard",
          last4: "4444",
          exp_month: 10,
          exp_year: 2031,
          funding: "debit",
          country: "US",
        },
      },
    ],
    [
      "pm_second",
      {
        id: "pm_second",
        customer: "",
        card: {
          brand: "amex",
          last4: "0005",
          exp_month: 8,
          exp_year: 2032,
          funding: "credit",
          country: "US",
        },
      },
    ],
  ]);

  const client = {
    paymentMethods: {
      list: async ({ customer }: { customer: string }) => ({
        data: [...methods.values()].filter((method) => method.customer === customer),
      }),
      retrieve: async (id: string) => methods.get(id),
      detach: async (id: string) => {
        detached.push(id);
        return methods.get(id);
      },
    },
    customers: {
      retrieve: async (id: string) => ({
        id,
        deleted: false,
        invoice_settings: {
          default_payment_method: id.includes("buyer") ? "pm_owner" : "pm_other",
        },
      }),
      update: async (id: string, params: any) => {
        customerUpdates.push({ id, params });
        return { id, ...params };
      },
    },
  };

  return {
    client,
    customerUpdates,
    detached,
    methods,
    reset(ownerCustomerId: string, otherCustomerId: string) {
      customerUpdates.length = 0;
      detached.length = 0;
      methods.get("pm_owner")!.customer = ownerCustomerId;
      methods.get("pm_other")!.customer = otherCustomerId;
      methods.get("pm_second")!.customer = "";
    },
  };
});

vi.mock("stripe", () => ({
  default: class FakeStripe {
    constructor() {
      return fakeStripe.client;
    }
  },
}));

vi.mock("@clerk/express", () => ({
  getAuth: (req: express.Request) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

let server: Server;
let base = "";

async function request(path: string, userId?: string, method = "GET") {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: userId ? { "x-test-user": userId } : {},
  });
  return {
    status: response.status,
    body: await response.json() as any,
  };
}

beforeAll(async () => {
  await db.insert(users).values([
    {
      clerkId: BUYER_ID,
      email: `${BUYER_ID}@test.local`,
      name: "Saved Card Buyer",
      role: "buyer",
      accountType: "buyer",
      stripeCustomerId: BUYER_CUSTOMER_ID,
    },
    {
      clerkId: OTHER_BUYER_ID,
      email: `${OTHER_BUYER_ID}@test.local`,
      name: "Other Saved Card Buyer",
      role: "buyer",
      accountType: "buyer",
      stripeCustomerId: OTHER_CUSTOMER_ID,
    },
  ]);

  const { default: buyerPaymentsRouter } = await import("../buyer-payments");
  const app = express();
  app.use("/api/buyer/payment-methods", buyerPaymentsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  fakeStripe.reset(BUYER_CUSTOMER_ID, OTHER_CUSTOMER_ID);
});

afterAll(async () => {
  await db.delete(users).where(eq(users.clerkId, BUYER_ID));
  await db.delete(users).where(eq(users.clerkId, OTHER_BUYER_ID));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("buyer payment methods", () => {
  it("requires an authenticated buyer", async () => {
    const result = await request("/api/buyer/payment-methods");
    expect(result.status).toBe(401);
  });

  it("lists the authenticated buyer's saved cards and default", async () => {
    const result = await request("/api/buyer/payment-methods", BUYER_ID);

    expect(result.status).toBe(200);
    expect(result.body.paymentMethods).toEqual([
      expect.objectContaining({
        id: "pm_owner",
        brand: "visa",
        last4: "4242",
        isDefault: true,
      }),
    ]);
  });

  it("detaches a card owned by the authenticated buyer", async () => {
    const result = await request(
      "/api/buyer/payment-methods/pm_owner",
      BUYER_ID,
      "DELETE",
    );

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(fakeStripe.detached).toEqual(["pm_owner"]);
  });

  it("makes an owned card the Stripe Customer default", async () => {
    fakeStripe.methods.get("pm_second")!.customer = BUYER_CUSTOMER_ID;

    const result = await request(
      "/api/buyer/payment-methods/pm_second/default",
      BUYER_ID,
      "POST",
    );

    expect(result).toEqual({
      status: 200,
      body: { ok: true, paymentMethodId: "pm_second" },
    });
    expect(fakeStripe.customerUpdates).toEqual([
      {
        id: BUYER_CUSTOMER_ID,
        params: {
          invoice_settings: { default_payment_method: "pm_second" },
        },
      },
    ]);
  });

  it("refuses to make another buyer's card the default", async () => {
    const result = await request(
      "/api/buyer/payment-methods/pm_other/default",
      BUYER_ID,
      "POST",
    );

    expect(result.status).toBe(403);
    expect(result.body.error).toBe("Not your payment method");
    expect(fakeStripe.customerUpdates).toEqual([]);
  });

  it("refuses to detach another buyer's card", async () => {
    const result = await request(
      "/api/buyer/payment-methods/pm_other",
      BUYER_ID,
      "DELETE",
    );

    expect(result.status).toBe(403);
    expect(result.body.error).toBe("Not your payment method");
    expect(fakeStripe.detached).toEqual([]);
  });
});