import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const auth = vi.hoisted(() => ({ signedIn: true }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!auth.signedIn) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = "seller";
    next();
  },
}));

import {
  PLATFORM_FEE_BPS,
  STRIPE_PROCESSING_BPS,
  STRIPE_PROCESSING_FIXED_CENTS,
  bpsOfCents,
  splitOrder,
} from "../../lib/money/fees";
import { financeFeesRouter, publicFeeScheduleRouter } from "../fees";

let server: Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/finance/fees", financeFeesRouter);
  app.use("/public", publicFeeScheduleRouter);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const quote = (body: unknown) =>
  fetch(`${base}/finance/fees/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// Expectations below are computed from the fees.ts exports, so if the owner
// changes PLATFORM_FEE_BPS / STRIPE_PROCESSING_* this suite keeps passing only
// because the endpoints follow the constants (nothing is hard-coded in them).
const platform = (cents: number) => bpsOfCents(cents, PLATFORM_FEE_BPS);
const processing = (cents: number) => (cents === 0 ? 0 : bpsOfCents(cents, STRIPE_PROCESSING_BPS) + STRIPE_PROCESSING_FIXED_CENTS);

describe("fee endpoints", () => {
  it("requires auth for /finance/fees but not /public/fee-schedule", async () => {
    auth.signedIn = false;
    expect((await fetch(`${base}/finance/fees`)).status).toBe(401);
    expect((await quote({ priceCents: 100 })).status).toBe(401);
    expect((await fetch(`${base}/public/fee-schedule`)).status).toBe(200);
    auth.signedIn = true;
  });

  it("reports exactly the fees.ts constants and an example from splitOrder", async () => {
    const body = ((await (await fetch(`${base}/finance/fees`)).json()) as any);
    expect(body.platformFeeBps).toBe(PLATFORM_FEE_BPS);
    expect(body.processing).toEqual({ bps: STRIPE_PROCESSING_BPS, fixedCents: STRIPE_PROCESSING_FIXED_CENTS });
    const split = splitOrder({ subtotalCents: body.example.priceCents, discountCents: 0, shippingCents: 0, taxCents: 0, grossCents: body.example.priceCents });
    expect(body.example).toMatchObject({
      grossCents: split.grossCents,
      platformFeeCents: split.platformFeeCents,
      processingFeeCents: split.processingFeeCents,
      sellerNetCents: split.sellerNetCents,
    });
    expect(((await (await fetch(`${base}/public/fee-schedule`)).json()) as any)).toEqual(body);
  });

  it("carries no fee literals of its own", () => {
    for (const f of ["../../lib/money/feeSchedule.ts", "../fees.ts"]) {
      const src = readFileSync(new URL(f, import.meta.url) as URL, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(src).not.toMatch(/\b(500|290|0\.05|0\.029|2\.9)\b/);
    }
  });

  it("quotes with half-up rounding, quantity and shipping", async () => {
    // $10.10: the platform share is 50.5c and rounds up to 51c.
    const q1 = ((await (await quote({ priceCents: 1010 })).json()) as any);
    expect(q1.platformFeeCents).toBe(platform(1010));
    expect(q1.processingFeeCents).toBe(processing(1010));
    expect(q1.sellerNetCents).toBe(1010 - platform(1010) - processing(1010));
    // Shipping is part of both the platform-fee base and processing (BT-059).
    const q2 = ((await (await quote({ priceCents: 2500, quantity: 2, shippingCents: 500 })).json()) as any);
    expect(q2).toMatchObject({ grossCents: 5500, merchandiseCents: 5000, platformFeeCents: platform(5500), processingFeeCents: processing(5500) });
    expect(q2.grossCents - q2.platformFeeCents - q2.processingFeeCents).toBe(q2.sellerNetCents);
  });

  it("keeps integer cents and a non-negative net across a price sweep", async () => {
    for (const price of [0, 1, 9, 10, 29, 30, 31, 99, 100, 101, 999, 1010, 99999, 100_000_000]) {
      const q = ((await (await quote({ priceCents: price })).json()) as any);
      for (const k of ["grossCents", "platformFeeCents", "processingFeeCents", "sellerNetCents"]) {
        expect(Number.isInteger(q[k])).toBe(true);
      }
      expect(q.sellerNetCents).toBeGreaterThanOrEqual(0);
      expect(q.platformFeeCents + q.processingFeeCents + q.sellerNetCents).toBe(q.grossCents);
    }
  });

  it("rounding edge: 9 cents has a zero platform fee when 5%, and fees never exceed the sale", async () => {
    const q = ((await (await quote({ priceCents: 9 })).json()) as any);
    expect(q.platformFeeCents).toBe(Math.min(platform(9), 9));
    expect(q.sellerNetCents).toBe(9 - q.platformFeeCents - q.processingFeeCents);
    const zero = ((await (await quote({ priceCents: 0 })).json()) as any);
    expect(zero).toMatchObject({ grossCents: 0, platformFeeCents: 0, processingFeeCents: 0, sellerNetCents: 0 });
  });

  it("rejects bad input with 400", async () => {
    for (const body of [{}, { priceCents: -1 }, { priceCents: 1.5 }, { priceCents: "100" }, { priceCents: 100, quantity: 0 }, { priceCents: 100, shippingCents: -5 }, { priceCents: 100_000_000, quantity: 2 }]) {
      expect((await quote(body)).status).toBe(400);
    }
  });
});
