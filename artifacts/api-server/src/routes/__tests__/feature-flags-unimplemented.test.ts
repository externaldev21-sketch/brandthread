import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const queries = vi.hoisted(() => [] as unknown[][]);
vi.mock("@workspace/db", () => ({
  pool: {
    query: vi.fn(async (_sql: string, params: unknown[]) => {
      queries.push(params);
      return { rows: [{ key: params[0], enabled: params[1], description: "", updated_at: new Date() }] };
    }),
  },
}));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
  requireModerator: (_req: any, _res: any, next: any) => next(),
}));

const { default: router } = await import("../feature-flags");
let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/flags", router);
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const put = (key: string, enabled: boolean) =>
  fetch(`${base}/flags/${key}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }) });

describe("unimplemented feature flags", () => {
  it("refuses to turn on the unbuilt Brandthread Agent welcome bonus instead of faking success", async () => {
    const res = await put("brandthreadAgentWelcomeBonus", true);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("FEATURE_NOT_IMPLEMENTED");
    expect(queries).toHaveLength(0);
  });

  it("still allows turning it off and toggling real flags", async () => {
    expect((await put("brandthreadAgentWelcomeBonus", false)).status).toBe(200);
    expect((await put("threadCashCheckoutDiscount", true)).status).toBe(200);
  });
});
