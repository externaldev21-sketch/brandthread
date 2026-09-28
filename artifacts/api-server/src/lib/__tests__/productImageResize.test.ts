import { describe, expect, it, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  files: new Map<string, { buffer: Buffer; contentType: string; acl: unknown }>(),
  createdPaths: [] as string[],
}));

vi.mock("../objectAcl", () => ({
  getObjectAclPolicy: vi.fn(async (file: { path: string }) => state.files.get(file.path)?.acl ?? null),
  setObjectAclPolicy: vi.fn(async (file: { path: string }, policy: unknown) => {
    const entry = state.files.get(file.path);
    if (entry) entry.acl = policy;
  }),
}));

vi.mock("../objectStorage", async () => {
  const actual = await vi.importActual<typeof import("../objectStorage")>("../objectStorage");
  class FakeObjectStorageService {
    async getObjectEntityFile(path: string) {
      const entry = state.files.get(path);
      if (!entry) throw new actual.ObjectNotFoundError();
      return {
        path,
        getMetadata: async () => [{ contentType: entry.contentType }],
        download: async () => [entry.buffer],
      };
    }
    async createObjectEntityFromBuffer(buffer: Buffer, contentType: string, objectPath: string) {
      state.files.set(objectPath, { buffer, contentType, acl: null });
      state.createdPaths.push(objectPath);
      return objectPath;
    }
  }
  return { ...actual, ObjectStorageService: FakeObjectStorageService };
});

import sharp from "sharp";
import { getChatCardImagePath, getChatCardImagePaths, CHAT_CARD_IMAGE_WIDTH } from "../productImageResize";

async function makeFakeJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 100, b: 50 } },
  }).jpeg().toBuffer();
}

beforeEach(() => {
  state.files.clear();
  state.createdPaths = [];
});

describe("getChatCardImagePath", () => {
  it("returns an external URL unchanged (never touches our object storage)", async () => {
    const result = await getChatCardImagePath("https://cdn.example.com/p1.jpg");
    expect(result).toBe("https://cdn.example.com/p1.jpg");
    expect(state.createdPaths).toEqual([]);
  });

  it("generates and caches a width-capped copy of a large original", async () => {
    const original = await makeFakeJpeg(1080, 1920);
    state.files.set("/objects/uploads/p1", { buffer: original, contentType: "image/jpeg", acl: { owner: "seller-1", visibility: "private" } });

    const resizedPath = await getChatCardImagePath("/objects/uploads/p1");
    expect(resizedPath).toBe(`/objects/uploads/p1-w${CHAT_CARD_IMAGE_WIDTH}`);
    expect(state.createdPaths).toEqual([resizedPath]);

    const resizedEntry = state.files.get(resizedPath)!;
    const meta = await sharp(resizedEntry.buffer).metadata();
    expect(meta.width).toBe(CHAT_CARD_IMAGE_WIDTH);
    expect(resizedEntry.buffer.length).toBeLessThan(original.length);
    // ACL mirrored from the original.
    expect(resizedEntry.acl).toEqual({ owner: "seller-1", visibility: "private" });
  });

  it("never upscales a source narrower than the target width", async () => {
    const original = await makeFakeJpeg(300, 400);
    state.files.set("/objects/uploads/small", { buffer: original, contentType: "image/jpeg", acl: null });

    const resizedPath = await getChatCardImagePath("/objects/uploads/small");
    const resizedEntry = state.files.get(resizedPath)!;
    const meta = await sharp(resizedEntry.buffer).metadata();
    expect(meta.width).toBe(300);
  });

  it("reuses the cached copy on a second call instead of resizing again", async () => {
    const original = await makeFakeJpeg(1080, 1920);
    state.files.set("/objects/uploads/p2", { buffer: original, contentType: "image/jpeg", acl: null });

    const first = await getChatCardImagePath("/objects/uploads/p2");
    const second = await getChatCardImagePath("/objects/uploads/p2");
    expect(second).toBe(first);
    // Only the resized copy itself was ever created, once.
    expect(state.createdPaths).toEqual([first]);
  });

  it("fails open to the original path when the source object is missing", async () => {
    const result = await getChatCardImagePath("/objects/uploads/missing");
    expect(result).toBe("/objects/uploads/missing");
    expect(state.createdPaths).toEqual([]);
  });
});

describe("getChatCardImagePaths", () => {
  it("resolves a batch in parallel, passing null through untouched", async () => {
    const original = await makeFakeJpeg(1080, 1920);
    state.files.set("/objects/uploads/batch", { buffer: original, contentType: "image/jpeg", acl: null });

    const results = await getChatCardImagePaths(["/objects/uploads/batch", null, "https://cdn.example.com/x.jpg"]);
    expect(results).toEqual([`/objects/uploads/batch-w${CHAT_CARD_IMAGE_WIDTH}`, null, "https://cdn.example.com/x.jpg"]);
  });
});
