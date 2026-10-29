import { describe, expect, it } from "vitest";
import {
  ownerSessionsDir,
  sessionChunkPath,
  sessionMetaPath,
  sweepOwnerSessions,
  type UploadSessionMeta,
  type UploadSessionStorage,
} from "../uploadSessions";

// Storage whose reads of one path fail transiently (e.g. a GCS 503).
class FlakyStorage implements UploadSessionStorage {
  objects = new Map<string, Buffer>();
  failReads = new Set<string>();
  async createObjectEntityFromBuffer(contents: Buffer, _type: string, objectPath = `/objects/x/${this.objects.size}`) {
    this.objects.set(objectPath, Buffer.from(contents));
    return objectPath;
  }
  async getObjectEntityFile(objectPath: string) {
    return {
      download: async (): Promise<[Buffer]> => {
        if (this.failReads.has(objectPath)) throw new Error("503 backend unavailable");
        const data = this.objects.get(objectPath);
        if (!data) throw new Error("not found");
        return [data];
      },
    };
  }
  async listObjectEntities(prefix: string) {
    return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([objectPath, b]) => ({ objectPath, size: b.length }));
  }
  async combineObjectEntities() {}
  async deleteObjectEntity(objectPath: string) { this.objects.delete(objectPath); }
}

describe("sweepOwnerSessions (audit)", () => {
  it("does not delete a live session whose meta read fails transiently", async () => {
    const storage = new FlakyStorage();
    const owner = "user-flaky";
    const id = "22222222-2222-4222-8222-222222222222";
    const meta: UploadSessionMeta = { owner, contentType: "image/png", size: 8, chunkSize: 4, totalChunks: 2, createdAt: 1_000 };
    storage.objects.set(sessionMetaPath(owner, id), Buffer.from(JSON.stringify(meta)));
    storage.objects.set(sessionChunkPath(owner, id, 0), Buffer.from("abcd"));
    storage.failReads.add(sessionMetaPath(owner, id));

    const result = await sweepOwnerSessions(storage, owner, 2_000);
    expect(result.removed).toBe(0);
    expect(result.live).toBe(1);
    expect(storage.objects.has(sessionMetaPath(owner, id))).toBe(true);
    expect(storage.objects.has(sessionChunkPath(owner, id, 0))).toBe(true);
  });

  it("still removes real orphans (parts with no meta object)", async () => {
    const storage = new FlakyStorage();
    const owner = "user-orphan";
    storage.objects.set(`${ownerSessionsDir(owner)}/33333333-3333-4333-8333-333333333333/p000000`, Buffer.from("zz"));
    const result = await sweepOwnerSessions(storage, owner, 0);
    expect(result.removed).toBe(1);
    expect(storage.objects.size).toBe(0);
  });
});
