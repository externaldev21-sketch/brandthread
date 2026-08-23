/**
 * Integration tests for public store preview link replacement and revocation.
 *
 * These run against the development Postgres database. Each token is a signed
 * bearer credential, so the database retains only a SHA-256 fingerprint.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, storefronts } from "@workspace/db";
import { eq } from "drizzle-orm";

const TEST_OWNER = `test-share-preview-${crypto.randomBytes(4).toString("hex")}`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = TEST_OWNER;
    next();
  },
}));

let server: Server;
let base: string;

async function request(
  method: string,
  path: string,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, { method });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

beforeAll(async () => {
  const { default: storeRouter } = await import("../store");
  const app = express();
  app.use(express.json());
  app.use("/api/store", storeRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await db.delete(storefronts).where(eq(storefronts.ownerId, TEST_OWNER));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("shareable storefront previews", () => {
  it("keeps short-lived private preview tokens usable without a public share link", async () => {
    const privateToken = await request("GET", "/api/store/preview-token");
    expect(privateToken.status).toBe(200);
    expect(typeof privateToken.body.token).toBe("string");

    const preview = await request("GET", `/api/store/preview/${privateToken.body.token}`);
    expect(preview.status).toBe(200);
    expect(preview.body).toContain("Preview link");
  });

  it("keeps only the latest issued link valid and revokes it immediately", async () => {
    const first = await request("POST", "/api/store/share-preview");
    expect(first.status).toBe(200);

    const second = await request("POST", "/api/store/share-preview");
    expect(second.status).toBe(200);
    expect(second.body.token).not.toBe(first.body.token);

    const [storefront] = await db
      .select({ sharePreviewTokenHash: storefronts.sharePreviewTokenHash })
      .from(storefronts)
      .where(eq(storefronts.ownerId, TEST_OWNER))
      .limit(1);
    expect(storefront?.sharePreviewTokenHash).toHaveLength(43);
    expect(storefront?.sharePreviewTokenHash).not.toBe(second.body.token);

    const stalePreview = await request("GET", `/api/store/preview/${first.body.token}`);
    expect(stalePreview.status).toBe(410);

    const currentPreview = await request("GET", `/api/store/preview/${second.body.token}`);
    expect(currentPreview.status).toBe(200);
    expect(currentPreview.body).toContain("Preview link");

    const revoked = await request("DELETE", "/api/store/share-preview");
    expect(revoked.status).toBe(200);

    const revokedPreview = await request("GET", `/api/store/preview/${second.body.token}`);
    expect(revokedPreview.status).toBe(410);
  });
});