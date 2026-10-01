import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  inserted: [] as unknown[],
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = "reporting-user";
    next();
  },
  requireModerator: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../middlewares/rateLimit", () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  appRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  desc: (value: unknown) => value,
  eq: (...values: unknown[]) => values,
  gt: (...values: unknown[]) => values,
  inArray: (...values: unknown[]) => values,
  or: (...conditions: unknown[]) => conditions,
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

vi.mock("@workspace/db", () => {
  const columns = new Proxy({}, { get: (_target, key) => String(key) });
  const select = () => ({
    from: () => ({
      where: () => ({
        limit: async () => state.selectResults.shift() ?? [],
      }),
    }),
  });
  return new Proxy({
    db: {
      select,
      insert: () => ({
        values: (row: unknown) => {
          state.inserted.push(row);
          return { returning: async () => [{ id: "new-report", ...(row as object) }] };
        },
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    },
    reviews: columns,
    reports: columns,
    messageReports: columns,
    communities: columns,
    communityMembers: columns,
    communityMessages: columns,
    conversationParticipants: columns,
    conversations: columns,
    messages: columns,
    postComments: columns,
    posts: columns,
    products: columns,
    stories: columns,
    users: columns,
  }, {
    get: (target, key) => key in target ? (target as any)[key] : columns,
  });
});

vi.mock("../../ws/communityHub", () => ({ closeCommunityRoom: () => undefined }));

import reportsRouter from "../reports";
import { REPORT_TARGET_TYPES, normalizeTargetType } from "../../lib/reportTargets";

const REVIEW_ID = "6f1c2f0e-8a54-4d2b-9f7e-1d2c3b4a5e6f";

let server: Server;
let base = "";

async function report(body: Record<string, unknown>) {
  const response = await fetch(`${base}/api/reports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text(); return { status: response.status, body: JSON.parse(text) as any };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.log = { error: (...a: unknown[]) => console.log("ERR", a[0]) }; next(); });
  app.use("/api/reports", reportsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.selectResults = [];
  state.inserted = [];
});

describe("review reports", () => {
  it("accepts 'review' as a target type", () => {
    expect(REPORT_TARGET_TYPES).toContain("review");
    expect(normalizeTargetType("review")).toBe("review");
  });

  it("files a report against a product review and records its author as the owner", async () => {
    state.selectResults = [
      [{ id: REVIEW_ID, buyerId: "review-author", body: "Terrible fake goods", rating: 1 }], // resolve target
      [], // no pending duplicate
      [], // no recently resolved report
    ];
    const res = await report({ targetType: "review", targetId: REVIEW_ID, reason: "scam" });
    expect(res.status).toBe(201);
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      reporterId: "reporting-user",
      targetType: "review",
      targetId: REVIEW_ID,
      targetOwnerId: "review-author",
      reason: "scam",
    });
  });

  it("rejects reporting your own review", async () => {
    state.selectResults = [[{ id: REVIEW_ID, buyerId: "reporting-user", body: "Great", rating: 5 }]];
    const res = await report({ targetType: "review", targetId: REVIEW_ID, reason: "spam" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SELF_REPORT");
  });

  it("404s when the review no longer exists", async () => {
    state.selectResults = [[]];
    const res = await report({ targetType: "review", targetId: REVIEW_ID, reason: "spam" });
    expect(res.status).toBe(404);
  });
});

describe("report dedupe window", () => {
  it("acknowledges a repeat while the first report is still pending", async () => {
    state.selectResults = [
      [{ id: REVIEW_ID, buyerId: "review-author", body: "x", rating: 3 }],
      [{ id: "pending-report" }],
    ];
    const res = await report({ targetType: "review", targetId: REVIEW_ID, reason: "spam" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "already_reported", id: "pending-report" });
    expect(state.inserted).toHaveLength(0);
  });

  it("blocks re-reporting the same target within 24h of a resolution", async () => {
    state.selectResults = [
      [{ id: REVIEW_ID, buyerId: "review-author", body: "x", rating: 3 }],
      [], // nothing pending
      [{ id: "resolved-report" }], // resolved inside the cooldown
    ];
    const res = await report({ targetType: "review", targetId: REVIEW_ID, reason: "spam" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "already_reported", id: "resolved-report" });
    expect(state.inserted).toHaveLength(0);
  });
});
