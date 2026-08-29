import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: null }),
}));

import { appRateLimiter, resetRateLimitStateForTests } from "./rateLimit";

async function withServer(app: ReturnType<typeof express>, run: (baseUrl: string) => Promise<void>) {
  const server: Server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe("appRateLimiter", () => {
  afterEach(() => resetRateLimitStateForTests());

  it("adds standard rate-limit headers", async () => {
    const app = express();
    app.use(appRateLimiter);
    app.get("/api/v1/public/products", (_req, res) => res.json({ ok: true }));

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/public/products`);
      expect(response.status).toBe(200);
      expect(response.headers.get("ratelimit-limit")).toBe("240");
      expect(response.headers.get("ratelimit-remaining")).toBe("239");
    });
  });

  it("does not rate limit health checks", async () => {
    const app = express();
    app.use(appRateLimiter);
    app.get("/api/v1/healthz", (_req, res) => res.json({ ok: true }));

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/healthz`);
      expect(response.status).toBe(200);
      expect(response.headers.get("ratelimit-limit")).toBeNull();
    });
  });
});