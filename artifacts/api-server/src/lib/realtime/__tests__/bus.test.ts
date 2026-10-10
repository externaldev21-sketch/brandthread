import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { InProcessBus, resolveBusBackend, resolveListenUrl } from "../bus";
import { createRoomFanout } from "../fanout";

const tick = () => new Promise((r) => setTimeout(r, 10));

describe("resolveBusBackend", () => {
  it("prefers Redis, then Postgres, then in-process", () => {
    expect(resolveBusBackend({ REDIS_URL: "redis://x", DATABASE_URL: "postgres://y" })).toBe("redis");
    expect(resolveBusBackend({ DATABASE_URL: "postgres://y" })).toBe("postgres");
    expect(resolveBusBackend({})).toBe("inprocess");
  });

  it("stays in process under test unless asked", () => {
    expect(resolveBusBackend({ DATABASE_URL: "postgres://y", NODE_ENV: "test" })).toBe("inprocess");
    expect(resolveBusBackend({ DATABASE_URL: "postgres://y", NODE_ENV: "test", REALTIME_BUS: "postgres" })).toBe("postgres");
  });

  it("honors REALTIME_BUS overrides only when the backend is configured", () => {
    expect(resolveBusBackend({ REALTIME_BUS: "off", REDIS_URL: "redis://x" })).toBe("inprocess");
    expect(resolveBusBackend({ REALTIME_BUS: "postgres", REDIS_URL: "redis://x", DATABASE_URL: "postgres://y" })).toBe("postgres");
    expect(resolveBusBackend({ REALTIME_BUS: "redis", DATABASE_URL: "postgres://y" })).toBe("postgres");
  });
});

describe("resolveListenUrl", () => {
  it("uses REALTIME_DATABASE_URL first", () => {
    expect(resolveListenUrl({ REALTIME_DATABASE_URL: "postgres://direct/db", DATABASE_URL: "postgres://pooled/db" })).toBe("postgres://direct/db");
  });

  it("turns a Neon pooled host into its direct host (LISTEN needs a session)", () => {
    expect(resolveListenUrl({ DATABASE_URL: "postgres://u:p@ep-cool-1-pooler.us-east-2.aws.neon.tech/db?sslmode=require" }))
      .toBe("postgres://u:p@ep-cool-1.us-east-2.aws.neon.tech/db?sslmode=require");
    expect(resolveListenUrl({ DATABASE_URL: "postgres://localhost:5432/db" })).toBe("postgres://localhost:5432/db");
    expect(resolveListenUrl({})).toBeNull();
  });
});

describe("InProcessBus", () => {
  it("delivers to other instances once, never back to the sender", async () => {
    const network = new EventEmitter();
    const a = new InProcessBus({ network, instanceId: "a" });
    const b = new InProcessBus({ network, instanceId: "b" });
    const gotA: unknown[] = [];
    const gotB: Array<{ topic: string; data: unknown; from: string }> = [];
    a.subscribe((_t, d) => gotA.push(d));
    b.subscribe((topic, data, meta) => gotB.push({ topic, data, from: meta.instanceId }));
    a.publish("live", { hello: 1 });
    await tick();
    expect(gotA).toEqual([]);
    expect(gotB).toEqual([{ topic: "live", data: { hello: 1 }, from: "a" }]);
  });

  it("drops a redelivered message id", async () => {
    const network = new EventEmitter();
    const b = new InProcessBus({ network, instanceId: "b" });
    const got: unknown[] = [];
    b.subscribe((_t, d) => got.push(d));
    const env = { v: 1, i: "a", m: "same-id", t: "live", d: { n: 1 } };
    network.emit("message", env);
    network.emit("message", env);
    expect(got).toEqual([{ n: 1 }]);
  });
});

describe("createRoomFanout", () => {
  it("applies remote events locally without publishing them again", async () => {
    const network = new EventEmitter();
    const busA = new InProcessBus({ network, instanceId: "a" });
    const busB = new InProcessBus({ network, instanceId: "b" });
    const deliveredA: unknown[] = [];
    const deliveredB: unknown[] = [];
    const fanA = createRoomFanout({ topic: "t", bus: () => busA, apply: { broadcast: (r, p) => { deliveredA.push([r, p]); fanA.publish("broadcast", r, p); } } });
    const fanB = createRoomFanout({ topic: "t", bus: () => busB, apply: { broadcast: (r, p) => { deliveredB.push([r, p]); fanB.publish("broadcast", r, p); } } });
    fanA.start();
    fanB.start();
    fanA.publish("broadcast", "room-1", { type: "comment" });
    await tick();
    await tick();
    expect(deliveredB).toEqual([["room-1", { type: "comment" }]]);
    // B's re-entrant publish was suppressed, so nothing bounced back to A.
    expect(deliveredA).toEqual([]);
  });

  it("never publishes localOnly events and ignores other topics", async () => {
    const network = new EventEmitter();
    const busA = new InProcessBus({ network, instanceId: "a" });
    const busB = new InProcessBus({ network, instanceId: "b" });
    const got: unknown[] = [];
    const fanA = createRoomFanout({ topic: "t", bus: () => busA, apply: {}, localOnly: (_k, p) => p.type === "viewerCount" });
    const fanB = createRoomFanout({ topic: "t", bus: () => busB, apply: { broadcast: (r, p) => got.push([r, p]) } });
    fanB.start();
    fanA.publish("broadcast", "r", { type: "viewerCount", count: 3 });
    busA.publish("other-topic", { k: "broadcast", r: "r", p: {} });
    await tick();
    expect(got).toEqual([]);
  });
});
