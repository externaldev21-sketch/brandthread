import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  designStudioAssets,
  designStudioObjectCleanup,
  designStudioProjects,
} from "@workspace/db";
import { runDesignStudioObjectCleanup } from "../designStudioObjectCleanup";

const projectIds: string[] = [];
const objectPaths: string[] = [];

async function createProjectWithAsset(objectPath: string): Promise<void> {
  const id = `cleanup-${crypto.randomBytes(8).toString("hex")}`;
  projectIds.push(id);
  await db.insert(designStudioProjects).values({
    id,
    ownerId: `owner-${id}`,
    snapshot: { id, name: "Cleanup test", canvas: { width: 1, height: 1 }, layers: [] },
  });
  await db.insert(designStudioAssets).values({
    projectId: id,
    ownerId: `owner-${id}`,
    kind: "source",
    objectPath,
    width: 1,
    height: 1,
    mimeType: "image/png",
    format: "png",
    lossless: true,
    quality: null,
    byteSize: 1,
  });
}

afterEach(async () => {
  for (const id of projectIds.splice(0)) {
    await db.delete(designStudioProjects).where(eq(designStudioProjects.id, id));
  }
  for (const path of objectPaths.splice(0)) {
    await db.delete(designStudioObjectCleanup)
      .where(eq(designStudioObjectCleanup.objectPath, path));
  }
});

describe("Design Studio object cleanup", () => {
  it("never deletes an object path that still has an asset reference", async () => {
    const path = `/objects/uploads/${crypto.randomUUID()}`;
    objectPaths.push(path);
    await createProjectWithAsset(path);
    await db.insert(designStudioObjectCleanup).values({ objectPath: path });
    const deleted: string[] = [];

    await runDesignStudioObjectCleanup(new Date(), {
      deleteObjectEntity: async (objectPath: string) => { deleted.push(objectPath); },
    } as any);

    expect(deleted).toEqual([]);
    expect(await db.select().from(designStudioObjectCleanup)
      .where(eq(designStudioObjectCleanup.objectPath, path))).toHaveLength(0);
  });

  it("keeps failed deletions queued and retries them after backoff", async () => {
    const path = `/objects/uploads/${crypto.randomUUID()}`;
    objectPaths.push(path);
    const now = new Date("2026-09-15T12:00:00.000Z");
    await db.insert(designStudioObjectCleanup).values({ objectPath: path, nextAttemptAt: now });

    await runDesignStudioObjectCleanup(now, {
      deleteObjectEntity: async () => { throw new Error("storage unavailable"); },
    } as any);

    const [failed] = await db.select().from(designStudioObjectCleanup)
      .where(eq(designStudioObjectCleanup.objectPath, path));
    expect(failed.attemptCount).toBe(1);
    expect(failed.claimedAt).toBeNull();
    expect(failed.lastError).toBe("storage unavailable");
    expect(failed.nextAttemptAt.getTime()).toBe(now.getTime() + 60_000);

    const deleted: string[] = [];
    await runDesignStudioObjectCleanup(failed.nextAttemptAt, {
      deleteObjectEntity: async (objectPath: string) => { deleted.push(objectPath); },
    } as any);

    expect(deleted).toEqual([path]);
    expect(await db.select().from(designStudioObjectCleanup)
      .where(eq(designStudioObjectCleanup.objectPath, path))).toHaveLength(0);
  });
});