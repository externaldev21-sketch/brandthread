/**
 * BT-472: two live hubs in one process stand in for two API instances.
 *
 * Each hub is a separate copy of ws/liveHub.ts (vi.resetModules) with its own
 * rooms, its own realtime bus (own instance id) and its own HTTP server. A
 * real `ws` client connects to each. A broadcast on hub A must reach the
 * socket on hub B exactly once, for the Postgres LISTEN/NOTIFY backend (real
 * test database) and the in-process backend.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import WS from "ws";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

vi.mock("../auth", () => ({
  // Test stand-in for Clerk: the token is the user id.
  verifyWsToken: async (token: string | undefined | null) => (token ? token : null),
}));

type Hub = typeof import("../liveHub");
type Instance = { hub: Hub; server: Server; port: number; close: () => Promise<void> };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const testStreams = new Set<string>();

async function startInstance(): Promise<Instance> {
  vi.resetModules();
  const hub = (await import("../liveHub")) as Hub;
  const bus = await import("../../lib/realtime/bus");
  const server = createServer();
  const wss = hub.attachLiveWebSocket(server);
  await new Promise<void>((r) => server.listen(0, r));
  await bus.getRealtimeBus().ready();
  return {
    hub,
    server,
    port: (server.address() as AddressInfo).port,
    close: async () => {
      for (const c of wss.clients) c.terminate();
      wss.close();
      await new Promise<void>((r) => server.close(() => r()));
      await bus.closeRealtimeBus();
    },
  };
}

async function connect(inst: Instance, streamId: string, userId: string) {
  // Transport fixtures must satisfy the real stream/host admission policy.
  // These rows are isolated to this test; production authorization stays intact.
  await db.execute(sql`
    INSERT INTO live_streams (id, seller_id, channel_name, title, status)
    VALUES (${streamId}::uuid, ${userId}, ${`bt-multi-instance-test-${streamId}`}, 'Transport fixture', 'live')
    ON CONFLICT (id) DO NOTHING
  `);
  testStreams.add(streamId);
  await db.execute(sql`
    INSERT INTO live_cohosts (stream_id, host_id, cohost_id, status)
    SELECT id, seller_id, ${userId}, 'accepted' FROM live_streams WHERE id = ${streamId}::uuid
    ON CONFLICT DO NOTHING
  `);
  // Authorized hosts are not counted in live_viewers.
  const ws = new WS(`ws://127.0.0.1:${inst.port}/ws/live?streamId=${streamId}&token=${userId}&role=host`);
  const messages: any[] = [];
  let closedWith: number | null = null;
  ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  ws.on("close", (code) => { closedWith = code; });
  await new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });
  await sleep(100); // let the server finish its connection handler
  return { ws, messages, closedCode: () => closedWith };
}

async function waitFor(pred: () => boolean, ms = 3_000) {
  const until = Date.now() + ms;
  while (!pred() && Date.now() < until) await sleep(20);
}

const running: Instance[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((i) => i.close()));
  for (const streamId of testStreams) {
    await db.execute(sql`DELETE FROM live_cohosts WHERE stream_id = ${streamId}::uuid`);
    await db.execute(sql`DELETE FROM live_streams WHERE id = ${streamId}::uuid AND channel_name = ${`bt-multi-instance-test-${streamId}`}`);
  }
  testStreams.clear();
  delete process.env.REALTIME_BUS;
});
afterAll(async () => {
  await db.execute(sql`DELETE FROM realtime_bus_payloads WHERE created_at < now() + interval '1 minute' AND body LIKE '%bt-multi-instance-test%'`);
});

for (const backend of ["postgres", "inprocess"] as const) {
  describe(`two live hub instances over the ${backend} bus`, () => {
    it("a message sent on A reaches a socket on B exactly once (and A's own socket once)", async () => {
      process.env.REALTIME_BUS = backend;
      const a = await startInstance();
      const b = await startInstance();
      running.push(a, b);
      const streamId = randomUUID();
      const onA = await connect(a, streamId, `user-a-${randomUUID()}`);
      const onB = await connect(b, streamId, `user-b-${randomUUID()}`);

      a.hub.broadcastToRoom(streamId, { type: "comment", text: "hi from A" });
      await waitFor(() => onB.messages.length >= 1);
      await sleep(300); // anything duplicated would have arrived by now

      expect(onB.messages).toEqual([{ type: "comment", text: "hi from A" }]);
      expect(onA.messages).toEqual([{ type: "comment", text: "hi from A" }]);
      onA.ws.close();
      onB.ws.close();
    });

    it("large events cross instances too", async () => {
      process.env.REALTIME_BUS = backend;
      const a = await startInstance();
      const b = await startInstance();
      running.push(a, b);
      const streamId = randomUUID();
      const onB = await connect(b, streamId, `user-b-${randomUUID()}`);
      const text = `bt-multi-instance-test ${"y".repeat(12_000)}`;
      a.hub.broadcastToRoom(streamId, { type: "product", text });
      await waitFor(() => onB.messages.length >= 1);
      await sleep(200);
      expect(onB.messages).toHaveLength(1);
      expect(onB.messages[0].text).toBe(text);
      onB.ws.close();
    });

    it("viewer counts stay local: every instance computes them from live_viewers itself", async () => {
      process.env.REALTIME_BUS = backend;
      const a = await startInstance();
      const b = await startInstance();
      running.push(a, b);
      const streamId = randomUUID();
      const onB = await connect(b, streamId, `user-b-${randomUUID()}`);
      a.hub.broadcastToRoom(streamId, { type: "viewerCount", count: 7 });
      await sleep(400);
      expect(onB.messages).toEqual([]);
      onB.ws.close();
    });

    it("a host removing a viewer closes the viewer's socket on the other instance", async () => {
      process.env.REALTIME_BUS = backend;
      const a = await startInstance();
      const b = await startInstance();
      running.push(a, b);
      const streamId = randomUUID();
      const viewer = `viewer-${randomUUID()}`;
      const onB = await connect(b, streamId, viewer);
      a.hub.disconnectUserFromRoom(streamId, viewer);
      await waitFor(() => onB.closedCode() !== null);
      expect(onB.closedCode()).toBe(4003);
    });
  });
}
