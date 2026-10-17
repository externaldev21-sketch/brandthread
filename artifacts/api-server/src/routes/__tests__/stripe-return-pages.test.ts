/**
 * Stripe sends a browser with no Brandthread session to these landing pages
 * after Checkout, the Billing Portal and affiliate payout onboarding. They must
 * live under /api (the path the API artifact serves) and must not require auth.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import subscriptionRouter, { subscriptionRedirectRouter, subscriptionReturnBase } from "../subscription";
import affiliateCreatorRouter, { affiliatePayoutRedirectRouter, affiliatePayoutReturnUrls } from "../affiliate-creator";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  // Same order as routes/index.ts.
  app.use("/api/seller/subscription", subscriptionRedirectRouter);
  app.use("/api/seller/subscription", subscriptionRouter);
  app.use("/api/affiliate/payout-account", affiliatePayoutRedirectRouter);
  app.use("/api/affiliate", affiliateCreatorRouter);
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("Stripe return URLs", () => {
  it("use the /api prefix, never /api-server", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(subscriptionReturnBase()).toBe("https://brandthread.app/api");
    const urls = affiliatePayoutReturnUrls();
    expect(urls.returnUrl).toBe("https://brandthread.app/api/affiliate/payout-account/return");
    expect(urls.refreshUrl).toBe("https://brandthread.app/api/affiliate/payout-account/refresh");
    vi.unstubAllEnvs();
  });

  it("serves the Checkout success page without auth and escapes input", async () => {
    const res = await fetch(`${base}/api/seller/subscription/return?status=success&plan=pro`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Subscription started");
    expect(html).toContain("Brandthread Pro Plan");
    expect(html).toContain("brandthread://subscription?checkout=success");

    const evil = await fetch(`${base}/api/seller/subscription/return?status=success&plan=%3Cscript%3E`);
    expect(await evil.text()).not.toContain("<script>");
  });

  it("serves the Checkout cancel and Billing Portal return pages without auth", async () => {
    const cancel = await fetch(`${base}/api/seller/subscription/return?status=cancel`);
    expect(cancel.status).toBe(200);
    expect(await cancel.text()).toContain("Checkout cancelled");

    const portal = await fetch(`${base}/api/seller/subscription/portal/return`);
    expect(portal.status).toBe(200);
    expect(await portal.text()).toContain("Billing updated");
  });

  it("still protects the authenticated subscription routes", async () => {
    const res = await fetch(`${base}/api/seller/subscription/status`);
    // No Clerk middleware in this harness, so requireAuth rejects (4xx/5xx) rather than serving.
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("sends affiliate creators back to the creator program, not a dead page", async () => {
    const ret = await fetch(`${base}/api/affiliate/payout-account/return`, { redirect: "manual" });
    expect(ret.status).toBe(302);
    expect(ret.headers.get("location")).toBe("brandthread://creator-program?payouts=returned");

    const refresh = await fetch(`${base}/api/affiliate/payout-account/refresh`, { redirect: "manual" });
    expect(refresh.status).toBe(302);
    expect(refresh.headers.get("location")).toBe("brandthread://creator-program?payouts=refresh");
  });
});
