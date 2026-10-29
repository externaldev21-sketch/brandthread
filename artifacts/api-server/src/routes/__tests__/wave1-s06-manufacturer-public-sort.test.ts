import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class { async getObjectEntityDownloadURL(p: string) { return `https://objects.test${p}`; } },
}));

let server: Server;
let base = "";
beforeAll(async () => {
  const { default: router } = await import("../manufacturer-public");
  const app = express();
  app.use((req: any, _res, next) => { req.log = { error: () => {}, warn: () => {}, info: () => {} }; next(); });
  app.use("/api/manufacturers/public", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

describe("GET /api/manufacturers/public?sort=", () => {
  for (const sort of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    it(`falls back to the default order for sort=${sort}`, async () => {
      const res = await fetch(`${base}/api/manufacturers/public?sort=${sort}&limit=1`);
      expect(res.status).toBe(200);
      expect(Array.isArray(await res.json())).toBe(true);
    });
  }
  it("still accepts a real sort", async () => {
    expect((await fetch(`${base}/api/manufacturers/public?sort=newest&limit=1`)).status).toBe(200);
  });
});
