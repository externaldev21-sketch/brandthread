/**
 * Seller metafield definitions against the real database (migration 285
 * creates metafield_definitions — before it, every call answered 500).
 * Covers create → count → list → edit → delete, validation, and that one
 * seller can never see or change another seller's definitions.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const state = vi.hoisted(() => ({ userId: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = state.userId;
    next();
  },
}));

const RUN = `mf${Math.random().toString(36).slice(2, 8)}`;
const ME = `user_test_${RUN}_me`;
const OTHER = `user_test_${RUN}_other`;

let server: Server;
let base = "";

async function call(path: string, opts: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`${base}/api/seller/metafields${path}`, {
    method: opts.method ?? "GET",
    headers: { "content-type": "application/json" },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

beforeAll(async () => {
  const { default: router } = await import("../seller-metafields");
  const app = express();
  app.use(express.json());
  app.use("/api/seller/metafields", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  state.userId = ME;
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM metafield_definitions WHERE owner_id IN (${ME}, ${OTHER})`);
  await new Promise<void>((r) => server?.close(() => r()));
});

describe("metafield definitions", () => {
  it("creates, counts, lists, edits and deletes a definition", async () => {
    const created = await call("", {
      method: "POST",
      body: { ownerResource: "products", key: "fabric", name: "Fabric", description: "Main fabric" },
    });
    expect(created.status).toBe(201);
    const id = created.json.definition.id as string;
    expect(created.json.definition.owner_id).toBe(ME);

    const counts = await call("");
    expect(counts.status).toBe(200);
    expect(counts.json.counts.products).toBe(1);

    const list = await call("/products");
    expect(list.status).toBe(200);
    expect(list.json.definitions.map((d: any) => d.key)).toEqual(["fabric"]);

    const edited = await call(`/${id}`, {
      method: "PATCH",
      body: { name: "Fabric blend", type: "multi_line_text_field", description: null, pinned: true },
    });
    expect(edited.status).toBe(200);
    expect(edited.json.definition).toMatchObject({
      name: "Fabric blend", type: "multi_line_text_field", description: null, pinned: true, key: "fabric",
    });

    // Omitted fields are left alone.
    const partial = await call(`/${id}`, { method: "PATCH", body: { name: "Fabric" } });
    expect(partial.status).toBe(200);
    expect(partial.json.definition).toMatchObject({ name: "Fabric", type: "multi_line_text_field", pinned: true });

    const removed = await call(`/${id}`, { method: "DELETE" });
    expect(removed.status).toBe(200);
    expect((await call("/products")).json.definitions).toEqual([]);
  });

  it("rejects bad input with a 400 instead of a server error", async () => {
    expect((await call("", { method: "POST", body: { ownerResource: "products", key: "Bad Key!", name: "X" } })).status).toBe(400);
    expect((await call("", { method: "POST", body: { ownerResource: "nope", key: "a", name: "X" } })).status).toBe(400);
    expect((await call("", { method: "POST", body: { ownerResource: "products", key: "a", name: "X", type: "weird" } })).status).toBe(400);
    expect((await call("", { method: "POST", body: { ownerResource: "products", key: 5, name: "X" } })).status).toBe(400);
    expect((await call("/not-a-uuid", { method: "PATCH", body: { name: "X" } })).status).toBe(404);
    expect((await call("/not-a-uuid", { method: "DELETE" })).status).toBe(404);
  });

  it("never exposes or changes another seller's definitions", async () => {
    state.userId = OTHER;
    const theirs = await call("", { method: "POST", body: { ownerResource: "collections", key: "season", name: "Season" } });
    expect(theirs.status).toBe(201);
    const theirId = theirs.json.definition.id as string;

    state.userId = ME;
    expect((await call("/collections")).json.definitions).toEqual([]);
    expect((await call(`/${theirId}`, { method: "PATCH", body: { name: "Hijacked" } })).status).toBe(404);
    expect((await call(`/${theirId}`, { method: "DELETE" })).status).toBe(404);

    state.userId = OTHER;
    const still = await call("/collections");
    expect(still.json.definitions).toHaveLength(1);
    expect(still.json.definitions[0].name).toBe("Season");
  });
});
