import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { reviewTextModeration } from "../reviewTextModeration";

let server: Server;
let base = "";

beforeAll(() => {
  const app = express();
  app.use(express.json());
  const reached = express.Router();
  reached.post("/", (_req, res) => { res.status(201).json({ ok: true }); });
  reached.post("/:reviewId/reply", (_req, res) => { res.json({ ok: true }); });
  reached.get("/product/:id", (_req, res) => { res.json([]); });
  app.use("/api/reviews", reviewTextModeration, reached);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); });

const post = (path: string, body: unknown) => fetch(base + path, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

describe("review text moderation", () => {
  it("lets ordinary reviews and replies through", async () => {
    expect((await post("/api/reviews", { rating: 5, body: "Great fit, fast shipping." })).status).toBe(201);
    expect((await post("/api/reviews/abc/reply", { replyText: "Thank you so much!" })).status).toBe(200);
    expect((await post("/api/reviews", { rating: 4 })).status).toBe(201);
  });
  it("declines abusive review text", async () => {
    const res = await post("/api/reviews", { rating: 1, body: "you're such a loser lol" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code?: string }).code).toBe("CONTENT_REJECTED");
  });
  it("declines scam / off-platform seller replies", async () => {
    const res = await post("/api/reviews/abc/reply", { replyText: "Pay me on Zelle instead, cheaper" });
    expect(res.status).toBe(422);
  });
  it("does not touch reads", async () => {
    expect((await fetch(base + "/api/reviews/product/x")).status).toBe(200);
  });
});
