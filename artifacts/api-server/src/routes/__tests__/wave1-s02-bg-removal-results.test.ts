/**
 * Wave-1 audit (slice s02) — GET /api/bg-removal/results/*storageKey.
 * Express 5 passes the wildcard as path segments; the route used to stringify
 * that array (joining with commas), so every lookup of a real key was refused.
 * Ownership is the caller's own `<prefix>/bg-removal/<userId>/<uuid>.png`, and
 * a storage read error must not crash the process.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Readable } from "node:stream";

const state = vi.hoisted(() => {
  process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID = "bucket-test";
  process.env.PRIVATE_OBJECT_DIR = "/bucket-test/.private";
  return { files: new Map<string, Buffer>(), readFails: false, requested: [] as string[] };
});

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = "user_owner";
    next();
  },
}));

vi.mock("../../lib/objectStorage", () => ({
  objectStorageClient: {
    bucket: () => ({
      file: (name: string) => ({
        exists: async () => { state.requested.push(name); return [state.files.has(name)]; },
        createReadStream: () => state.readFails
          ? new Readable({ read() { this.destroy(new Error("storage read failed")); } })
          : Readable.from([state.files.get(name)!]),
      }),
    }),
  },
}));

vi.mock("../../lib/bgRemoval", () => ({ removeBackground: async () => { throw new Error("unused"); } }));

import bgRemovalRouter from "../bg-removal";

let server: Server;
let base = "";
const ownKey = ".private/bg-removal/user_owner/1b4e28ba-2fa1-11d2-883f-0016d3cca427.png";
const otherKey = ".private/bg-removal/user_other/1b4e28ba-2fa1-11d2-883f-0016d3cca427.png";

beforeAll(async () => {
  const app = express();
  app.use("/api/bg-removal", bgRemovalRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
beforeEach(() => {
  state.files = new Map([[ownKey, Buffer.from("png-bytes")], [otherKey, Buffer.from("theirs")]]);
  state.readFails = false;
  state.requested = [];
});

describe("GET /api/bg-removal/results/*storageKey", () => {
  it("serves the caller's own stored result", async () => {
    const res = await fetch(`${base}/api/bg-removal/results/${ownKey}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(await res.text()).toBe("png-bytes");
    expect(state.requested).toEqual([ownKey]);
  });

  it("refuses another user's result and keys that only contain the caller's prefix", async () => {
    expect((await fetch(`${base}/api/bg-removal/results/${otherKey}`)).status).toBe(403);
    const sneaky = `.private/bg-removal/user_other/bg-removal/user_owner/1b4e28ba-2fa1-11d2-883f-0016d3cca427.png`;
    expect((await fetch(`${base}/api/bg-removal/results/${sneaky}`)).status).toBe(403);
    expect(state.requested).toEqual([]);
  });

  it("survives a storage read error mid-stream", async () => {
    state.readFails = true;
    await fetch(`${base}/api/bg-removal/results/${ownKey}`).then((r) => r.text()).catch(() => null);
    // The server is still up and answering.
    state.readFails = false;
    expect((await fetch(`${base}/api/bg-removal/results/${ownKey}`)).status).toBe(200);
  });
});
