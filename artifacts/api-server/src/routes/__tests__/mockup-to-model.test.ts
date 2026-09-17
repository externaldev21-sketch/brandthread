/**
 * Tests for POST /api/photography/mockup-to-model and /mockup-to-model/retry
 *
 * Covers:
 * - Required mockup gating (missing → 400)
 * - Required references gating (missing / empty → 400)
 * - Max 5 references enforced (6 → 400)
 * - Multi-select: one output per reference, stable ordering
 * - Partial failure: successful outputs preserved, failed slots reported
 * - Retry: single reference re-generated without discarding other results
 * - Byte validation: >8MB per image → 400
 * - MIME/signature rejection: invalid data-URL → 400
 * - No mock fallback: all failures → 502/422 with no fabricated output
 * - Auth required: unauthenticated → 401
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "node:fs/promises";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ files: string[]; prompt: string }>,
  failRefIndex: -1,   // -1 = none fail; otherwise the refIndex that throws
  qualityFailIndex: -1,
  authEnabled: true,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!state.authEnabled) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    req.auth = { userId: "mockup-to-model-test-user" };
    next();
  },
}));

vi.mock("@workspace/integrations-openai-ai-server/image", () => {
  class MockImageQualityError extends Error {
    reasons: string[];
    constructor(reasons: string[]) {
      super("quality failed");
      this.reasons = reasons;
    }
  }
  return {
    buildFashionPrompt: (_op: string, brief: string, context: string) =>
      `photoshoot. ${context} ${brief}`,
    generateWithVisualQa: async (input: {
      prompt: string;
      generate: (prompt: string) => Promise<Buffer>;
    }) => {
      return input.generate(input.prompt);
    },
    ImageQualityError: MockImageQualityError,
    ImageQualityUnavailableError: class ImageQualityUnavailableError extends Error {},
    editImages: async (files: string[], prompt: string) => {
      // Extract payload after PNG signature (8 bytes) for each file
      const contents = await Promise.all(
        files.map(async (f) => (await fs.readFile(f)).subarray(8).toString("utf8")),
      );
      state.calls.push({ files: contents, prompt });
      // contents[0] = mockup, contents[1] = reference
      // Determine which refIndex this is from the filename.
      // We identify by ref content.
      const refContent = contents[1] ?? "";
      // Parse refIndex from content like "ref-N"
      const match = /^ref-(\d+)$/.exec(refContent);
      const refIdx = match ? Number(match[1]) : -1;
      if (state.failRefIndex >= 0 && refIdx === state.failRefIndex) {
        throw new Error("provider failure for ref");
      }
      if (state.qualityFailIndex >= 0 && refIdx === state.qualityFailIndex) {
        throw new MockImageQualityError(["garment shifted"]);
      }
      return Buffer.from(`result-${refContent}`);
    },
  };
});

import photographyRouter from "../photography";

let server: Server;
let base = "";

function pngDataUrl(content: string): string {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return `data:image/png;base64,${Buffer.concat([pngSignature, Buffer.from(content)]).toString("base64")}`;
}

function refs(count: number): string[] {
  return Array.from({ length: count }, (_, i) => pngDataUrl(`ref-${i}`));
}

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "60mb" }));
  app.use("/api/photography", photographyRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("mockup-to-model: auth", () => {
  it("rejects unauthenticated requests", async () => {
    state.authEnabled = false;
    const res = await fetch(`${base}/api/photography/mockup-to-model`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mockup: pngDataUrl("mockup"), references: refs(1) }),
    });
    expect(res.status).toBe(401);
    state.authEnabled = true;
  });
});

describe("mockup-to-model: input validation", () => {
  beforeAll(() => {
    state.calls = [];
    state.failRefIndex = -1;
    state.qualityFailIndex = -1;
    state.authEnabled = true;
  });

  it("requires a mockup image", async () => {
    const res = await fetch(`${base}/api/photography/mockup-to-model`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ references: refs(1) }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/mockup/i);
  });

  it("requires at least one reference image", async () => {
    const res = await fetch(`${base}/api/photography/mockup-to-model`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mockup: pngDataUrl("mockup"), references: [] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/reference/i);
  });

  it("rejects missing references field entirely", async () => {
    const res = await fetch(`${base}/api/photography/mockup-to-model`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mockup: pngDataUrl("mockup") }),
    });
    expect(res.status).toBe(400);
  });

  it("enforces max 5 references", async () => {
    const res = await fetch(`${base}/api/photography/mockup-to-model`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mockup: pngDataUrl("mockup"), references: refs(6) }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/5/);
  });

  it("accepts exactly 5 references", async () => {
    state.calls = [];
    state.failRefIndex = -1;
    state.qualityFailIndex = -1;
    const res = await fetch(`${base}/api/photography/mockup-to-model`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mockup: pngDataUrl("mockup"), references: refs(5) }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.results).toHaveLength(5);
  });

  it("rejects invalid (non-image) data-URL for mockup", async () => {
    const res = await fetch(`${base}/api/photography/mockup-to-model`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mockup: `data:image/heic;base64,${Buffer.from("heic-data").toString("base64")}`,
        references: refs(1),
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/JPEG|PNG|WEBP/i);
  });

  it("rejects invalid data-URL for a reference image", async () => {
    const res = await fetch(`${base}/api/photography/mockup-to-model`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mockup: pngDataUrl("mockup"),
        references: [
          pngDataUrl("ref-0"),
          `data:image/heic;base64,${Buffer.from("bad").toString("base64")}`,
        ],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/JPEG|PNG|WEBP/i);
  });

  it("rejects a mockup image over 8MB by byte check", async () => {
    // Build a valid PNG header + huge payload
    const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const oversize = Buffer.concat([pngSig, Buffer.alloc(8 * 1024 * 1024 + 1, 0x41)]);
    const res = await fetch(`${base}/api/photography/mockup-to-model`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mockup: `data:image/png;base64,${oversize.toString("base64")}`,
        references: refs(1),
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/8MB/);
  });
});

describe("mockup-to-model: one output per reference, stable order", () => {
  it("produces one result per reference in input order", async () => {
    state.calls = [];
    state.failRefIndex = -1;
    state.qualityFailIndex = -1;
    const res = await fetch(`${base}/api/photography/mockup-to-model`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mockup: pngDataUrl("mockup"),
        references: refs(3),
        prompt: "Editorial lookbook.",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.results).toHaveLength(3);
    // Results must be sorted by refIndex
    expect(body.results.map((r: any) => r.refIndex)).toEqual([0, 1, 2]);
    // Each result must contain a non-empty b64_json
    for (const r of body.results) {
      expect(typeof r.b64_json).toBe("string");
      expect(r.b64_json.length).toBeGreaterThan(0);
    }
    // Each generation call must have included the mockup as the first image
    for (const call of state.calls) {
      expect(call.files[0]).toBe("mockup");
    }
  });
});

describe("mockup-to-model: partial failure", () => {
  it("preserves successful outputs when one reference fails", async () => {
    state.calls = [];
    state.failRefIndex = 1; // ref-1 will throw
    state.qualityFailIndex = -1;
    const res = await fetch(`${base}/api/photography/mockup-to-model`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mockup: pngDataUrl("mockup"),
        references: refs(3),
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    // 2 succeeded, 1 failed
    expect(body.results).toHaveLength(2);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].refIndex).toBe(1);
    expect(body.errors[0].retryable).toBe(true);
    // Successful indices must be 0 and 2
    const successIndices = body.results.map((r: any) => r.refIndex).sort();
    expect(successIndices).toEqual([0, 2]);
    state.failRefIndex = -1;
  });

  it("returns 502 when all references fail (provider errors)", async () => {
    state.calls = [];
    // Fail all 3 refs
    // We use a special approach: override failRefIndex to fail by pattern.
    // For this test, make all fail by using a custom approach.
    // We'll set failRefIndex to each one by using a wrapper.
    // Simpler: failRefIndex = 0 only covers one; use qualityFailIndex approach
    // Actually we need all to fail. Let's fail ref-0 with failRefIndex = 0
    // and also fail others. The mock only fails one index at a time.
    // We'll test with a single reference that fails instead.
    state.failRefIndex = 0;
    state.qualityFailIndex = -1;
    const res = await fetch(`${base}/api/photography/mockup-to-model`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mockup: pngDataUrl("mockup"),
        references: [pngDataUrl("ref-0")], // single ref, will fail
      }),
    });
    expect(res.status).toBe(502);
    const body = await res.json() as any;
    expect(body.retryable).toBe(true);
    expect(body.results).toBeDefined();
    expect(body.results).toHaveLength(0);
    // No fabricated fallback
    expect(body.b64_json).toBeUndefined();
    state.failRefIndex = -1;
  });

  it("returns 422 when all references fail quality check", async () => {
    state.calls = [];
    state.failRefIndex = -1;
    state.qualityFailIndex = 0;
    const res = await fetch(`${base}/api/photography/mockup-to-model`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mockup: pngDataUrl("mockup"),
        references: [pngDataUrl("ref-0")],
      }),
    });
    expect(res.status).toBe(422);
    const body = await res.json() as any;
    expect(body.retryable).toBe(true);
    expect(body.results).toHaveLength(0);
    state.qualityFailIndex = -1;
  });
});

describe("mockup-to-model: retry", () => {
  it("retries a single reference and returns its refIndex", async () => {
    state.calls = [];
    state.failRefIndex = -1;
    state.qualityFailIndex = -1;
    const res = await fetch(`${base}/api/photography/mockup-to-model/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mockup: pngDataUrl("mockup"),
        reference: pngDataUrl("ref-2"),
        refIndex: 2,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.refIndex).toBe(2);
    expect(typeof body.b64_json).toBe("string");
    expect(body.b64_json.length).toBeGreaterThan(0);
  });

  it("retry requires a mockup image", async () => {
    const res = await fetch(`${base}/api/photography/mockup-to-model/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reference: pngDataUrl("ref-0"),
        refIndex: 0,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("retry requires a reference image", async () => {
    const res = await fetch(`${base}/api/photography/mockup-to-model/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mockup: pngDataUrl("mockup"),
        refIndex: 0,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("retry rejects out-of-range refIndex", async () => {
    const res = await fetch(`${base}/api/photography/mockup-to-model/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mockup: pngDataUrl("mockup"),
        reference: pngDataUrl("ref-0"),
        refIndex: 10,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("retry returns 422 when quality check fails", async () => {
    state.qualityFailIndex = 0;
    const res = await fetch(`${base}/api/photography/mockup-to-model/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mockup: pngDataUrl("mockup"),
        reference: pngDataUrl("ref-0"),
        refIndex: 0,
      }),
    });
    expect(res.status).toBe(422);
    const body = await res.json() as any;
    expect(body.retryable).toBe(true);
    state.qualityFailIndex = -1;
  });
});
