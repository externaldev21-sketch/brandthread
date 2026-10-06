import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import type { WebSocketServer } from "ws";
import { attachCallWebSocket, callSocketCount, sendCallEvent } from "./callHub";

let server: Server;
let wss: WebSocketServer;
let base = "";

const tokens: Record<string, string> = { "tok-alice": "alice", "tok-bob": "bob" };

beforeAll(async () => {
  server = createServer();
  wss = attachCallWebSocket(server, { verifyToken: async (t) => (t ? tokens[t] ?? null : null) });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  wss.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function open(token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base}/ws/calls?token=${token}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
    ws.once("unexpected-response", (_req, res) => reject(new Error(`status ${res.statusCode}`)));
  });
}

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => ws.once("message", (data) => resolve(JSON.parse(String(data)))));
}

async function until(fn: () => boolean) {
  for (let i = 0; i < 50 && !fn(); i += 1) await new Promise((r) => setTimeout(r, 10));
}

describe("callHub", () => {
  it("rejects a connection without a valid token", async () => {
    await expect(open("bogus")).rejects.toThrow(/401/);
    await expect(open("")).rejects.toThrow(/401/);
  });

  it("delivers an event to every socket of the target user only", async () => {
    const alice1 = await open("tok-alice");
    const alice2 = await open("tok-alice");
    const bob = await open("tok-bob");
    await until(() => callSocketCount("alice") === 2 && callSocketCount("bob") === 1);

    const bobMessages: unknown[] = [];
    bob.on("message", (d) => bobMessages.push(JSON.parse(String(d))));

    const m1 = nextMessage(alice1);
    const m2 = nextMessage(alice2);
    const sent = sendCallEvent("alice", { type: "call.incoming", call: { id: "c1" } });
    expect(sent).toBe(2);
    expect(await m1).toEqual({ type: "call.incoming", call: { id: "c1" } });
    expect(await m2).toEqual({ type: "call.incoming", call: { id: "c1" } });
    await new Promise((r) => setTimeout(r, 30));
    expect(bobMessages).toEqual([]);

    expect(sendCallEvent("nobody", { type: "call.updated" })).toBe(0);

    alice1.close();
    await until(() => callSocketCount("alice") === 1);
    expect(callSocketCount("alice")).toBe(1);
    alice2.close();
    bob.close();
    await until(() => callSocketCount("alice") === 0 && callSocketCount("bob") === 0);
    expect(callSocketCount("bob")).toBe(0);
  });
});
