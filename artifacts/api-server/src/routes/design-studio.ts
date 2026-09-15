import express, { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  designStudioAssets,
  designStudioProjects,
} from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";

const router = Router();
const storage = new ObjectStorageService();
const MAX_PROJECT_BYTES = 2 * 1024 * 1024;
const MAX_PROJECT_ASSET_BYTES = 500 * 1024 * 1024;
const MAX_OWNER_ASSET_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_SOURCE_ASSETS_PER_PROJECT = 100;
const RETAINED_MASTERS_PER_PROJECT = 5;

function ownerId(req: express.Request): string {
  return (req as any).clerkUserId as string;
}

function validProjectSnapshot(value: unknown, expectedId: string): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const project = value as Record<string, unknown>;
  const canvas = project.canvas as Record<string, unknown> | undefined;
  return project.id === expectedId &&
    typeof project.name === "string" &&
    Array.isArray(project.layers) &&
    !!canvas &&
    Number.isSafeInteger(canvas.width) && Number(canvas.width) > 0 &&
    Number.isSafeInteger(canvas.height) && Number(canvas.height) > 0;
}

export function readPngDimensions(bytes: Buffer): { width: number; height: number } | null {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(signature)) return null;
  let offset = 8;
  let dimensions: { width: number; height: number } | null = null;
  let sawIdat = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) return null;
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const expectedCrc = bytes.readUInt32BE(offset + 8 + length);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== expectedCrc) return null;
    if (offset === 8) {
      if (type !== "IHDR" || length !== 13) return null;
      const width = bytes.readUInt32BE(offset + 8);
      const height = bytes.readUInt32BE(offset + 12);
      if (width === 0 || height === 0) return null;
      dimensions = { width, height };
    }
    if (type === "IDAT") sawIdat = true;
    if (type === "IEND") {
      return length === 0 && end === bytes.length && sawIdat ? dimensions : null;
    }
    offset = end;
  }
  return null;
}

export function readJpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
      bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
  let offset = 2;
  let dimensions: { width: number; height: number } | null = null;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (marker === 0xda) {
      return dimensions;
    }
    if ((marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)) {
      if (length < 7) return null;
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      if (width === 0 || height === 0) return null;
      dimensions = { height, width };
    }
    offset += length;
  }
  return null;
}

export function readGifDimensions(bytes: Buffer): { width: number; height: number } | null {
  const signature = bytes.toString("ascii", 0, 6);
  if (bytes.length < 14 || (signature !== "GIF87a" && signature !== "GIF89a") ||
      bytes[bytes.length - 1] !== 0x3b || !bytes.includes(0x2c, 13)) return null;
  const width = bytes.readUInt16LE(6);
  const height = bytes.readUInt16LE(8);
  return width > 0 && height > 0 ? { width, height } : null;
}

export function readWebpMetadata(
  bytes: Buffer,
): { width: number; height: number; lossless: boolean } | null {
  if (bytes.length < 25 || bytes.toString("ascii", 0, 4) !== "RIFF" ||
      bytes.toString("ascii", 8, 12) !== "WEBP" ||
      bytes.readUInt32LE(4) + 8 !== bytes.length) return null;
  let offset = 12;
  let dimensions: { width: number; height: number; lossless: boolean } | null = null;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const data = offset + 8;
    const end = data + size;
    if (end > bytes.length) return null;
    if (type === "VP8L" && size >= 5 && bytes[data] === 0x2f) {
      const width = 1 + bytes[data + 1] + ((bytes[data + 2] & 0x3f) << 8);
      const height = 1 + (bytes[data + 2] >> 6) + (bytes[data + 3] << 2) +
        ((bytes[data + 4] & 0x0f) << 10);
      dimensions = { width, height, lossless: true };
    } else if (type === "VP8X" && size >= 10) {
      dimensions = {
        width: 1 + bytes.readUIntLE(data + 4, 3),
        height: 1 + bytes.readUIntLE(data + 7, 3),
        lossless: bytes.includes(Buffer.from("VP8L"), data + 10),
      };
    } else if (type === "VP8 " && size >= 10 &&
               bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
      dimensions = {
        width: bytes.readUInt16LE(data + 6) & 0x3fff,
        height: bytes.readUInt16LE(data + 8) & 0x3fff,
        lossless: false,
      };
    }
    offset = end + (size % 2);
  }
  return offset === bytes.length && dimensions?.width && dimensions.height ? dimensions : null;
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function hydrateSnapshot(
  snapshot: Record<string, unknown>,
  assets: Array<{ objectPath: string; kind: string }>,
  revision: number,
): Promise<Record<string, unknown>> {
  const hydrated = structuredClone(snapshot);
  hydrated.cloudRevision = revision;
  const paths = new Set(assets.map(asset => asset.objectPath));
  const urls = new Map<string, string>();
  await Promise.all([...paths].map(async path => {
    urls.set(path, await storage.getObjectEntityDownloadURL(path));
  }));
  const canvas = hydrated.canvas as Record<string, unknown> | undefined;
  const backgroundPath = canvas?.backgroundImageObjectPath ?? canvas?.backgroundImageUri;
  if (canvas && typeof backgroundPath === "string" && urls.has(backgroundPath)) {
    canvas.backgroundImageObjectPath = backgroundPath;
    canvas.backgroundImageUri = urls.get(backgroundPath);
  }
  if (Array.isArray(hydrated.layers)) {
    for (const layer of hydrated.layers as Array<Record<string, unknown>>) {
      const data = layer.data as Record<string, unknown> | undefined;
      const sourcePath = data?.cloudObjectPath ?? data?.uri;
      if (data && typeof sourcePath === "string" && urls.has(sourcePath)) {
        data.cloudObjectPath = sourcePath;
        data.uri = urls.get(sourcePath);
      }
    }
  }
  const thumbnailPath = hydrated.thumbnailObjectPath ?? hydrated.thumbnail;
  if (typeof thumbnailPath === "string" && urls.has(thumbnailPath)) {
    hydrated.thumbnailObjectPath = thumbnailPath;
    hydrated.thumbnail = urls.get(thumbnailPath);
  }
  return hydrated;
}

router.get("/projects", async (req, res) => {
  const owner = ownerId(req);
  const rows = await db.select({
    snapshot: designStudioProjects.snapshot,
    revision: designStudioProjects.revision,
  })
    .from(designStudioProjects)
    .where(eq(designStudioProjects.ownerId, owner))
    .orderBy(desc(designStudioProjects.updatedAt));
  const assets = await db.select({
    objectPath: designStudioAssets.objectPath,
    kind: designStudioAssets.kind,
  }).from(designStudioAssets).where(eq(designStudioAssets.ownerId, owner));
  res.json({ projects: await Promise.all(rows.map(row => hydrateSnapshot(row.snapshot, assets, row.revision))) });
});

router.get("/projects/:projectId", async (req, res) => {
  const [row] = await db.select({
    snapshot: designStudioProjects.snapshot,
    revision: designStudioProjects.revision,
  })
    .from(designStudioProjects).where(and(
      eq(designStudioProjects.id, req.params.projectId),
      eq(designStudioProjects.ownerId, ownerId(req)),
    )).limit(1);
  if (!row) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const assets = await db.select({
    objectPath: designStudioAssets.objectPath,
    kind: designStudioAssets.kind,
  }).from(designStudioAssets).where(and(
    eq(designStudioAssets.projectId, req.params.projectId),
    eq(designStudioAssets.ownerId, ownerId(req)),
  ));
  res.json({ project: await hydrateSnapshot(row.snapshot, assets, row.revision) });
});

router.put("/projects/:projectId", express.json({ limit: MAX_PROJECT_BYTES }), async (req, res) => {
  const projectId = req.params.projectId;
  if (!validProjectSnapshot(req.body, projectId)) {
    res.status(400).json({ error: "Invalid editable Design Studio project" });
    return;
  }
  const serializedBytes = Buffer.byteLength(JSON.stringify(req.body), "utf8");
  if (serializedBytes > MAX_PROJECT_BYTES) {
    res.status(413).json({ error: "Design Studio project is too large" });
    return;
  }
  const owner = ownerId(req);
  const expectedRevisionHeader = req.headers["x-design-revision"];
  const expectedRevision = expectedRevisionHeader == null ? null : Number(expectedRevisionHeader);
  let revision: number | null = null;
  if (expectedRevision == null) {
    const inserted = await db.insert(designStudioProjects).values({
      id: projectId,
      ownerId: owner,
      snapshot: req.body,
      updatedAt: new Date(),
    }).onConflictDoNothing().returning({
      revision: designStudioProjects.revision,
    });
    if (inserted.length === 0) {
      res.status(409).json({ error: "Project revision is required" });
      return;
    }
    revision = inserted[0].revision;
  } else {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      res.status(400).json({ error: "Invalid project revision" });
      return;
    }
    const updated = await db.update(designStudioProjects)
      .set({
        snapshot: req.body,
        updatedAt: new Date(),
        revision: sql`${designStudioProjects.revision} + 1`,
      })
      .where(and(
        eq(designStudioProjects.id, projectId),
        eq(designStudioProjects.ownerId, owner),
        eq(designStudioProjects.revision, expectedRevision),
      )).returning({ id: designStudioProjects.id, revision: designStudioProjects.revision });
    if (updated.length === 0) {
      res.status(409).json({ error: "Project changed on another device" });
      return;
    }
    revision = updated[0].revision;
  }
  res.json({ project: { ...req.body, cloudRevision: revision } });
});

router.delete("/projects/:projectId", async (req, res) => {
  const assets = await db.select({ objectPath: designStudioAssets.objectPath })
    .from(designStudioAssets).where(and(
      eq(designStudioAssets.projectId, req.params.projectId),
      eq(designStudioAssets.ownerId, ownerId(req)),
    ));
  try {
    await Promise.all(assets.map(asset => storage.deleteObjectEntity(asset.objectPath)));
  } catch (error) {
    req.log.error({ err: error, projectId: req.params.projectId }, "Design Studio object cleanup failed");
    res.status(503).json({ error: "Unable to remove all project files. Please retry." });
    return;
  }
  const deleted = await db.delete(designStudioProjects).where(and(
    eq(designStudioProjects.id, req.params.projectId),
    eq(designStudioProjects.ownerId, ownerId(req)),
  )).returning({ id: designStudioProjects.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json({ deleted: true });
});

router.get("/projects/:projectId/assets", async (req, res) => {
  const rows = await db.select().from(designStudioAssets).where(and(
    eq(designStudioAssets.projectId, req.params.projectId),
    eq(designStudioAssets.ownerId, ownerId(req)),
  )).orderBy(desc(designStudioAssets.createdAt));
  const assets = await Promise.all(rows.map(async row => ({
    ...row,
    downloadUrl: await storage.getObjectEntityDownloadURL(row.objectPath),
  })));
  res.json({ assets });
});

router.post(
  "/projects/:projectId/assets/:kind",
  async (req, res) => {
    const kind = req.params.kind;
    if (kind !== "master" && kind !== "thumbnail" && kind !== "source") {
      res.status(400).json({ error: "Asset kind must be master, thumbnail, or source" });
      return;
    }
    const [project] = await db.select({ id: designStudioProjects.id })
      .from(designStudioProjects).where(and(
        eq(designStudioProjects.id, req.params.projectId),
        eq(designStudioProjects.ownerId, ownerId(req)),
      )).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const mimeType = String(req.headers["content-type"] ?? "").split(";")[0];
    const format = String(req.headers["x-design-format"] ?? "");
    const declaredWidth = Number(req.headers["x-design-width"]);
    const declaredHeight = Number(req.headers["x-design-height"]);
    const lossless = req.headers["x-design-lossless"] === "true";
    const qualityHeader = req.headers["x-design-quality"];
    const quality = qualityHeader == null ? null : Number(qualityHeader);
    const png = mimeType === "image/png" ? readPngDimensions(bytes) : null;
    const jpeg = mimeType === "image/jpeg" ? readJpegDimensions(bytes) : null;
    const gif = mimeType === "image/gif" ? readGifDimensions(bytes) : null;
    const webp = mimeType === "image/webp" ? readWebpMetadata(bytes) : null;
    const actual = png ?? jpeg ?? gif ?? webp;
    const expectedLossless = png || gif ? true : webp ? webp.lossless : false;
    const commonMetadataValid = actual &&
      actual.width === declaredWidth && actual.height === declaredHeight &&
      Number.isSafeInteger(declaredWidth) && Number.isSafeInteger(declaredHeight) &&
      ((format === "png" && mimeType === "image/png") ||
       (format === "jpeg" && mimeType === "image/jpeg") ||
       (format === "gif" && mimeType === "image/gif") ||
       (format === "webp" && mimeType === "image/webp")) &&
      lossless === expectedLossless;
    const masterMetadataValid = kind !== "master" ||
      ((format === "png" && lossless && quality === null) ||
       (format === "jpeg" && !lossless && typeof quality === "number" &&
        Number.isInteger(quality) && quality >= 95 && quality <= 100));
    const metadataValid = commonMetadataValid && masterMetadataValid;
    if (!metadataValid) {
      res.status(400).json({ error: "Asset bytes do not match the declared master metadata" });
      return;
    }
    const [projectUsage] = await db.select({
      bytes: sql<number>`coalesce(sum(${designStudioAssets.byteSize}), 0)`,
      count: sql<number>`count(*)`,
    }).from(designStudioAssets).where(and(
      eq(designStudioAssets.projectId, project.id),
      eq(designStudioAssets.ownerId, ownerId(req)),
    ));
    const [ownerUsage] = await db.select({
      bytes: sql<number>`coalesce(sum(${designStudioAssets.byteSize}), 0)`,
    }).from(designStudioAssets).where(eq(designStudioAssets.ownerId, ownerId(req)));
    const sourceRows = kind === "source"
      ? await db.select({ id: designStudioAssets.id }).from(designStudioAssets).where(and(
          eq(designStudioAssets.projectId, project.id),
          eq(designStudioAssets.ownerId, ownerId(req)),
          eq(designStudioAssets.kind, "source"),
        ))
      : [];
    if (kind === "source" && sourceRows.length >= MAX_SOURCE_ASSETS_PER_PROJECT) {
      res.status(409).json({ error: "This project has reached its source asset limit" });
      return;
    }
    if (Number(projectUsage?.bytes ?? 0) + bytes.length > MAX_PROJECT_ASSET_BYTES ||
        Number(ownerUsage?.bytes ?? 0) + bytes.length > MAX_OWNER_ASSET_BYTES) {
      res.status(413).json({ error: "Design Studio cloud storage quota exceeded" });
      return;
    }

    // Store the exact verified request bytes. No decoder, resize, or encoder runs here.
    const objectPath = await storage.createObjectEntityFromBuffer(bytes, mimeType);
    let assetId: string | null = null;
    try {
      const [asset] = await db.insert(designStudioAssets).values({
        projectId: project.id,
        ownerId: ownerId(req),
        kind,
        objectPath,
        width: actual.width,
        height: actual.height,
        mimeType,
        format,
        lossless,
        quality,
        byteSize: bytes.length,
      }).returning();
      assetId = asset.id;
      if (kind === "thumbnail" || kind === "master") {
        const sameKind = await db.select({
          id: designStudioAssets.id,
          objectPath: designStudioAssets.objectPath,
        }).from(designStudioAssets).where(and(
          eq(designStudioAssets.projectId, project.id),
          eq(designStudioAssets.ownerId, ownerId(req)),
          eq(designStudioAssets.kind, kind),
        )).orderBy(desc(designStudioAssets.createdAt));
        const previous = sameKind.filter(row => row.id !== asset.id);
        const superseded = kind === "thumbnail"
          ? previous
          : previous.slice(RETAINED_MASTERS_PER_PROJECT - 1);
        for (const old of superseded) {
          await storage.deleteObjectEntity(old.objectPath);
          await db.delete(designStudioAssets).where(eq(designStudioAssets.id, old.id));
        }
      }
      res.status(201).json({
        asset: {
          ...asset,
          downloadUrl: await storage.getObjectEntityDownloadURL(objectPath),
        },
      });
    } catch (error) {
      if (assetId) await db.delete(designStudioAssets).where(eq(designStudioAssets.id, assetId)).catch(() => {});
      await storage.deleteObjectEntity(objectPath).catch(() => {});
      throw error;
    }
  },
);

export default router;