/**
 * Regression coverage for authenticated team membership discovery.
 *
 * This route must inspect the caller before teamContext rewrites the request
 * to the store owner. Keep both the active-member and no-membership cases
 * behind the same authenticated router mount so a middleware ordering change
 * cannot silently return the wrong store context.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import {
  db,
  designStudioAssets,
  designStudioObjectCleanup,
  designStudioProjects,
  teamMembers,
  users,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

const testState = vi.hoisted(() => ({
  userId: "",
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: testState.userId }),
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = testState.userId;
    next();
  },
}));

const storedDesignBytes = vi.hoisted(() => new Map<string, Buffer>());
const designStorageState = vi.hoisted(() => ({
  failDeletes: false,
  afterWrite: null as null | (() => Promise<void>),
  lastWrittenPath: "",
}));
vi.mock("../../lib/objectStorage", () => ({
  ObjectNotFoundError: class ObjectNotFoundError extends Error {},
  ObjectStorageService: class {
    async createObjectEntityFromBuffer(bytes: Buffer, contentType: string, requestedPath?: string) {
      const path = requestedPath ?? `/design-test/${storedDesignBytes.size}-${contentType.replace("/", "-")}`;
      storedDesignBytes.set(path, Buffer.from(bytes));
      designStorageState.lastWrittenPath = path;
      await designStorageState.afterWrite?.();
      return path;
    }
    async getObjectEntityDownloadURL(path: string) {
      return `https://objects.test${path}`;
    }
    async deleteObjectEntity(path: string) {
      if (designStorageState.failDeletes) throw new Error("storage unavailable");
      storedDesignBytes.delete(path);
    }
  },
}));

import teamRouter from "../team";
import { requireRole, teamContext } from "../../middlewares/requireRole";
import { requireAuth } from "../../middlewares/requireAuth";
import designStudioRouter from "../design-studio";
import { runDesignStudioObjectCleanup } from "../../jobs/designStudioObjectCleanup";
import { DESIGN_STUDIO_ASSET_MIME_TYPES } from "../../lib/designStudioAssetTypes";

const suffix = crypto.randomBytes(4).toString("hex");
const olderOwnerId = `team-membership-older-owner-${suffix}`;
const newerOwnerId = `team-membership-newer-owner-${suffix}`;
const memberId = `team-membership-member-${suffix}`;
const noMembershipUserId = `team-membership-none-${suffix}`;
const equalOwnerAId = `team-membership-equal-a-${suffix}`;
const equalOwnerBId = `team-membership-equal-b-${suffix}`;
const equalMemberId = `team-membership-equal-member-${suffix}`;
const olderOwnerEmail = `${olderOwnerId}@test.local`;
const newerOwnerEmail = `${newerOwnerId}@test.local`;
const equalOwnerAEmail = `${equalOwnerAId}@test.local`;
const equalOwnerBEmail = `${equalOwnerBId}@test.local`;
const olderAcceptedAt = new Date("2026-08-31T12:34:56.000Z");
const newerAcceptedAt = new Date("2026-08-31T13:45:00.000Z");
const equalAcceptedAt = new Date("2026-08-31T14:00:00.000Z");

let server: Server;
let baseUrl = "";
let removedMembershipId = "";

type MembershipResponse = {
  membership: {
    id: string;
    ownerId: string;
    role: string;
    acceptedAt: string;
    ownerName: string;
  } | null;
};

type MembershipsResponse = {
  memberships: NonNullable<MembershipResponse["membership"]>[];
};

type ContextResponse = {
  actingStoreOwner: string;
  actorRole: string;
  teamMembershipId: string | null;
  code?: string;
};

async function getMembership(userId: string) {
  testState.userId = userId;
  const response = await fetch(`${baseUrl}/api/team/my-membership`);
  return {
    status: response.status,
    body: await response.json() as MembershipResponse,
  };
}

async function getMemberships(userId: string) {
  testState.userId = userId;
  const response = await fetch(`${baseUrl}/api/team/my-memberships`);
  return {
    status: response.status,
    body: await response.json() as MembershipsResponse,
  };
}

async function getContext(userId: string, storeContext?: string) {
  testState.userId = userId;
  const response = await fetch(`${baseUrl}/api/team-context`, {
    headers: storeContext ? { "X-Store-Context": storeContext } : undefined,
  });
  return {
    status: response.status,
    body: await response.json() as ContextResponse,
  };
}

async function selectContext(userId: string, storeContext: string) {
  testState.userId = userId;
  const response = await fetch(`${baseUrl}/api/team/context`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storeContext }),
  });
  return {
    status: response.status,
    body: await response.json() as {
      storeContext?: string;
      storeOwnerId?: string;
      teamMembershipId?: string | null;
      role?: string;
      code?: string;
    },
  };
}

async function getOwnerOnly(userId: string, storeContext: string) {
  testState.userId = userId;
  const response = await fetch(`${baseUrl}/api/owner-only`, {
    headers: { "X-Store-Context": storeContext },
  });
  return {
    status: response.status,
    body: await response.json() as { code?: string; currentRole?: string },
  };
}

beforeAll(async () => {
  await db.insert(users).values([
    {
      clerkId: olderOwnerId,
      email: olderOwnerEmail,
      name: "Older store owner fallback name",
      displayName: "Older Store Owner Display Name",
      role: "seller",
      accountType: "seller",
    },
    {
      clerkId: newerOwnerId,
      email: newerOwnerEmail,
      name: "Newest store owner fallback name",
      displayName: "Newest Store Owner Display Name",
      role: "seller",
      accountType: "seller",
    },
    {
      clerkId: equalOwnerAId,
      email: equalOwnerAEmail,
      name: "Equal timestamp owner A fallback name",
      displayName: "Equal Timestamp Store A",
      role: "seller",
      accountType: "seller",
    },
    {
      clerkId: equalOwnerBId,
      email: equalOwnerBEmail,
      name: "Equal timestamp owner B fallback name",
      displayName: "Equal Timestamp Store B",
      role: "seller",
      accountType: "seller",
    },
  ]);

  await db.insert(teamMembers).values({
    ownerId: olderOwnerId,
    memberClerkId: memberId,
    email: `${memberId}@test.local`,
    name: "Joined older team",
    role: "staff",
    status: "active",
    acceptedAt: olderAcceptedAt,
  });

  await db.insert(teamMembers).values({
    ownerId: newerOwnerId,
    memberClerkId: memberId,
    email: `${memberId}@test.local`,
    name: "Joined newest team",
    role: "manager",
    status: "active",
    acceptedAt: newerAcceptedAt,
  });

  await db.insert(teamMembers).values([
    {
      ownerId: equalOwnerBId,
      memberClerkId: equalMemberId,
      email: `${equalMemberId}@test.local`,
      name: "Joined equal timestamp team B",
      role: "staff",
      status: "active",
      acceptedAt: equalAcceptedAt,
    },
    {
      ownerId: equalOwnerAId,
      memberClerkId: equalMemberId,
      email: `${equalMemberId}@test.local`,
      name: "Joined equal timestamp team A",
      role: "manager",
      status: "active",
      acceptedAt: equalAcceptedAt,
    },
  ]);

  await db.insert(teamMembers).values({
    ownerId: olderOwnerId,
    memberClerkId: noMembershipUserId,
    email: `${noMembershipUserId}@test.local`,
    name: "Pending team member",
    role: "staff",
    status: "pending",
  });

  const [removedMembership] = await db.insert(teamMembers).values({
    ownerId: olderOwnerId,
    memberClerkId: memberId,
    email: `${memberId}-removed@test.local`,
    name: "Removed membership",
    role: "manager",
    status: "removed",
    acceptedAt: new Date("2026-08-31T15:00:00.000Z"),
  }).returning({ id: teamMembers.id });
  removedMembershipId = removedMembership!.id;

  const app = express();
  app.use(
    "/api/design-studio/projects/:projectId/assets/:kind",
    express.raw({ type: DESIGN_STUDIO_ASSET_MIME_TYPES, limit: "40mb" }),
  );
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.log = { error: vi.fn() };
    next();
  });
  app.use("/api/team", teamRouter);
  app.use("/api/design-studio", requireAuth, teamContext(), designStudioRouter);
  app.get("/api/team-context", teamContext(), (req, res) => {
    res.json({
      actingStoreOwner: (req as any).clerkUserId,
      actorRole: (req as any).actorRole,
      teamMembershipId: (req as any).teamContext?.teamMembershipId ?? null,
    });
  });
  app.get("/api/owner-only", requireRole("owner"), (_req, res) => {
    res.json({ ok: true });
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(designStudioProjects).where(eq(designStudioProjects.ownerId, olderOwnerId));
  await db.delete(designStudioProjects).where(eq(designStudioProjects.ownerId, newerOwnerId));
  await db.delete(designStudioProjects).where(eq(designStudioProjects.ownerId, memberId));
  await db.delete(teamMembers).where(eq(teamMembers.ownerId, olderOwnerId));
  await db.delete(teamMembers).where(eq(teamMembers.ownerId, newerOwnerId));
  await db.delete(teamMembers).where(eq(teamMembers.ownerId, equalOwnerAId));
  await db.delete(teamMembers).where(eq(teamMembers.ownerId, equalOwnerBId));
  await db.delete(users).where(eq(users.clerkId, olderOwnerId));
  await db.delete(users).where(eq(users.clerkId, newerOwnerId));
  await db.delete(users).where(eq(users.clerkId, equalOwnerAId));
  await db.delete(users).where(eq(users.clerkId, equalOwnerBId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("authenticated team membership discovery", () => {
  it("returns the newest active membership with its matching store details", async () => {
    const result = await getMembership(memberId);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      membership: {
        id: expect.any(String),
        ownerId: newerOwnerId,
        role: "manager",
        acceptedAt: newerAcceptedAt.toISOString(),
        ownerName: "Newest Store Owner Display Name",
      },
    });
  });

  it("resolves the same owner and role across discovery and request context for equal timestamps", async () => {
    const membershipResult = await getMembership(equalMemberId);
    const contextResult = await getContext(equalMemberId);
    const membership = membershipResult.body.membership;

    expect(membershipResult.status).toBe(200);
    expect(contextResult.status).toBe(200);
    expect(membership).not.toBeNull();
    expect(membership).toMatchObject({
      ownerId: equalOwnerAId,
      role: "manager",
      acceptedAt: equalAcceptedAt.toISOString(),
      ownerName: "Equal Timestamp Store A",
    });
    expect(contextResult.body).toEqual({
      actingStoreOwner: membership!.ownerId,
      actorRole: membership!.role,
      teamMembershipId: membership!.id,
    });
  });

  it("returns every active store membership in deterministic order", async () => {
    const result = await getMemberships(memberId);

    expect(result.status).toBe(200);
    expect(result.body.memberships).toHaveLength(2);
    expect(result.body.memberships.map((membership) => membership.ownerId)).toEqual([
      newerOwnerId,
      olderOwnerId,
    ]);
  });

  it("uses an explicitly selected active membership instead of the newest one", async () => {
    const membershipResult = await getMemberships(memberId);
    const olderMembership = membershipResult.body.memberships.find(
      (membership) => membership.ownerId === olderOwnerId,
    );
    expect(olderMembership).toBeDefined();

    const contextResult = await getContext(memberId, olderMembership!.id);

    expect(contextResult.status).toBe(200);
    expect(contextResult.body).toEqual({
      actingStoreOwner: olderOwnerId,
      actorRole: "staff",
      teamMembershipId: olderMembership!.id,
    });
  });

  it("keeps Design Studio CRUD in the explicitly selected store owner's namespace", async () => {
    const memberships = await getMemberships(memberId);
    const selected = memberships.body.memberships.find(
      (membership) => membership.ownerId === olderOwnerId,
    )!;
    const projectId = crypto.randomUUID();
    testState.userId = memberId;
    const saved = await fetch(`${baseUrl}/api/design-studio/projects/${projectId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Store-Context": selected.id,
      },
      body: JSON.stringify({
        id: projectId,
        name: "Joined store design",
        type: "canvas",
        status: "saved",
        canvas: { width: 1080, height: 1080, backgroundHex: "#000000" },
        layers: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    });
    expect(saved.status).toBe(200);

    const [stored] = await db.select({
      ownerId: designStudioProjects.ownerId,
    }).from(designStudioProjects).where(eq(designStudioProjects.id, projectId));
    expect(stored?.ownerId).toBe(olderOwnerId);

    const joined = await fetch(`${baseUrl}/api/design-studio/projects`, {
      headers: { "X-Store-Context": selected.id },
    });
    expect(joined.status).toBe(200);
    expect((await joined.json() as { projects: Array<{ id: string }> }).projects)
      .toContainEqual(expect.objectContaining({ id: projectId }));

    const own = await fetch(`${baseUrl}/api/design-studio/projects`, {
      headers: { "X-Store-Context": "own" },
    });
    expect(own.status).toBe(200);
    expect((await own.json() as { projects: Array<{ id: string }> }).projects)
      .not.toContainEqual(expect.objectContaining({ id: projectId }));
  });

  it("parses and stores exact PNG, JPEG, GIF, and WebP source bytes through HTTP", async () => {
    const memberships = await getMemberships(memberId);
    const selected = memberships.body.memberships.find(
      (membership) => membership.ownerId === olderOwnerId,
    )!;
    const projectId = crypto.randomUUID();
    const now = new Date().toISOString();
    testState.userId = memberId;
    const created = await fetch(`${baseUrl}/api/design-studio/projects/${projectId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Store-Context": selected.id,
      },
      body: JSON.stringify({
        id: projectId,
        name: "All source formats",
        type: "canvas",
        status: "saved",
        canvas: { width: 1, height: 1, backgroundHex: "#000000" },
        layers: [],
        createdAt: now,
        updatedAt: now,
      }),
    });
    expect(created.status).toBe(200);

    const jpeg = Buffer.from([
      0xff, 0xd8,
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01,
      0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
      0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
      0x00, 0xff, 0xd9,
    ]);
    const webp = Buffer.alloc(26);
    webp.write("RIFF", 0, "ascii");
    webp.writeUInt32LE(18, 4);
    webp.write("WEBPVP8L", 8, "ascii");
    webp.writeUInt32LE(5, 16);
    Buffer.from([0x2f, 0x00, 0x00, 0x00, 0x00]).copy(webp, 20);
    const formats = [
      {
        mime: "image/png",
        format: "png",
        lossless: true,
        bytes: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ),
      },
      { mime: "image/jpeg", format: "jpeg", lossless: false, bytes: jpeg },
      {
        mime: "image/gif",
        format: "gif",
        lossless: true,
        bytes: Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"),
      },
      { mime: "image/webp", format: "webp", lossless: true, bytes: webp },
    ];

    for (const source of formats) {
      const response = await fetch(
        `${baseUrl}/api/design-studio/projects/${projectId}/assets/source`,
        {
          method: "POST",
          headers: {
            "Content-Type": source.mime,
            "X-Store-Context": selected.id,
            "X-Design-Width": "1",
            "X-Design-Height": "1",
            "X-Design-Format": source.format,
            "X-Design-Lossless": String(source.lossless),
          },
          body: source.bytes,
        },
      );
      expect(response.status).toBe(201);
      const body = await response.json() as { asset: { objectPath: string } };
      expect(storedDesignBytes.get(body.asset.objectPath)).toEqual(source.bytes);
    }

    const stored = await db.select().from(designStudioAssets).where(and(
      eq(designStudioAssets.projectId, projectId),
      eq(designStudioAssets.ownerId, olderOwnerId),
    ));
    expect(stored.map(asset => [asset.mimeType, asset.format, asset.lossless]))
      .toEqual(formats.map(source => [source.mime, source.format, source.lossless]));

    const deleted = await fetch(`${baseUrl}/api/design-studio/projects/${projectId}`, {
      method: "DELETE",
      headers: { "X-Store-Context": selected.id },
    });
    expect(deleted.status).toBe(200);
    for (const asset of stored) expect(storedDesignBytes.has(asset.objectPath)).toBe(false);
    expect(await db.select().from(designStudioAssets).where(eq(designStudioAssets.projectId, projectId)))
      .toHaveLength(0);
  });

  it("durably retries superseded thumbnail cleanup without leaving a broken asset reference", async () => {
    const projectId = `design-cleanup-replace-${crypto.randomUUID()}`;
    await db.insert(designStudioProjects).values({
      id: projectId,
      ownerId: olderOwnerId,
      snapshot: { id: projectId, name: "Replace", canvas: { width: 1, height: 1 }, layers: [] },
    });
    const memberships = await getMemberships(memberId);
    const selected = memberships.body.memberships.find(m => m.ownerId === olderOwnerId)!;
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const upload = () => fetch(`${baseUrl}/api/design-studio/projects/${projectId}/assets/thumbnail`, {
      method: "POST",
      headers: {
        "Content-Type": "image/png",
        "X-Store-Context": selected.id,
        "X-Design-Width": "1",
        "X-Design-Height": "1",
        "X-Design-Format": "png",
        "X-Design-Lossless": "true",
      },
      body: png,
    });

    const first = await upload();
    const firstPath = ((await first.json()) as { asset: { objectPath: string } }).asset.objectPath;
    designStorageState.failDeletes = true;
    expect((await upload()).status).toBe(201);

    expect(await db.select().from(designStudioAssets)
      .where(eq(designStudioAssets.objectPath, firstPath))).toHaveLength(0);
    expect(await db.select().from(designStudioObjectCleanup)
      .where(eq(designStudioObjectCleanup.objectPath, firstPath))).toHaveLength(1);
    expect(storedDesignBytes.has(firstPath)).toBe(true);

    designStorageState.failDeletes = false;
    await runDesignStudioObjectCleanup(new Date(Date.now() + 2 * 60 * 1000));
    expect(storedDesignBytes.has(firstPath)).toBe(false);
    expect(await db.select().from(designStudioObjectCleanup)
      .where(eq(designStudioObjectCleanup.objectPath, firstPath))).toHaveLength(0);
    await db.delete(designStudioProjects).where(eq(designStudioProjects.id, projectId));
  });

  it("keeps durable cleanup intent when an upload cannot commit its asset row", async () => {
    const projectId = `design-cleanup-rollback-${crypto.randomUUID()}`;
    await db.insert(designStudioProjects).values({
      id: projectId,
      ownerId: olderOwnerId,
      snapshot: { id: projectId, name: "Rollback", canvas: { width: 1, height: 1 }, layers: [] },
    });
    const memberships = await getMemberships(memberId);
    const selected = memberships.body.memberships.find(m => m.ownerId === olderOwnerId)!;
    designStorageState.failDeletes = true;
    designStorageState.afterWrite = async () => {
      await db.delete(designStudioProjects).where(eq(designStudioProjects.id, projectId));
      designStorageState.afterWrite = null;
    };
    const response = await fetch(`${baseUrl}/api/design-studio/projects/${projectId}/assets/source`, {
      method: "POST",
      headers: {
        "Content-Type": "image/png",
        "X-Store-Context": selected.id,
        "X-Design-Width": "1",
        "X-Design-Height": "1",
        "X-Design-Format": "png",
        "X-Design-Lossless": "true",
      },
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    expect(response.status).toBe(500);
    const orphanPath = designStorageState.lastWrittenPath;
    expect(await db.select().from(designStudioObjectCleanup)
      .where(eq(designStudioObjectCleanup.objectPath, orphanPath))).toHaveLength(1);
    expect(storedDesignBytes.has(orphanPath)).toBe(true);

    designStorageState.failDeletes = false;
    await runDesignStudioObjectCleanup(new Date(Date.now() + 2 * 60 * 1000));
    expect(storedDesignBytes.has(orphanPath)).toBe(false);
    expect(await db.select().from(designStudioObjectCleanup)
      .where(eq(designStudioObjectCleanup.objectPath, orphanPath))).toHaveLength(0);
  });

  it("reclaims an upload paused in storage while its project is permanently deleted", async () => {
    const projectId = `design-cleanup-race-${crypto.randomUUID()}`;
    await db.insert(designStudioProjects).values({
      id: projectId,
      ownerId: olderOwnerId,
      snapshot: { id: projectId, name: "Race", canvas: { width: 1, height: 1 }, layers: [] },
    });
    const memberships = await getMemberships(memberId);
    const selected = memberships.body.memberships.find(m => m.ownerId === olderOwnerId)!;
    let signalWritten!: () => void;
    let releaseUpload!: () => void;
    const written = new Promise<void>(resolve => { signalWritten = resolve; });
    const release = new Promise<void>(resolve => { releaseUpload = resolve; });
    designStorageState.afterWrite = async () => {
      signalWritten();
      await release;
      designStorageState.afterWrite = null;
    };

    const uploadPromise = fetch(`${baseUrl}/api/design-studio/projects/${projectId}/assets/source`, {
      method: "POST",
      headers: {
        "Content-Type": "image/png",
        "X-Store-Context": selected.id,
        "X-Design-Width": "1",
        "X-Design-Height": "1",
        "X-Design-Format": "png",
        "X-Design-Lossless": "true",
      },
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await written;
    const uploadedPath = designStorageState.lastWrittenPath;
    const deletePromise = fetch(`${baseUrl}/api/design-studio/projects/${projectId}`, {
      method: "DELETE",
      headers: { "X-Store-Context": selected.id },
    });
    await new Promise(resolve => setTimeout(resolve, 50));
    releaseUpload();

    expect((await deletePromise).status).toBe(200);
    expect((await uploadPromise).status).toBe(500);
    expect(storedDesignBytes.has(uploadedPath)).toBe(false);
    expect(await db.select().from(designStudioAssets)
      .where(eq(designStudioAssets.projectId, projectId))).toHaveLength(0);
    expect(await db.select().from(designStudioObjectCleanup)
      .where(eq(designStudioObjectCleanup.objectPath, uploadedPath))).toHaveLength(0);
  });

  it("rejects a membership that belongs to a different caller", async () => {
    const otherMemberships = await getMemberships(equalMemberId);
    const otherMembershipId = otherMemberships.body.memberships[0]!.id;

    const contextResult = await getContext(memberId, otherMembershipId);

    expect(contextResult.status).toBe(403);
    expect(contextResult.body.code).toBe("STORE_CONTEXT_NOT_ALLOWED");
  });

  it("validates and returns an explicit selection through the team API", async () => {
    const memberships = await getMemberships(memberId);
    const selected = memberships.body.memberships.find(
      (membership) => membership.ownerId === olderOwnerId,
    )!;

    const result = await selectContext(memberId, selected.id);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      storeContext: selected.id,
      storeOwnerId: olderOwnerId,
      teamMembershipId: selected.id,
      role: "staff",
    });
  });

  it("rejects a selected membership after access has been removed", async () => {
    const result = await selectContext(memberId, removedMembershipId);

    expect(result.status).toBe(403);
    expect(result.body.code).toBe("STORE_CONTEXT_NOT_ALLOWED");
  });

  it("preserves role boundaries in an explicitly selected store", async () => {
    const memberships = await getMemberships(memberId);
    const managerMembership = memberships.body.memberships.find(
      (membership) => membership.ownerId === newerOwnerId,
    )!;

    const result = await getOwnerOnly(memberId, managerMembership.id);

    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({
      code: "ROLE_REQUIRED",
      currentRole: "manager",
    });
  });

  it("returns a null membership for an authenticated user without an active membership", async () => {
    const result = await getMembership(noMembershipUserId);

    expect(result.status).toBe(200);
    expect(result.status).not.toBe(500);
    expect(result.body).toEqual({ membership: null });
  });
});