import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => { req.clerkUserId = "w1s06-bidder"; next(); },
  requirePlan: () => (_req: any, _res: any, next: () => void) => next(),
}));
vi.mock("../../lib/liveAuctions", () => {
  class AuctionError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
  return {
    AuctionError,
    isLiveAuctionsEnabled: async () => true,
    placeBid: async () => { throw new Error('duplicate key value violates unique constraint "live_auction_bids_secret_idx"'); },
    activeAuctionFor: async () => null,
    cancelAuction: async () => null,
    startAuction: async () => null,
    publicAuction: async (a: unknown) => a,
  };
});

let server: Server;
let base = "";
beforeAll(async () => {
  const { default: router } = await import("../live-auctions");
  const app = express();
  app.use(express.json());
  app.use("/api/live", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

describe("live auction unexpected errors", () => {
  it("returns a generic 500 without the internal error message", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const res = await fetch(`${base}/api/live/${id}/auctions/${id}/bid`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amountCents: 100 }),
    });
    expect(res.status).toBe(500);
    const body = await res.json() as any;
    expect(body.error).toBe("Internal server error");
    expect(JSON.stringify(body)).not.toContain("live_auction_bids_secret_idx");
  });
});
