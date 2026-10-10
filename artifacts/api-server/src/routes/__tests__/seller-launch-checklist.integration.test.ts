/**
 * /api/seller/launch-checklist — done flags come from real rows, preview-seen
 * is recorded once, dismiss sticks, and one seller never sees another's state.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, products, storefronts, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const sellerA = `launch-checklist-a-${suffix}`;
const sellerB = `launch-checklist-b-${suffix}`;

const authState = vi.hoisted(() => ({ clerkUserId: null as string | null }));
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: authState.clerkUserId }),
}));

let server: Server;
let base = "";

const get = async () => {
  const response = await fetch(`${base}/api/seller/launch-checklist`);
  return { status: response.status, body: (await response.json().catch(() => null)) as any };
};
const stepDone = (body: any, id: string) => body.steps.find((s: any) => s.id === id).done;

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: sellerA, email: `${sellerA}@test.local`, name: "Seller A", displayName: "Seller A", role: "seller", accountType: "seller" },
    { clerkId: sellerB, email: `${sellerB}@test.local`, name: "Seller B", displayName: "Seller B", role: "seller", accountType: "seller" },
  ]);

  const { default: router } = await import("../seller-launch-checklist");
  const app = express();
  app.use(express.json());
  app.use("/api/seller/launch-checklist", router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(products).where(inArray(products.ownerId, [sellerA, sellerB]));
  await db.delete(storefronts).where(inArray(storefronts.ownerId, [sellerA, sellerB]));
  await db.delete(users).where(inArray(users.clerkId, [sellerA, sellerB]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("seller launch checklist API", () => {
  it("401s with no auth", async () => {
    authState.clerkUserId = null;
    const { status } = await get();
    expect(status).toBe(401);
  });

  it("starts with every step open", async () => {
    authState.clerkUserId = sellerA;
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.total).toBe(8);
    expect(body.doneCount).toBe(0);
    expect(body.dismissed).toBe(false);
    expect(body.steps.map((s: any) => s.id)).toEqual([
      "name_handle", "logo_banner", "accent", "socials", "first_product", "preview", "publish", "payouts",
    ]);
  });

  it("derives steps from users, products, storefront and Stripe state", async () => {
    authState.clerkUserId = sellerA;
    await db.update(users).set({
      brandName: "Atelier",
      username: `atelier_${suffix}`,
      logoUrl: "/objects/logo",
      bannerUrl: "/objects/banner",
      storeAccentColor: "#111111",
      socialLinks: { instagram: "atelier" },
      stripeAccountStatus: "active",
    }).where(eq(users.clerkId, sellerA));
    await db.insert(products).values({ ownerId: sellerA, name: "Tee" } as any);
    await db.insert(storefronts).values({ ownerId: sellerA, slug: `slug-${suffix}`, status: "published" });

    const { body } = await get();
    for (const id of ["name_handle", "logo_banner", "accent", "socials", "first_product", "publish", "payouts"]) {
      expect(stepDone(body, id)).toBe(true);
    }
    expect(stepDone(body, "preview")).toBe(false);
    expect(body.doneCount).toBe(7);
    expect(body.handle).toBe(`atelier_${suffix}`);
  });

  it("a soft-deleted product does not count, and a draft storefront is unpublished", async () => {
    authState.clerkUserId = sellerB;
    await db.insert(products).values({ ownerId: sellerB, name: "Gone", deletedAt: new Date() } as any);
    await db.insert(storefronts).values({ ownerId: sellerB, slug: `slug-b-${suffix}`, status: "draft" });
    const { body } = await get();
    expect(stepDone(body, "first_product")).toBe(false);
    expect(stepDone(body, "publish")).toBe(false);
  });

  it("preview-seen completes the preview step and keeps the first timestamp", async () => {
    authState.clerkUserId = sellerA;
    const first = await fetch(`${base}/api/seller/launch-checklist/preview-seen`, { method: "POST" });
    expect(first.status).toBe(204);
    const [{ at: firstAt }] = await db.select({ at: users.storePreviewedAt }).from(users).where(eq(users.clerkId, sellerA));
    expect(firstAt).toBeTruthy();

    await fetch(`${base}/api/seller/launch-checklist/preview-seen`, { method: "POST" });
    const [{ at: secondAt }] = await db.select({ at: users.storePreviewedAt }).from(users).where(eq(users.clerkId, sellerA));
    expect(secondAt?.getTime()).toBe(firstAt?.getTime());

    const { body } = await get();
    expect(stepDone(body, "preview")).toBe(true);
    expect(body.complete).toBe(true);
  });

  it("dismiss only affects the caller", async () => {
    authState.clerkUserId = sellerA;
    const dismissed = await fetch(`${base}/api/seller/launch-checklist/dismiss`, { method: "POST" });
    expect(dismissed.status).toBe(204);
    expect((await get()).body.dismissed).toBe(true);

    authState.clerkUserId = sellerB;
    expect((await get()).body.dismissed).toBe(false);
  });
});
