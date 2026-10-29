/**
 * Wave 1 audit (slice s08): the compose endpoints (carousel, slideshow,
 * video, video cover frame) answered 500 when a source upload no longer
 * exists — a stale/expired path from the client, not a server failure.
 * They now answer 404 UPLOAD_NOT_FOUND.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { inArray } from "drizzle-orm";
import { db, users } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => { req.clerkUserId = req.header("x-test-user-id"); next(); },
}));

vi.mock("../../lib/objectStorage", () => {
  class ObjectNotFoundError extends Error {}
  class ObjectStorageService {
    async getObjectEntityFile(): Promise<never> { throw new ObjectNotFoundError("Object not found"); }
    async canAccessObjectEntity() { return true; }
    async createObjectEntityFromBuffer() { return "/objects/uploads/never"; }
    async trySetObjectEntityAclPolicy() { return undefined; }
    async deleteObjectEntity() { return undefined; }
    async getObjectEntityDownloadURL() { return "https://signed.test/x"; }
  }
  return { ObjectStorageService, ObjectNotFoundError };
});

const suffix = crypto.randomBytes(5).toString("hex");
const seller = `w1s08-compose-${suffix}`;
let server: Server;
let base = "";

async function post(path: string, body: unknown) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-user-id": seller },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as any };
}

beforeAll(async () => {
  await db.insert(users).values({
    clerkId: seller, email: `${seller}@t.local`, name: "Seller", username: seller.replace(/-/g, "_"),
    role: "seller", accountType: "seller",
  } as any);
  const [carousel, slide, video] = await Promise.all([
    import("../post-carousel"), import("../post-slide"), import("../post-video"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { error: () => {}, warn: () => {} }; next(); });
  app.use("/api/posts", carousel.default, slide.default, video.default);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await db.delete(users).where(inArray(users.clerkId, [seller]));
});

const gone = "/objects/uploads/expired-upload";

describe("compose with a source upload that no longer exists", () => {
  it("compose-carousel → 404", async () => {
    const res = await post("/api/posts/compose-carousel", { items: [{ kind: "photo", objectPath: gone }] });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("UPLOAD_NOT_FOUND");
  });

  it("compose-slideshow → 404", async () => {
    const res = await post("/api/posts/compose-slideshow", { slides: [{ objectPath: gone }] });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("UPLOAD_NOT_FOUND");
  });

  it("compose-video → 404", async () => {
    const res = await post("/api/posts/compose-video", { clips: [{ objectPath: gone }] });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("UPLOAD_NOT_FOUND");
  });

  it("compose-video/thumbnail → 404", async () => {
    const res = await post("/api/posts/compose-video/thumbnail", { mediaPath: gone, offset: 1 });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("UPLOAD_NOT_FOUND");
  });
});
