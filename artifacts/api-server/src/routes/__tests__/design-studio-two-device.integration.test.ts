import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { and, eq } from "drizzle-orm";
import { db, designStudioAssets, designStudioProjects } from "@workspace/db";

const storedObjects = vi.hoisted(() => new Map<string, { bytes: Buffer; contentType: string }>());

vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async createObjectEntityFromBuffer(bytes: Buffer, contentType: string) {
      const path = `/private/design-studio/${crypto.randomUUID()}`;
      storedObjects.set(path, { bytes: Buffer.from(bytes), contentType });
      return path;
    }

    async getObjectEntityDownloadURL(path: string) {
      return `/private-objects?path=${encodeURIComponent(path)}`;
    }

    async deleteObjectEntity(path: string) {
      storedObjects.delete(path);
    }
  },
}));

import designStudioRouter from "../design-studio";
import { DESIGN_STUDIO_ASSET_MIME_TYPES } from "../../lib/designStudioAssetTypes";

const ownerId = `design-two-device-${crypto.randomBytes(5).toString("hex")}`;
const clientTokens = new Set(["device-a-token", "device-b-token"]);
const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

let server: Server;
let baseUrl = "";
let releasePausedSave: (() => void) | null = null;
let markPausedSaveStarted: (() => void) | null = null;

type Project = {
  id: string;
  name: string;
  type: "canvas";
  status: "saved";
  canvas: {
    width: number;
    height: number;
    backgroundHex: string;
  };
  layers: Array<Record<string, unknown>>;
  thumbnail?: string;
  thumbnailObjectPath?: string;
  createdAt: string;
  updatedAt: string;
  cloudRevision?: number;
};

function authHeaders(token: string, extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}

async function readJson<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

async function putProject(token: string, project: Project, revision?: number, pause = false) {
  return fetch(`${baseUrl}/api/design-studio/projects/${project.id}`, {
    method: "PUT",
    headers: authHeaders(token, {
      "Content-Type": "application/json",
      ...(revision == null ? {} : { "X-Design-Revision": String(revision) }),
      ...(pause ? { "X-Test-Pause-Save": "true" } : {}),
    }),
    body: JSON.stringify(project),
  });
}

async function uploadAsset(
  token: string,
  projectId: string,
  kind: "source" | "thumbnail" | "master",
) {
  return fetch(`${baseUrl}/api/design-studio/projects/${projectId}/assets/${kind}`, {
    method: "POST",
    headers: authHeaders(token, {
      "Content-Type": "image/png",
      "X-Design-Width": "1",
      "X-Design-Height": "1",
      "X-Design-Format": "png",
      "X-Design-Lossless": "true",
    }),
    body: pngBytes,
  });
}

beforeAll(async () => {
  const app = express();
  app.use(
    "/api/design-studio/projects/:projectId/assets/:kind",
    express.raw({ type: DESIGN_STUDIO_ASSET_MIME_TYPES, limit: "40mb" }),
  );
  app.use(express.json());
  app.use((req: any, res, next) => {
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    if (!token || !clientTokens.has(token)) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    req.clerkUserId = ownerId;
    req.log = { error: vi.fn() };
    next();
  });
  app.use(async (req, _res, next) => {
    if (req.headers["x-test-pause-save"] === "true") {
      markPausedSaveStarted?.();
      await new Promise<void>(resolve => {
        releasePausedSave = resolve;
      });
    }
    next();
  });
  app.get("/private-objects", (req, res) => {
    const object = storedObjects.get(String(req.query.path ?? ""));
    if (!object) {
      res.status(404).end();
      return;
    }
    res.type(object.contentType).send(object.bytes);
  });
  app.use("/api/design-studio", designStudioRouter);

  await new Promise<void>(resolve => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  releasePausedSave?.();
  const projects = await db.select({ id: designStudioProjects.id })
    .from(designStudioProjects)
    .where(eq(designStudioProjects.ownerId, ownerId));
  for (const project of projects) {
    await db.delete(designStudioProjects).where(and(
      eq(designStudioProjects.id, project.id),
      eq(designStudioProjects.ownerId, ownerId),
    ));
  }
  storedObjects.clear();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe("Design Studio authenticated two-device sync", () => {
  it("preserves editable conflicts, private assets, exact masters, and permanent deletes", async () => {
    const now = new Date().toISOString();
    const projectId = crypto.randomUUID();
    const original: Project = {
      id: projectId,
      name: "Shared campaign",
      type: "canvas",
      status: "saved",
      canvas: { width: 1, height: 1, backgroundHex: "#000000" },
      layers: [],
      createdAt: now,
      updatedAt: now,
    };

    const createdResponse = await putProject("device-a-token", original);
    expect(createdResponse.status).toBe(200);
    const created = (await readJson<{ project: Project }>(createdResponse)).project;
    expect(created.cloudRevision).toBe(1);

    const sourceResponse = await uploadAsset("device-a-token", projectId, "source");
    const thumbnailResponse = await uploadAsset("device-a-token", projectId, "thumbnail");
    const masterResponse = await uploadAsset("device-a-token", projectId, "master");
    expect([sourceResponse.status, thumbnailResponse.status, masterResponse.status])
      .toEqual([201, 201, 201]);

    const source = (await readJson<{ asset: { objectPath: string } }>(sourceResponse)).asset;
    const thumbnail = (await readJson<{ asset: { objectPath: string } }>(thumbnailResponse)).asset;
    const master = (await readJson<{
      asset: {
        objectPath: string;
        downloadUrl: string;
        width: number;
        height: number;
        mimeType: string;
        format: string;
        lossless: boolean;
        quality: number | null;
        byteSize: number;
      };
    }>(masterResponse)).asset;

    const deviceAEdit: Project = {
      ...created,
      name: "Device A edit",
      thumbnail: thumbnail.objectPath,
      thumbnailObjectPath: thumbnail.objectPath,
      layers: [{
        id: "layer-a",
        name: "Editable source layer",
        type: "image",
        visible: true,
        locked: false,
        order: 0,
        opacity: 1,
        transform: { x: 0, y: 0, width: 1, height: 1, rotation: 0, scaleX: 1, scaleY: 1 },
        data: { kind: "image", uri: source.objectPath, cloudObjectPath: source.objectPath },
        createdAt: now,
        updatedAt: now,
      }],
      updatedAt: new Date().toISOString(),
    };
    const deviceBEdit: Project = {
      ...created,
      name: "Device B offline edit",
      layers: [{
        id: "layer-b",
        name: "Device B text",
        type: "text",
        visible: true,
        locked: false,
        order: 0,
        opacity: 1,
        transform: { x: 0, y: 0, width: 1, height: 1, rotation: 0, scaleX: 1, scaleY: 1 },
        data: { kind: "text", text: "Keep both", textColor: "#ffffff" },
        createdAt: now,
        updatedAt: now,
      }],
      updatedAt: new Date().toISOString(),
    };

    const deviceASavedResponse = await putProject("device-a-token", deviceAEdit, 1);
    expect(deviceASavedResponse.status).toBe(200);
    const deviceASaved = (await readJson<{ project: Project }>(deviceASavedResponse)).project;
    expect(deviceASaved.cloudRevision).toBe(2);

    const staleDeviceBResponse = await putProject("device-b-token", deviceBEdit, 1);
    expect(staleDeviceBResponse.status).toBe(409);

    const cloudResponse = await fetch(
      `${baseUrl}/api/design-studio/projects/${projectId}`,
      { headers: authHeaders("device-b-token") },
    );
    const cloud = (await readJson<{ project: Project }>(cloudResponse)).project;
    expect(cloud).toMatchObject({
      name: "Device A edit",
      cloudRevision: 2,
      thumbnailObjectPath: thumbnail.objectPath,
      layers: [{ id: "layer-a", data: { cloudObjectPath: source.objectPath } }],
    });
    expect(cloud.thumbnail).toContain("/private-objects?");
    expect((cloud.layers[0]!.data as Record<string, unknown>).uri).toContain("/private-objects?");

    const conflictCopy: Project = {
      ...deviceBEdit,
      id: crypto.randomUUID(),
      name: `${deviceBEdit.name} (conflict copy)`,
      cloudRevision: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const conflictResponse = await putProject("device-b-token", conflictCopy);
    expect(conflictResponse.status).toBe(200);

    const listResponse = await fetch(`${baseUrl}/api/design-studio/projects`, {
      headers: authHeaders("device-a-token"),
    });
    const projects = (await readJson<{ projects: Project[] }>(listResponse)).projects;
    expect(projects).toHaveLength(2);
    expect(projects).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: projectId, name: "Device A edit", layers: [expect.objectContaining({ id: "layer-a" })] }),
      expect.objectContaining({ id: conflictCopy.id, name: "Device B offline edit (conflict copy)", layers: [expect.objectContaining({ id: "layer-b" })] }),
    ]));

    const assetsResponse = await fetch(
      `${baseUrl}/api/design-studio/projects/${projectId}/assets`,
      { headers: authHeaders("device-b-token") },
    );
    const assets = (await readJson<{ assets: Array<typeof master & { kind: string }> }>(assetsResponse)).assets;
    expect(assets.map(asset => asset.kind).sort()).toEqual(["master", "source", "thumbnail"]);
    expect(assets.find(asset => asset.kind === "master")).toMatchObject({
      objectPath: master.objectPath,
      width: 1,
      height: 1,
      mimeType: "image/png",
      format: "png",
      lossless: true,
      quality: null,
      byteSize: pngBytes.length,
    });
    const downloadedMaster = await fetch(`${baseUrl}${master.downloadUrl}`, {
      headers: authHeaders("device-b-token"),
    });
    expect(downloadedMaster.status).toBe(200);
    expect(Buffer.from(await downloadedMaster.arrayBuffer())).toEqual(pngBytes);

    let pausedSaveStarted!: () => void;
    const saveStarted = new Promise<void>(resolve => {
      pausedSaveStarted = resolve;
    });
    markPausedSaveStarted = pausedSaveStarted;
    const staleInFlightSave = putProject(
      "device-b-token",
      { ...cloud, name: "Must never return", updatedAt: new Date().toISOString() },
      2,
      true,
    );
    await saveStarted;

    const deletedResponse = await fetch(
      `${baseUrl}/api/design-studio/projects/${projectId}`,
      { method: "DELETE", headers: authHeaders("device-a-token") },
    );
    expect(deletedResponse.status).toBe(200);
    releasePausedSave?.();
    expect((await staleInFlightSave).status).toBe(409);

    const deletedProject = await fetch(
      `${baseUrl}/api/design-studio/projects/${projectId}`,
      { headers: authHeaders("device-b-token") },
    );
    expect(deletedProject.status).toBe(404);
    expect(await db.select().from(designStudioAssets).where(eq(designStudioAssets.projectId, projectId)))
      .toHaveLength(0);
    expect(storedObjects.has(source.objectPath)).toBe(false);
    expect(storedObjects.has(thumbnail.objectPath)).toBe(false);
    expect(storedObjects.has(master.objectPath)).toBe(false);
  });
});