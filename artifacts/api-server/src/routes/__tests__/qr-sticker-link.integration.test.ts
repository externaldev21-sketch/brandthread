import {getWebOrigin} from "../../lib/webOrigin";
/**
 * Pop-up QR sticker link: one find-or-create tracked store link per seller
 * (utm_source=popup, utm_medium=qr) whose /api/l/:code scans redirect to the
 * store with UTM tags and count as clicks.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, users, trackedLinks, linkClicks } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(5).toString("hex");
const seller = `qr-seller-${suffix}`;
const noHandle = `qr-nohandle-${suffix}`;
const username = `qrseller${suffix}`;
const CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const authState = vi.hoisted(() => ({ clerkUserId: null as string | null }));
vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: authState.clerkUserId }) }));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!authState.clerkUserId) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = authState.clerkUserId;
    next();
  },
  requirePlan: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

let server: Server;
let base = "";

async function post(as: string | null) {
  authState.clerkUserId = as;
  const res = await fetch(`${base}/api/growth/qr-sticker-link`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: seller, email: `${seller}@test.local`, name: "QR Seller", brandName: "Northline Studio", username, role: "seller", accountType: "seller" },
    { clerkId: noHandle, email: `${noHandle}@test.local`, name: "No Handle", role: "seller", accountType: "seller" },
  ]);
  const { default: growthRouter } = await import("../growth");
  const pub = await import("../growthPublic");
  const app = express();
  app.use(express.json());
  app.set("trust proxy", 1);
  app.use("/api/growth", growthRouter);
  app.get("/api/l/:code", pub.trackedLinkRedirect);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(linkClicks).where(inArray(linkClicks.sellerId, [seller, noHandle]));
  await db.delete(trackedLinks).where(inArray(trackedLinks.sellerId, [seller, noHandle]));
  await db.delete(users).where(inArray(users.clerkId, [seller, noHandle]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("pop-up QR sticker link", () => {
  it("requires sign-in", async () => {
    expect((await post(null)).status).toBe(401);
  });

  it("refuses until the store has a public home", async () => {
    const r = await post(noHandle);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("STORE_NOT_LIVE");
  });

  it("creates one tracked store link with popup/qr UTM tags and returns it again on every call", async () => {
    const [a, b] = await Promise.all([post(seller), post(seller)]);
    expect(a.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
    expect(a.body).toMatchObject({
      label: "Pop-up QR sticker", destinationType: "store", utmSource: "popup", utmMedium: "qr", utmCampaign: "qr-sticker",
      username, storeName: "Northline Studio", clicks: 0,
    });
    expect(a.body.qrUrl).toBe(`${getWebOrigin()}/api/l/${a.body.code}`);
    const rows = await db.select().from(trackedLinks).where(eq(trackedLinks.sellerId, seller));
    expect(rows).toHaveLength(1);
  });

  it("a scan redirects to the store with the UTM tags and counts as a click", async () => {
    const { body } = await post(seller);
    const scan = await fetch(`${base}/api/l/${body.code}`, { redirect: "manual", headers: { "user-agent": CHROME } });
    expect(scan.status).toBe(302);
    const to = new URL(scan.headers.get("location")!);
    expect(to.pathname).toBe(`/@${username}`);
    expect(to.searchParams.get("utm_source")).toBe("popup");
    expect(to.searchParams.get("utm_medium")).toBe("qr");
    expect((await post(seller)).body.clicks).toBe(1);
  });

  it("an archived sticker link is replaced by a new one", async () => {
    const first = (await post(seller)).body;
    await db.update(trackedLinks).set({ archivedAt: new Date() }).where(eq(trackedLinks.id, first.id));
    const next = (await post(seller)).body;
    expect(next.id).not.toBe(first.id);
    expect(next.code).not.toBe(first.code);
  });
});
