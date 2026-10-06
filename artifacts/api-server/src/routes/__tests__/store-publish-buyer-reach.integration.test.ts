/**
 * Store builder → publish → buyers reach it, end to end through the real
 * store router and Postgres (only Clerk identity is a header):
 *  - what the seller saves (incl. social links + analytics code, which
 *    Drizzle used to drop) is what's stored and restored from a version;
 *  - a DRAFT store is invisible to buyers everywhere; once published it is
 *    reachable WITHOUT a session as JSON (/public/:slug, public fields only)
 *    and as a page via the Share Store link (/by-username/:username), the
 *    store's subdomain, and a verified custom domain (/host-site);
 *  - custom domains are normalised, can't be double-claimed, and an
 *    unverified squat is released after 48h.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray, sql } from "drizzle-orm";
import { db, storefrontCustomDomains, storefronts, storefrontVersions, users } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const id = req.headers["x-test-user-id"];
    if (!id) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = id;
    next();
  },
}));

const sfx = crypto.randomUUID().slice(0, 8);
const SELLER = `store-reach-seller-${sfx}`;
const OTHER = `store-reach-other-${sfx}`;
const USERNAME = `reach${sfx}`;
const DOMAIN = `shop-${sfx}.example.com`;
let server: Server;
let base = "";
let slug = "";

async function call(method: string, path: string, opts: { as?: string; body?: unknown; host?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.as) headers["x-test-user-id"] = opts.as;
  if (opts.host) headers["x-forwarded-host"] = opts.host;
  const res = await fetch(`${base}/api/store${path}`, {
    method, headers, redirect: "manual",
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, body, location: res.headers.get("location") };
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: SELLER, email: `${SELLER}@t.test`, name: "Seller", username: USERNAME, brandName: "Reach Studio", onboardingComplete: true },
    { clerkId: OTHER, email: `${OTHER}@t.test`, name: "Other", onboardingComplete: true },
  ]);
  const { default: storeRouter } = await import("../store");
  const app = express();
  app.use(express.json());
  app.use("/api/store", storeRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  const sfs = await db.select({ id: storefronts.id }).from(storefronts).where(inArray(storefronts.ownerId, [SELLER, OTHER]));
  if (sfs.length) {
    await db.delete(storefrontCustomDomains).where(inArray(storefrontCustomDomains.storefrontId, sfs.map((s) => s.id)));
    await db.delete(storefrontVersions).where(inArray(storefrontVersions.storefrontId, sfs.map((s) => s.id))).catch(() => {});
  }
  await db.delete(storefronts).where(inArray(storefronts.ownerId, [SELLER, OTHER]));
  await db.delete(users).where(inArray(users.clerkId, [SELLER, OTHER]));
});

describe("store builder → publish → buyers", () => {
  it("saves everything the builder sends, including social links and analytics code", async () => {
    const saved = await call("PUT", "/", {
      as: SELLER,
      body: { title: "Reach Studio", socialLinks: { instagram: "reachstudio" }, analyticsCode: "G-TEST123" },
    });
    expect(saved.status).toBe(200);
    slug = saved.body.slug;
    const [row] = await db.select().from(storefronts).where(eq(storefronts.ownerId, SELLER));
    expect(row.socialLinks).toEqual({ instagram: "reachstudio" });
    expect(row.analyticsCode).toBe("G-TEST123");
  });

  it("a draft store is invisible to buyers everywhere", async () => {
    expect((await call("GET", `/public/${slug}`)).status).toBe(404);
    expect((await call("GET", `/by-username/${USERNAME}`)).status).toBe(404);
    const host = await call("GET", "/host-site", { host: `${slug}.brandthread.app` });
    expect(host.status).toBe(302);
    expect(host.location).toBe("https://brandthread.app");
  });

  it("once published, a signed-out buyer reaches it as JSON (public fields only) and as a page", async () => {
    expect((await call("POST", "/publish", { as: SELLER })).status).toBe(200);

    const json = await call("GET", `/public/${slug}`);
    expect(json.status).toBe(200);
    expect(json.body).toMatchObject({ slug, title: "Reach Studio", status: "published", socialLinks: { instagram: "reachstudio" } });
    expect(json.body).not.toHaveProperty("analyticsCode");
    expect(json.body).not.toHaveProperty("sharePreviewTokenHash");

    const shared = await call("GET", `/by-username/${USERNAME.toUpperCase()}`);
    expect(shared.status).toBe(200);
    expect(String(shared.body)).toContain("Reach Studio");

    const subdomain = await call("GET", "/host-site", { host: `${slug}.brandthread.app` });
    expect(subdomain.status).toBe(200);
    expect(String(subdomain.body)).toContain("Reach Studio");
    // Platform subdomains never resolve to a store.
    expect((await call("GET", "/host-site", { host: "www.brandthread.app" })).status).toBe(302);
  });

  it("custom domains: normalised, verified before serving, never double-claimed", async () => {
    expect((await call("POST", "/domains", { as: SELLER, body: { domain: "not a domain" } })).status).toBe(400);
    expect((await call("POST", "/domains", { as: SELLER, body: { domain: "x.brandthread.app" } })).status).toBe(400);

    const added = await call("POST", "/domains", { as: SELLER, body: { domain: `HTTPS://${DOMAIN.toUpperCase()}/` } });
    expect(added.status).toBe(200);
    expect(added.body.domain).toBe(DOMAIN);

    // Unverified: buyers on that host are sent to Brandthread, not the store.
    expect((await call("GET", "/host-site", { host: DOMAIN })).status).toBe(302);

    // Another store can't take it while the claim is fresh…
    const taken = await call("POST", "/domains", { as: OTHER, body: { domain: DOMAIN } });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe("DOMAIN_TAKEN");

    // …verified (DNS TXT matched), it serves the store.
    await db.update(storefrontCustomDomains).set({ verified: true }).where(eq(storefrontCustomDomains.domain, DOMAIN));
    const live = await call("GET", "/host-site", { host: DOMAIN });
    expect(live.status).toBe(200);
    expect(String(live.body)).toContain("Reach Studio");
    expect((await call("POST", "/domains", { as: OTHER, body: { domain: DOMAIN } })).status).toBe(409);
  });

  it("an unverified claim older than 48h is released to the store that can verify it", async () => {
    const squat = `squat-${sfx}.example.com`;
    await call("POST", "/domains", { as: SELLER, body: { domain: squat } });
    await db.execute(sql`UPDATE storefront_custom_domains SET created_at = now() - interval '3 days' WHERE domain = ${squat}`);
    const reclaimed = await call("POST", "/domains", { as: OTHER, body: { domain: squat } });
    expect(reclaimed.status).toBe(200);
    expect(reclaimed.body.domain).toBe(squat);
  });
});
