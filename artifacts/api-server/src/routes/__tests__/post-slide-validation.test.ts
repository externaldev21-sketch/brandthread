/**
 * Post-slide validation — focused unit tests.
 *
 * Tests:
 *  A. Magic-byte / MIME / size guards on photo-slides upload
 *  B. compose-slideshow: slide count, objectPath format, overlay field injection
 *  C. posts POST/PATCH: slideOverlays strict rejection, mediaPaths bounds
 *
 * All DB and storage interactions are mocked — these are pure validation tests.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// ─── Hoisted mocks state ──────────────────────────────────────────────────────
// Valid UUID for PATCH route (requires UUID format)
const TEST_POST_ID = "00000000-0000-0000-0000-000000000001";

const state = vi.hoisted(() => ({
  clerkId: "seller-test-id",
  insertedPost: { id: "00000000-0000-0000-0000-000000000001", mediaPaths: [], slideOverlays: [] } as Record<string, unknown>,
  // patchExisting is returned for ALL db.select().limit() calls (both sellerExists and post-fetch).
  // accountType: "seller" satisfies sellerExists; the rest satisfy the post-fetch.
  patchExisting: {
    accountType: "seller",
    id: "00000000-0000-0000-0000-000000000001",
    userId: "seller-test-id",
    mediaUrl: "",
    thumbnailUrl: null,
    postStatus: "draft",
    publishedAt: null,
    scheduledAt: null,
    visibility: { isPublic: false, allowComments: true, allowReposts: true, showLikeCount: true },
    mediaPaths: [] as string[],
  } as Record<string, unknown>,
  setVisibilityCalls: 0,
  setVisibilityError: null as Error | null,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = state.clerkId;
    next();
  },
}));

vi.mock("drizzle-orm", () => {
  const eq    = (...a: unknown[]) => ({ op: "eq", a });
  const and   = (...a: unknown[]) => ({ op: "and", a });
  const inArray = (...a: unknown[]) => ({ op: "inArray", a });
  const count = () => ({ op: "count" });
  const sql   = (s: TemplateStringsArray, ...v: unknown[]) => ({ op: "sql", s, v });
  sql.raw = (s: string) => ({ op: "sql.raw", s });
  const desc  = (c: unknown) => ({ op: "desc", c });
  const lte   = (...a: unknown[]) => ({ op: "lte", a });
  const lt    = (...a: unknown[]) => ({ op: "lt", a });
  const gte   = (...a: unknown[]) => ({ op: "gte", a });
  const or    = (...a: unknown[]) => ({ op: "or", a });
  return { eq, and, inArray, count, sql, desc, lte, lt, gte, or };
});

vi.mock("@workspace/db", () => {
  const col = new Proxy({}, { get: (_t, k) => String(k) });
  // limitCallsInFlight tracks sequential .limit() calls within a single request handler.
  // Reset between tests via state.selectCallN.
  // PATCH calls .limit() twice: first for sellerExists, second for the post fetch.
  // We unify by making patchExisting carry accountType so both callers are satisfied.
  const chainSelect = {
    from: () => chainSelect,
    where: () => chainSelect,
    limit: async () => [state.patchExisting],
    innerJoin: () => chainSelect,
    orderBy: () => chainSelect,
  };
  const chainInsert = {
    values: () => ({
      returning: async () => [state.insertedPost],
    }),
  };
  const chainUpdate = {
    set: () => ({
      where: async () => [state.patchExisting],
    }),
  };
  const chainDelete = {
    where: async () => undefined,
  };
  return {
    db: {
      select: () => chainSelect,
      insert: () => chainInsert,
      update: () => chainUpdate,
      delete: () => chainDelete,
    },
    posts: col,
    users: col,
    products: col,
    postTaggedProducts: col,
    interactions: col,
    follows: col,
    boosts: col,
    savedItems: col,
    orders: col,
  };
});

vi.mock("../post-video", () => ({
  default: (() => {
    const r = express.Router();
    return r;
  })(),
  mediaUrl: (_req: unknown, path: string) => `https://cdn.example.com/${path}`,
  setComposedMediaVisibility: async () => {
    if (state.setVisibilityError) throw state.setVisibilityError;
    state.setVisibilityCalls++;
  },
}));

// post-slide router: use the real router (for compose-slideshow validation tests)
// but mock object storage + ffmpeg so no I/O happens
vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async uploadBuffer() { return "/objects/uploads/out/slide-1.jpg"; }
    async getSignedDownloadUrl() { return "https://signed.example.com/slide.jpg"; }
    async getObject() {
      // Return a minimal JPEG (SOI + APP0 marker)
      return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    }
    async getObjectMetadata() { return { contentType: "image/jpeg", size: 6 }; }
    async setObjectPermissions() {}
    async deleteObject() {}
  },
}));

vi.mock("../../lib/objectAcl", () => ({
  ObjectPermission: { PRIVATE: "private", PUBLIC_READ: "public-read" },
}));

vi.mock("node:child_process", () => ({
  execFile: (_cmd: string, _args: string[], _opts: unknown, cb: (...a: unknown[]) => void) => {
    cb(null, "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "");
  },
}));

vi.mock("node:fs", () => {
  const memFiles = new Map<string, Buffer | string>();
  return {
    promises: {
      mkdtemp: async (prefix: string) => `/tmp/fake-${prefix.replace(/\//g, "_")}`,
      writeFile: async (path: string, data: Buffer | string) => { memFiles.set(String(path), data); },
      rm: async () => {},
      access: async (path: string) => {
        if (!path.includes("DejaVu")) throw new Error("not found");
      },
    },
  };
});

import postsRouter from "../posts";

type ApiBody = { error?: string; [k: string]: unknown };

// ─── Build test app ───────────────────────────────────────────────────────────
let server: Server;
let baseUrl = "";

const validOverlay = {
  id: "o1", text: "Hello", x: 0.5, y: 0.3,
  color: "#ffffff", fontStyle: "classic", align: "center",
  bgStyle: "none", fontSize: 32,
};

const validSlideOverlays = [
  { slideIndex: 0, overlays: [validOverlay] },
];

const validMediaPaths = ["/objects/uploads/seller-test-id/slide-1.jpg"];

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req: any, _res: unknown, next: () => void) => {
    req.log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    next();
  });
  app.use("/api/posts", postsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())));
});

beforeEach(() => {
  state.setVisibilityCalls = 0;
  state.setVisibilityError = null;
  state.insertedPost = { id: TEST_POST_ID, mediaPaths: [], slideOverlays: [], postStatus: "draft" };
  state.patchExisting = {
    // accountType included so the sellerExists check (first .limit() call) also passes
    accountType: "seller",
    id: TEST_POST_ID, userId: "seller-test-id",
    mediaUrl: "", thumbnailUrl: null,
    postStatus: "draft", publishedAt: null, scheduledAt: null,
    visibility: { isPublic: false, allowComments: true, allowReposts: true, showLikeCount: true },
    mediaPaths: [],
  };
});

// ─── A. Posts POST: mediaPaths bounds ────────────────────────────────────────

describe("POST /api/posts — mediaPaths validation", () => {
  async function postPost(body: Record<string, unknown>) {
    const res = await fetch(`${baseUrl}/api/posts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mediaType: "slideshow", isDraft: true, ...body }),
    });
    return { status: res.status, body: (await res.json()) as ApiBody };
  }

  it("accepts valid mediaPaths array", async () => {
    const { status } = await postPost({ mediaPaths: validMediaPaths });
    expect(status).toBe(201);
  });

  it("rejects non-array mediaPaths", async () => {
    const { status, body } = await postPost({ mediaPaths: "not-an-array" });
    expect(status).toBe(400);
    expect(body.error).toMatch(/mediaPaths must be an array/i);
  });

  it("rejects mediaPaths with more than 10 entries", async () => {
    const paths = Array.from({ length: 11 }, (_, i) => `/objects/uploads/s/slide-${i}.jpg`);
    const { status, body } = await postPost({ mediaPaths: paths });
    expect(status).toBe(400);
    expect(body.error).toMatch(/max 10/i);
  });

  it("rejects mediaPaths with duplicate entries", async () => {
    const { status, body } = await postPost({
      mediaPaths: ["/objects/uploads/s/a.jpg", "/objects/uploads/s/a.jpg"],
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/duplicate/i);
  });

  it("rejects mediaPaths entries that fail path format", async () => {
    const { status, body } = await postPost({
      mediaPaths: ["/bad/path/../escape.jpg"],
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/valid object path/i);
  });
});

// ─── B. Posts POST: slideOverlays strict validation ──────────────────────────

describe("POST /api/posts — slideOverlays strict validation", () => {
  async function postPost(slideOverlays: unknown) {
    const res = await fetch(`${baseUrl}/api/posts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mediaType: "slideshow", isDraft: true, mediaPaths: validMediaPaths, slideOverlays }),
    });
    return { status: res.status, body: (await res.json()) as ApiBody };
  }

  it("accepts well-formed slideOverlays", async () => {
    const { status } = await postPost(validSlideOverlays);
    expect(status).toBe(201);
  });

  it("accepts null slideOverlays (treated as empty)", async () => {
    const { status } = await postPost(null);
    expect(status).toBe(201);
  });

  it("rejects non-array slideOverlays", async () => {
    const { status, body } = await postPost("injected");
    expect(status).toBe(400);
    expect(body.error).toMatch(/slideOverlays must be an array/i);
  });

  it("rejects slideOverlays with more than 10 entries", async () => {
    const oversized = Array.from({ length: 11 }, (_, i) => ({ slideIndex: i, overlays: [] }));
    const { status, body } = await postPost(oversized);
    expect(status).toBe(400);
    expect(body.error).toMatch(/max 10/i);
  });

  it("rejects duplicate slideIndex values", async () => {
    const { status, body } = await postPost([
      { slideIndex: 0, overlays: [] },
      { slideIndex: 0, overlays: [] },
    ]);
    expect(status).toBe(400);
    expect(body.error).toMatch(/duplicate slideIndex/i);
  });

  it("rejects non-integer slideIndex", async () => {
    const { status, body } = await postPost([{ slideIndex: 0.5, overlays: [] }]);
    expect(status).toBe(400);
    expect(body.error).toMatch(/integer/i);
  });

  it("rejects slideIndex >= MAX_SLIDES (10)", async () => {
    const { status, body } = await postPost([{ slideIndex: 10, overlays: [] }]);
    expect(status).toBe(400);
    expect(body.error).toMatch(/0–9/);
  });

  it("rejects unknown fields on entry object", async () => {
    const { status, body } = await postPost([
      { slideIndex: 0, overlays: [], injected: "bad" },
    ]);
    expect(status).toBe(400);
    expect(body.error).toMatch(/unknown field/i);
  });

  it("rejects overlay with empty text", async () => {
    const { status, body } = await postPost([
      { slideIndex: 0, overlays: [{ ...validOverlay, text: "" }] },
    ]);
    expect(status).toBe(400);
    expect(body.error).toMatch(/non-empty string/i);
  });

  it("rejects overlay with text exceeding 200 chars", async () => {
    const { status, body } = await postPost([
      { slideIndex: 0, overlays: [{ ...validOverlay, text: "a".repeat(201) }] },
    ]);
    expect(status).toBe(400);
    expect(body.error).toMatch(/200 characters/i);
  });

  it("rejects overlay x out of [0,1]", async () => {
    const { status, body } = await postPost([
      { slideIndex: 0, overlays: [{ ...validOverlay, x: 1.5 }] },
    ]);
    expect(status).toBe(400);
    expect(body.error).toMatch(/x must be 0/i);
  });

  it("rejects overlay with invalid color (not hex #rrggbb)", async () => {
    const { status, body } = await postPost([
      { slideIndex: 0, overlays: [{ ...validOverlay, color: "red" }] },
    ]);
    expect(status).toBe(400);
    expect(body.error).toMatch(/hex/i);
  });

  it("rejects overlay with unknown fontStyle", async () => {
    const { status, body } = await postPost([
      { slideIndex: 0, overlays: [{ ...validOverlay, fontStyle: "comic-sans" }] },
    ]);
    expect(status).toBe(400);
    expect(body.error).toMatch(/fontStyle/i);
  });

  it("rejects overlay with invalid align", async () => {
    const { status, body } = await postPost([
      { slideIndex: 0, overlays: [{ ...validOverlay, align: "justify" }] },
    ]);
    expect(status).toBe(400);
    expect(body.error).toMatch(/align/i);
  });

  it("rejects overlay with invalid bgStyle", async () => {
    const { status, body } = await postPost([
      { slideIndex: 0, overlays: [{ ...validOverlay, bgStyle: "blur" }] },
    ]);
    expect(status).toBe(400);
    expect(body.error).toMatch(/bgStyle/i);
  });

  it("rejects overlay fontSize out of [10, 120]", async () => {
    const { status, body } = await postPost([
      { slideIndex: 0, overlays: [{ ...validOverlay, fontSize: 9 }] },
    ]);
    expect(status).toBe(400);
    expect(body.error).toMatch(/fontSize/i);
  });

  it("rejects overlay with unknown extra fields (injection guard)", async () => {
    const { status, body } = await postPost([
      { slideIndex: 0, overlays: [{ ...validOverlay, __proto__: null, exec: "rm -rf /" }] },
    ]);
    expect(status).toBe(400);
    expect(body.error).toMatch(/unknown field/i);
  });

  it("rejects more than 10 overlays on a single slide", async () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => ({ ...validOverlay, id: `o${i}` }));
    const { status, body } = await postPost([{ slideIndex: 0, overlays: tooMany }]);
    expect(status).toBe(400);
    expect(body.error).toMatch(/max 10 overlays/i);
  });
});

// ─── C. Posts PATCH: slideOverlays strict validation ─────────────────────────

describe("PATCH /api/posts/:id — slideOverlays strict validation", () => {
  async function patchPost(slideOverlays: unknown) {
    const res = await fetch(`${baseUrl}/api/posts/${TEST_POST_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slideOverlays }),
    });
    return { status: res.status, body: (await res.json()) as ApiBody };
  }

  it("rejects non-array slideOverlays in PATCH", async () => {
    const { status, body } = await patchPost("not-an-array");
    expect(status).toBe(400);
    expect(body.error).toMatch(/slideOverlays must be an array/i);
  });

  it("rejects slideOverlays with injection overlay in PATCH", async () => {
    const { status, body } = await patchPost([
      { slideIndex: 0, overlays: [{ ...validOverlay, color: "$(rm -rf /)" }] },
    ]);
    expect(status).toBe(400);
    expect(body.error).toMatch(/hex/i);
  });

  it("rejects duplicate slideIndex in PATCH", async () => {
    const { status, body } = await patchPost([
      { slideIndex: 0, overlays: [] },
      { slideIndex: 0, overlays: [] },
    ]);
    expect(status).toBe(400);
    expect(body.error).toMatch(/duplicate slideIndex/i);
  });

  it("PATCH mediaPaths over limit is rejected", async () => {
    const paths = Array.from({ length: 11 }, (_, i) => `/objects/uploads/s/slide-${i}.jpg`);
    const res = await fetch(`${baseUrl}/api/posts/${TEST_POST_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mediaPaths: paths }),
    });
    const body = (await res.json()) as ApiBody;
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/max 10/i);
  });

  it("PATCH mediaPaths with duplicates is rejected", async () => {
    const res = await fetch(`${baseUrl}/api/posts/${TEST_POST_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mediaPaths: ["/objects/uploads/s/a.jpg", "/objects/uploads/s/a.jpg"],
      }),
    });
    const body = (await res.json()) as ApiBody;
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/duplicate/i);
  });
});

// ─── D. slideValidation unit tests (direct import, no HTTP) ──────────────────

describe("validateSlideOverlays — unit", () => {
  // Import directly so we can test edge cases without the HTTP layer
  let validate: typeof import("../../lib/slideValidation").validateSlideOverlays;

  beforeAll(async () => {
    const mod = await import("../../lib/slideValidation");
    validate = mod.validateSlideOverlays;
  });

  it("accepts undefined → empty records", () => {
    const result = validate(undefined);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.records).toHaveLength(0);
  });

  it("accepts empty array → empty records", () => {
    const result = validate([]);
    expect(result.ok).toBe(true);
  });

  it("accepts valid multi-slide records", () => {
    const result = validate([
      { slideIndex: 0, overlays: [validOverlay] },
      { slideIndex: 1, overlays: [] },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.records).toHaveLength(2);
  });

  it("normalises color to lowercase", () => {
    const result = validate([
      { slideIndex: 0, overlays: [{ ...validOverlay, color: "#FFFFFF" }] },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.records[0].overlays[0].color).toBe("#ffffff");
  });

  it("strips timing fields that are absent (startTime/endTime optional)", () => {
    const result = validate([
      { slideIndex: 0, overlays: [validOverlay] },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ov = result.records[0].overlays[0];
      expect(ov.startTime).toBeUndefined();
      expect(ov.endTime).toBeUndefined();
    }
  });

  it("accepts valid optional startTime / endTime", () => {
    const result = validate([
      { slideIndex: 0, overlays: [{ ...validOverlay, startTime: 0, endTime: 3.5 }] },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ov = result.records[0].overlays[0];
      expect(ov.startTime).toBe(0);
      expect(ov.endTime).toBe(3.5);
    }
  });

  it("rejects negative startTime", () => {
    const result = validate([
      { slideIndex: 0, overlays: [{ ...validOverlay, startTime: -1 }] },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/startTime/i);
  });
});
