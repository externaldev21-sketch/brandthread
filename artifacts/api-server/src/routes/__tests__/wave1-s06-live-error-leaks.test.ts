/**
 * Unexpected database failures in the live routers must answer a generic 500,
 * never the raw Postgres / driver message (which can carry SQL, constraint
 * and column names).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const SECRET = "SECRET_DB_DETAIL relation live_streams column x";

vi.mock("@workspace/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@workspace/db")>();
  const db = new Proxy(real.db as object, {
    get(target, prop) {
      if (prop === "execute") return () => Promise.reject(new Error(SECRET));
      return Reflect.get(target, prop);
    },
  });
  return { ...real, db };
});
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => { req.clerkUserId = "w1s06-leak-user"; next(); },
  requirePlan: () => (_req: any, _res: any, next: () => void) => next(),
}));
vi.mock("../../lib/safety", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/safety")>()),
  optionalViewerId: () => null,
}));
vi.mock("../../ws/liveHub", () => ({ broadcastToRoom: vi.fn(), disconnectUserFromRoom: vi.fn(), roomUserIds: () => [] }));

let server: Server;
let base = "";
const ID = "00000000-0000-4000-8000-0000000000aa";

beforeAll(async () => {
  const [commerce, moderation, replays, shopping, tips, cohost, live] = await Promise.all([
    import("../live-commerce"), import("../live-moderation"), import("../live-replays"),
    import("../live-shopping"), import("../live-tips"), import("../live-cohost"), import("../live"),
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api/live-replays", replays.default);
  app.use("/api/live-tips", tips.default);
  app.use("/api/live", commerce.default, moderation.default, shopping.default, cohost.default, live.default);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

const cases: Array<[string, string, string, unknown?]> = [
  ["live-commerce", "GET", "/api/live/scheduled/upcoming"],
  ["live-moderation", "GET", `/api/live/${ID}/pinned`],
  ["live-replays", "GET", `/api/live-replays/${ID}`],
  ["live-shopping", "PUT", `/api/live/${ID}/cohost/products`, { productIds: [] }],
  ["live-tips", "GET", `/api/live-tips/${ID}/total`],
  ["live-cohost", "GET", `/api/live/${ID}/cohosts`],
  ["live", "GET", "/api/live/active"],
];

describe("live routers hide internal error text", () => {
  for (const [name, method, path, body] of cases) {
    it(`${name}: ${method} ${path}`, async () => {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      expect(res.status).toBe(500);
      expect(text).not.toContain("SECRET_DB_DETAIL");
    });
  }
});
