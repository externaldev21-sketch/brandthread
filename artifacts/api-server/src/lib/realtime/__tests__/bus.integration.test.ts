/**
 * Real backends: two buses in one process over the test Postgres
 * (LISTEN/NOTIFY) and over a local Redis (skipped when none is reachable on
 * REALTIME_TEST_REDIS_URL, default redis://127.0.0.1:6390).
 */
import { afterAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { PG_NOTIFY_MAX_BYTES, PostgresBus, RedisBus, type RealtimeBus } from "../bus";
import { createRoomPresence, postgresPresenceStore } from "../presence";

const url = process.env.DATABASE_URL!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, ms = 3_000) {
  const until = Date.now() + ms;
  while (!pred() && Date.now() < until) await sleep(20);
}

const open: RealtimeBus[] = [];
afterAll(async () => {
  await Promise.all(open.map((b) => b.close()));
  await db.execute(sql`DELETE FROM realtime_presence WHERE scope LIKE 'bt-test-%'`);
});

function pgBus(id: string, channel: string) {
  const bus = new PostgresBus({ listenUrl: url, pool: () => pool, instanceId: id, channel });
  open.push(bus);
  return bus;
}

describe("PostgresBus", () => {
  const channel = `bt_rt_test_${process.pid}`;

  it("delivers a message from A to B exactly once, and not back to A", async () => {
    const a = pgBus("pg-a", channel);
    const b = pgBus("pg-b", channel);
    const gotA: unknown[] = [];
    const gotB: unknown[] = [];
    a.subscribe((_t, d) => gotA.push(d));
    b.subscribe((_t, d) => gotB.push(d));
    await Promise.all([a.ready(), b.ready()]);
    a.publish("live", { type: "comment", n: 1 });
    a.publish("live", { type: "comment", n: 2 });
    await waitFor(() => gotB.length >= 2);
    await sleep(200);
    expect(gotB).toEqual([{ type: "comment", n: 1 }, { type: "comment", n: 2 }]);
    expect(gotA).toEqual([]);
    expect(a.status()).toBe("ok");
  });

  it("sends payloads over the NOTIFY limit by id", async () => {
    const a = pgBus("pg-big-a", `${channel}_big`);
    const b = pgBus("pg-big-b", `${channel}_big`);
    const gotB: Array<{ text: string }> = [];
    b.subscribe((_t, d) => gotB.push(d as { text: string }));
    await b.ready();
    const text = "x".repeat(PG_NOTIFY_MAX_BYTES * 2);
    a.publish("community", { text });
    await waitFor(() => gotB.length >= 1);
    expect(gotB).toHaveLength(1);
    expect(gotB[0].text).toBe(text);
  });
});

const redisUrl = process.env.REALTIME_TEST_REDIS_URL ?? "redis://127.0.0.1:6390";
const redisUp = await (async () => {
  const probe = new Redis(redisUrl, { lazyConnect: true, connectTimeout: 500, maxRetriesPerRequest: 0, retryStrategy: () => null });
  try { await probe.connect(); await probe.ping(); return true; } catch { return false; } finally { probe.disconnect(); }
})();

describe.skipIf(!redisUp)("RedisBus", () => {
  it("delivers a message from A to B exactly once, and not back to A", async () => {
    const publisher = new Redis(redisUrl);
    const channel = `bt:rt:test:${process.pid}`;
    const a = new RedisBus({ url: redisUrl, publisher: () => publisher, instanceId: "r-a", channel });
    const b = new RedisBus({ url: redisUrl, publisher: () => publisher, instanceId: "r-b", channel });
    open.push(a, b);
    const gotA: unknown[] = [];
    const gotB: unknown[] = [];
    a.subscribe((_t, d) => gotA.push(d));
    b.subscribe((_t, d) => gotB.push(d));
    await Promise.all([a.ready(), b.ready()]);
    a.publish("live", { type: "tip", amount: 5 });
    await waitFor(() => gotB.length >= 1);
    await sleep(200);
    expect(gotB).toEqual([{ type: "tip", amount: 5 }]);
    expect(gotA).toEqual([]);
    publisher.disconnect();
  });
});

describe("Postgres presence", () => {
  it("sees a user connected on another instance until they leave", async () => {
    const scope = `bt-test-${process.pid}`;
    const a = createRoomPresence({ scope, instanceId: "inst-a", store: postgresPresenceStore, heartbeatMs: 60_000 });
    const b = createRoomPresence({ scope, instanceId: "inst-b", store: postgresPresenceStore, heartbeatMs: 60_000 });
    a.join("room-1", "user-1");
    a.join("room-1", "user-1"); // second socket, same user
    await a.heartbeat();
    expect([...(await b.members("room-1"))]).toEqual(["user-1"]);
    expect(b.localMembers("room-1").size).toBe(0);

    a.leave("room-1", "user-1"); // one socket still open
    await sleep(50);
    expect([...(await b.members("room-1"))]).toEqual(["user-1"]);

    a.leave("room-1", "user-1");
    await waitFor(() => false, 100);
    expect((await b.members("room-1")).size).toBe(0);
    a.stop();
    b.stop();
  });

  it("ignores rows past their TTL (a crashed instance)", async () => {
    const scope = `bt-test-ttl-${process.pid}`;
    await postgresPresenceStore.upsert(scope, [{ room: "r", userId: "ghost" }], "dead-instance", 1);
    await sleep(20);
    expect((await postgresPresenceStore.members(scope, "r")).size).toBe(0);
  });
});
