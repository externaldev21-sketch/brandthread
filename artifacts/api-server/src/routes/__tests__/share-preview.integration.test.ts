import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { db, posts, storefronts, users } from "@workspace/db";

const suffix = crypto.randomBytes(6).toString("hex");
const author = `sp-author-${suffix}`;
const suspended = `sp-susp-${suffix}`;
const ids = [author, suspended];

let server: Server;
let base = "";
const postIds: Record<string, string> = {};
const storeSlug = `sp-store-${suffix}`;
const draftSlug = `sp-draft-${suffix}`;

const get = async (path: string) => {
  const r = await fetch(`${base}${path}`);
  return { status: r.status, body: (await r.json().catch(() => null)) as any, headers: r.headers };
};

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: author, email: `${author}@t.local`, name: "Author", username: `sp_a_${suffix}`, displayName: "Nova Studio", role: "buyer", accountType: "buyer" },
    { clerkId: suspended, email: `${suspended}@t.local`, name: "Susp", username: `sp_s_${suffix}`, role: "buyer", accountType: "buyer", suspendedAt: new Date() },
  ]);
  const base_ = { userId: author, mediaUrl: "https://img.test/a.mp4", mediaType: "video", thumbnailUrl: "https://img.test/a.jpg" } as const;
  const rows = await db.insert(posts).values([
    { ...base_, caption: "Public drop  \n  fit check" },
    { ...base_, caption: "hidden", visibility: { isPublic: false } as any },
    { ...base_, caption: "held", moderationStatus: "held" as any },
    { ...base_, caption: "draft", postStatus: "draft" as any },
    { ...base_, userId: suspended, caption: "from suspended" },
    { ...base_, caption: "rel thumb", thumbnailUrl: "/objects/private/x.jpg" },
  ]).returning({ id: posts.id, caption: posts.caption });
  for (const r of rows) postIds[r.caption ?? ""] = r.id;
  await db.insert(storefronts).values([
    { ownerId: author, slug: storeSlug, title: "Nova Goods", description: "Handmade.", status: "published", branding: { logoUrl: "https://img.test/logo.png" } },
    { ownerId: suspended, slug: draftSlug, title: "Draft", status: "draft" },
  ]);
  const { default: router } = await import("../share-preview");
  const app = express();
  app.use("/api/v1/public", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(storefronts).where(inArray(storefronts.ownerId, ids));
  await db.delete(posts).where(inArray(posts.userId, ids));
  await db.delete(users).where(inArray(users.clerkId, ids));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /public/posts/:id/share-preview", () => {
  it("returns a minimal allow-listed payload for a public post", async () => {
    const r = await get(`/api/v1/public/posts/${postIds["Public drop  \n  fit check"]}/share-preview`);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(["authorHandle", "authorName", "caption", "id", "imageUrl", "mediaType"]);
    expect(r.body.authorName).toBe("Nova Studio");
    expect(r.body.caption).toBe("Public drop fit check");
    expect(r.body.imageUrl).toBe("https://img.test/a.jpg");
    expect(r.headers.get("cache-control")).toContain("public");
  });

  it("does not leak the author's private fields", async () => {
    const r = await get(`/api/v1/public/posts/${postIds["Public drop  \n  fit check"]}/share-preview`);
    expect(JSON.stringify(r.body)).not.toContain(author);
    expect(JSON.stringify(r.body)).not.toContain("@t.local");
  });

  it.each(["hidden", "held", "draft", "from suspended"])("404s for a non-public post (%s)", async (key) => {
    const r = await get(`/api/v1/public/posts/${postIds[key]}/share-preview`);
    expect(r.status).toBe(404);
  });

  it("404s for unknown and malformed ids", async () => {
    expect((await get(`/api/v1/public/posts/${crypto.randomUUID()}/share-preview`)).status).toBe(404);
    expect((await get("/api/v1/public/posts/not-a-uuid/share-preview")).status).toBe(404);
  });

  it("never returns a private /objects path as the image", async () => {
    const r = await get(`/api/v1/public/posts/${postIds["rel thumb"]}/share-preview`);
    expect(r.status).toBe(200);
    expect(r.body.imageUrl).toBeNull();
  });
});

describe("GET /public/stores/:slug/share-preview", () => {
  it("returns name, description and logo for a published store", async () => {
    const r = await get(`/api/v1/public/stores/${storeSlug}/share-preview`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ slug: storeSlug, name: "Nova Goods", description: "Handmade.", imageUrl: "https://img.test/logo.png" });
  });

  it("404s for draft and unknown stores", async () => {
    expect((await get(`/api/v1/public/stores/${draftSlug}/share-preview`)).status).toBe(404);
    expect((await get("/api/v1/public/stores/nope-nope/share-preview")).status).toBe(404);
  });
});
