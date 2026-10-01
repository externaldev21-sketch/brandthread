import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Mocks the same two things every other AI-image route test mocks (see
 * design-reference-images.test.ts): the OpenAI-backed generation call, and
 * the low-level GCS client underneath ObjectStorageService — never the real
 * network/cloud services. The `db` calls in src/lib/studioCoverArt.ts are
 * real (this file needs a real Postgres connection to run — see
 * src/testUtils/dbFileScan.ts and vitest.config.ts's auto-provisioning),
 * same as every other `*.integration.test.ts` in this directory.
 */
const state = vi.hoisted(() => ({
  generationCalls: [] as string[],
  storedBuffers: new Map<string, Buffer>(),
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = "studio-cover-art-test-admin";
    next();
  },
  requireModerator: (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock("@workspace/integrations-openai-ai-server/image", () => ({
  generateImageBuffer: async (prompt: string) => {
    state.generationCalls.push(prompt);
    return Buffer.from(`generated:${prompt.slice(0, 20)}`);
  },
}));

vi.mock("../../lib/objectStorage", async () => {
  const actual = await vi.importActual<typeof import("../../lib/objectStorage")>("../../lib/objectStorage");
  class FakeFile {
    constructor(private path: string) {}
    async exists() { return [state.storedBuffers.has(this.path)]; }
    async download() { return [state.storedBuffers.get(this.path) ?? Buffer.from("")]; }
    get bucket() { return { name: "fake-bucket" }; }
    get name() { return this.path; }
  }
  class FakeObjectStorageService {
    async createObjectEntityFromBuffer(contents: Buffer, _contentType: string, objectPath: string) {
      state.storedBuffers.set(objectPath, contents);
      return objectPath;
    }
    async getObjectEntityFile(objectPath: string) { return new FakeFile(objectPath); }
    async getObjectEntityDownloadURL(objectPath: string) { return `https://fake-signed.example/${encodeURIComponent(objectPath)}`; }
  }
  return { ...actual, ObjectStorageService: FakeObjectStorageService };
});

import studioCoverArtRouter from "../studio-cover-art";
import { db, studioCoverArt } from "@workspace/db";
import { eq } from "drizzle-orm";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/config/studio-cover-art", studioCoverArtRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(async () => {
  state.generationCalls = [];
  state.storedBuffers.clear();
  await db.delete(studioCoverArt).where(eq(studioCoverArt.cardId, "add-product"));
});

describe("Studio cover-art routes", () => {
  it("generates candidates with the shared prompt template, and auto-picks candidate 1 on first generation", async () => {
    const genRes = await fetch(`${base}/api/config/studio-cover-art/add-product/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count: 2 }),
    });
    expect(genRes.status).toBe(200);
    const genBody = await genRes.json() as any;
    expect(genBody.generated).toHaveLength(2);
    expect(state.generationCalls).toHaveLength(2);
    expect(state.generationCalls[0]).toContain("chrome garment hanger");
    expect(state.generationCalls[0]).toContain("9:16 portrait composition");

    const manifestRes = await fetch(`${base}/api/config/studio-cover-art`);
    const manifestBody = await manifestRes.json() as any;
    expect(manifestBody.covers["add-product"].url).toBe(`https://fake-signed.example/${encodeURIComponent(genBody.generated[0].objectPath)}`);
    expect(typeof manifestBody.covers["add-product"].blurhash).toBe("string");
  });

  it("a second generation run appends candidates without disturbing an existing pick", async () => {
    await fetch(`${base}/api/config/studio-cover-art/add-product/generate`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ count: 1 }),
    });
    const [afterFirst] = await db.select().from(studioCoverArt).where(eq(studioCoverArt.cardId, "add-product")).limit(1);
    const firstChosen = afterFirst.chosenObjectPath;

    await fetch(`${base}/api/config/studio-cover-art/add-product/generate`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ count: 1 }),
    });
    const [afterSecond] = await db.select().from(studioCoverArt).where(eq(studioCoverArt.cardId, "add-product")).limit(1);
    expect(afterSecond.candidates).toHaveLength(2);
    expect(afterSecond.chosenObjectPath).toBe(firstChosen);
  });

  it("select lets an admin swap the chosen candidate", async () => {
    const genRes = await fetch(`${base}/api/config/studio-cover-art/add-product/generate`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ count: 2 }),
    });
    const { generated } = await genRes.json() as any;

    const selectRes = await fetch(`${base}/api/config/studio-cover-art/add-product/select`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ objectPath: generated[1].objectPath }),
    });
    expect(selectRes.status).toBe(200);

    const manifestRes = await fetch(`${base}/api/config/studio-cover-art`);
    const manifestBody = await manifestRes.json() as any;
    expect(manifestBody.covers["add-product"].url).toContain(encodeURIComponent(generated[1].objectPath));
  });

  it("rejects an unknown card id", async () => {
    const res = await fetch(`${base}/api/config/studio-cover-art/not-a-real-card/generate`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    expect(res.status).toBe(400);
  });

  it("rejects selecting an objectPath that isn't one of the card's own candidates", async () => {
    await fetch(`${base}/api/config/studio-cover-art/add-product/generate`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ count: 1 }),
    });
    const res = await fetch(`${base}/api/config/studio-cover-art/add-product/select`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ objectPath: "/objects/studio-cover-art/add-product/not-a-real-one.png" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
