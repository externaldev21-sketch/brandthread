import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, dropBroadcasts, drops } from "@workspace/db";
import { eq } from "drizzle-orm";

const TEST_OWNER = `test-scheduled-drop-${crypto.randomBytes(4).toString("hex")}`;
const launchAt = new Date(Date.now() + 10 * 60 * 1000);
const testDropIds: string[] = [];
let dropId = "";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = TEST_OWNER;
    next();
  },
}));

let server: Server;
let base: string;

async function patchDrop(body: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(`${base}/api/drops/${dropId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  const [drop] = await db.insert(drops).values({
    ownerId: TEST_OWNER,
    name: "Scheduled Broadcast Test",
    type: "pre-order",
    status: "active",
    releaseAt: launchAt,
  }).returning({ id: drops.id });
  dropId = drop.id;
  testDropIds.push(drop.id);

  const { default: dropsRouter } = await import("../drops");
  const app = express();
  app.use(express.json());
  app.use("/api/drops", dropsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  for (const id of testDropIds) {
    await db.delete(dropBroadcasts).where(eq(dropBroadcasts.dropId, id));
    await db.delete(drops).where(eq(drops.id, id));
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("scheduled drop broadcasts", () => {
  it("only schedules the notification for the drop launch time", async () => {
    const inactive = await patchDrop({
      status: "closed",
      scheduledBroadcastAt: launchAt.toISOString(),
    });
    expect(inactive.status).toBe(400);
    expect(inactive.body.code).toBe("DROP_NOT_ACTIVE");

    const wrongTime = new Date(launchAt.getTime() + 60_000).toISOString();
    const rejected = await patchDrop({ scheduledBroadcastAt: wrongTime });
    expect(rejected.status).toBe(400);
    expect(rejected.body.code).toBe("SCHEDULE_MUST_MATCH_RELEASE");

    const scheduled = await patchDrop({ scheduledBroadcastAt: launchAt.toISOString() });
    expect(scheduled.status).toBe(200);
    expect(new Date(scheduled.body.scheduledBroadcastAt).getTime()).toBe(launchAt.getTime());
  });

  it("fires once when launch arrives, even when the worker runs again", async () => {
    const { runScheduledDropBroadcasts } = await import("../../jobs/scheduledDropBroadcasts");
    const afterLaunch = new Date(launchAt.getTime() + 1_000);

    await runScheduledDropBroadcasts(afterLaunch);
    await runScheduledDropBroadcasts(afterLaunch);

    const broadcasts = await db.select({ id: dropBroadcasts.id })
      .from(dropBroadcasts)
      .where(eq(dropBroadcasts.dropId, dropId));
    expect(broadcasts).toHaveLength(1);

    const [deliveredDrop] = await db.select({
      scheduledBroadcastAt: drops.scheduledBroadcastAt,
    }).from(drops).where(eq(drops.id, dropId)).limit(1);
    expect(deliveredDrop.scheduledBroadcastAt).toBeNull();
  });

  it("rechecks active status at the claim boundary", async () => {
    const dueAt = new Date(Date.now() - 1_000);
    const [closedDrop] = await db.insert(drops).values({
      ownerId: TEST_OWNER,
      name: "Closed Scheduled Drop",
      type: "pre-order",
      status: "closed",
      releaseAt: dueAt,
      scheduledBroadcastAt: dueAt,
    }).returning({ id: drops.id });
    testDropIds.push(closedDrop.id);

    const { deliverDropBroadcast } = await import("../../lib/dropBroadcast");
    const result = await deliverDropBroadcast(closedDrop.id, TEST_OWNER, {
      scheduledNow: new Date(),
    });
    expect(result).toBeNull();

    const claims = await db.select({ id: dropBroadcasts.id })
      .from(dropBroadcasts)
      .where(eq(dropBroadcasts.dropId, closedDrop.id));
    expect(claims).toHaveLength(0);
  });

  it("lets only one manual or scheduled sender win a concurrent claim", async () => {
    const dueAt = new Date(Date.now() - 1_000);
    const [raceDrop] = await db.insert(drops).values({
      ownerId: TEST_OWNER,
      name: "Broadcast Race Drop",
      type: "pre-order",
      status: "active",
      releaseAt: dueAt,
      scheduledBroadcastAt: dueAt,
    }).returning({ id: drops.id });
    testDropIds.push(raceDrop.id);

    const { deliverDropBroadcast } = await import("../../lib/dropBroadcast");
    const results = await Promise.all([
      deliverDropBroadcast(raceDrop.id, TEST_OWNER),
      deliverDropBroadcast(raceDrop.id, TEST_OWNER, { scheduledNow: new Date() }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);

    const claims = await db.select({ id: dropBroadcasts.id })
      .from(dropBroadcasts)
      .where(eq(dropBroadcasts.dropId, raceDrop.id));
    expect(claims).toHaveLength(1);
  });
});