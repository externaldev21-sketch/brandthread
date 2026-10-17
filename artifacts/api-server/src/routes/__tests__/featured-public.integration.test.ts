/**
 * GET /api/public/featured — admin "Featured on Discover" picks, with the
 * display data the mobile Discover rail renders (brand name/avatar, thread
 * thumbnail), window gating (startsAt/endsAt) and suspended/hidden filtering.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { inArray } from "drizzle-orm";
import { db, featuredItems, posts, users } from "@workspace/db";

const suffix = crypto.randomBytes(6).toString("hex");
const brandA = `feat-brand-a-${suffix}`;
const brandSuspended = `feat-brand-s-${suffix}`;
const brandFuture = `feat-brand-f-${suffix}`;
const admin = `feat-admin-${suffix}`;

let server: Server;
let base = "";
let postId = "";

beforeAll(async () => {
  const { default: featuredPublicRouter } = await import("../featured-public");
  const app = express();
  app.use((req, _res, next) => { (req as any).log = { error: () => {} }; next(); });
  app.use("/api/public/featured", featuredPublicRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await db.insert(users).values([
    { clerkId: brandA, email: `${brandA}@example.test`, name: "A", displayName: "Feat A", brandName: "Feat Brand A", avatarUrl: "https://img.test/a.png", accountType: "seller" },
    { clerkId: brandSuspended, email: `${brandSuspended}@example.test`, name: "S", displayName: "Feat S", accountType: "seller", suspendedAt: new Date() },
    { clerkId: brandFuture, email: `${brandFuture}@example.test`, name: "F", displayName: "Feat F", accountType: "seller" },
  ] as any);
  const [post] = await db.insert(posts).values({
    userId: brandA, mediaUrl: "https://img.test/p.jpg", mediaType: "photo", caption: "Featured fit",
    postStatus: "published", moderationStatus: "visible",
  } as any).returning({ id: posts.id });
  postId = post.id;

  const later = new Date(Date.now() + 86_400_000);
  await db.insert(featuredItems).values([
    { kind: "brand", targetId: brandA, label: "Editor's pick", position: 1, createdBy: admin },
    { kind: "brand", targetId: brandSuspended, position: 2, createdBy: admin },
    { kind: "brand", targetId: brandFuture, position: 3, startsAt: later, createdBy: admin },
    { kind: "thread", targetId: postId, label: "Fit of the week", position: 1, createdBy: admin },
  ]);
});

afterAll(async () => {
  await db.delete(featuredItems).where(inArray(featuredItems.createdBy, [admin]));
  if (postId) await db.delete(posts).where(inArray(posts.id, [postId]));
  await db.delete(users).where(inArray(users.clerkId, [brandA, brandSuspended, brandFuture]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/public/featured", () => {
  it("returns live picks with display data, skipping suspended and not-yet-started items", async () => {
    const res = await fetch(`${base}/api/public/featured`);
    expect(res.status).toBe(200);
    const body = await res.json() as { brands: any[]; threads: any[] };
    const ours = body.brands.filter((b) => [brandA, brandSuspended, brandFuture].includes(b.userId));
    expect(ours).toEqual([
      { userId: brandA, label: "Editor's pick", name: "Feat Brand A", imageUrl: "https://img.test/a.png", verified: false },
    ]);
    const thread = body.threads.find((t) => t.postId === postId);
    expect(thread).toMatchObject({
      postId, label: "Fit of the week", authorId: brandA, caption: "Featured fit",
      mediaType: "photo", thumbnailUrl: "https://img.test/p.jpg",
    });
  });
});
