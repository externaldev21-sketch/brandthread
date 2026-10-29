/**
 * Wave-1 audit (slice s10) — routes/profile-cover.ts: when screening refuses a
 * cover and recording that refusal fails, the failure must not escape as an
 * unhandled promise rejection (which can take the process down). Vitest fails
 * the run on an unhandled rejection, so this test fails without the .catch.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { db, users } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id");
    next();
  },
}));
vi.mock("../../lib/mediaModeration", async (orig) => ({
  ...(await orig<typeof import("../../lib/mediaModeration")>()),
  screenVideo: async () => ({ verdict: "reject", unverified: false, reasons: ["test"] }),
}));
const recorded = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../../lib/mediaModerationStore", () => ({
  recordRejectedUpload: async () => { recorded.calls += 1; throw new Error("store down"); },
}));

const suffix = crypto.randomBytes(6).toString("hex");
const owner = `w1s10-cover-${suffix}`;
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(64)]);
const GIF = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(64)]);
let server: Server;
let base = "";

beforeAll(async () => {
  await db.insert(users).values({ clerkId: owner, email: `${owner}@test.local`, name: "Cover", accountType: "buyer" });
  const { createProfileCoverRouter } = await import("../profile-cover");
  const router = createProfileCoverRouter({
    processor: {
      probeDuration: async () => 5,
      render: async (_i, output, poster) => { await fs.writeFile(output, Buffer.from("r")); await fs.writeFile(poster, Buffer.from("p")); },
      renderGif: async (_i, output, poster) => { await fs.writeFile(output, Buffer.from("g")); await fs.writeFile(poster, Buffer.from("p")); },
    },
    storage: {
      createObjectEntityFromBuffer: async () => `/objects/uploads/${crypto.randomUUID()}`,
      trySetObjectEntityAclPolicy: async () => undefined,
      deleteObjectEntity: async () => undefined,
    },
  });
  const app = express();
  app.use((req, _res, next) => { (req as any).log = { error: () => undefined, warn: () => undefined }; next(); });
  app.use("/api/profile", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(users).where(eq(users.clerkId, owner));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("refused cover with a failing rejection store", () => {
  it.each([
    ["/api/profile/cover-video", MP4, "video/mp4"],
    ["/api/profile/cover-gif", GIF, "image/gif"],
  ])("%s answers 422 and swallows the store failure", async (path, body, type) => {
    const before = recorded.calls;
    const res = await fetch(`${base}${path}`, { method: "POST", headers: { "x-test-user-id": owner, "content-type": type }, body });
    expect(res.status).toBe(422);
    await vi.waitFor(() => expect(recorded.calls).toBe(before + 1));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});
