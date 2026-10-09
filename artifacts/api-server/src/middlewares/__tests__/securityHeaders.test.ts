import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { describe, expect, it } from "vitest";
import { JSON_CSP, securityHeaders } from "../securityHeaders";

async function withApp(env: string, run: (baseUrl: string) => Promise<void>) {
  const app = express();
  app.use(securityHeaders(env));
  app.get("/api/v1/healthz", (_req, res) => res.json({ ok: true }));
  app.get("/page", (_req, res) => {
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
    res.type("html").send("<!doctype html><p>hi</p>");
  });
  app.get("/own-csp.json", (_req, res) => {
    res.setHeader("Content-Security-Policy", "default-src 'self'");
    res.json({ ok: true });
  });
  const server: Server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("securityHeaders", () => {
  it("sends the helmet baseline", async () => {
    await withApp("development", async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/healthz`);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
      expect(response.headers.get("cross-origin-resource-policy")).toBe("same-site");
      expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin-allow-popups");
      expect(response.headers.get("permissions-policy")).toBe("geolocation=(), camera=(), microphone=()");
      expect(response.headers.get("x-dns-prefetch-control")).toBe("off");
      expect(response.headers.get("x-powered-by")).toBeNull();
    });
  });

  it("gives JSON a deny-all CSP and leaves page and route policies alone", async () => {
    await withApp("development", async (baseUrl) => {
      expect((await fetch(`${baseUrl}/api/v1/healthz`)).headers.get("content-security-policy")).toBe(JSON_CSP);
      expect((await fetch(`${baseUrl}/page`)).headers.get("content-security-policy")).toBe(
        "default-src 'none'; style-src 'unsafe-inline'",
      );
      expect((await fetch(`${baseUrl}/own-csp.json`)).headers.get("content-security-policy")).toBe("default-src 'self'");
    });
  });

  it("sends HSTS only in production", async () => {
    await withApp("development", async (baseUrl) => {
      expect((await fetch(`${baseUrl}/api/v1/healthz`)).headers.get("strict-transport-security")).toBeNull();
    });
    await withApp("production", async (baseUrl) => {
      expect((await fetch(`${baseUrl}/api/v1/healthz`)).headers.get("strict-transport-security")).toBe(
        "max-age=63072000; includeSubDomains; preload",
      );
    });
  });
});
