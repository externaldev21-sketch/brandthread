import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { responseCompression } from "../compression";

let server: Server | null = null;
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
});

const BIG = { items: Array.from({ length: 200 }, (_, i) => ({ id: i, name: `Product ${i}`, price: 1999 })) };

async function start(): Promise<number> {
  const app = express();
  app.use(responseCompression);
  app.get("/big", (_req, res) => { res.json(BIG); });
  app.get("/small", (_req, res) => { res.json({ ok: true }); });
  app.get("/stream", (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.write(`data: ${"x".repeat(4000)}\n\n`);
    res.end();
  });
  server = app.listen(0);
  await new Promise<void>((r) => server!.once("listening", () => r()));
  return (server!.address() as AddressInfo).port;
}

function get(port: number, path: string, headers: Record<string, string>): Promise<{ encoding?: string; status?: number }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ port, path, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve({ encoding: res.headers["content-encoding"], status: res.statusCode }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("responseCompression", () => {
  it("uses brotli when accepted", async () => {
    const port = await start();
    expect((await get(port, "/big", { "accept-encoding": "gzip, deflate, br" })).encoding).toBe("br");
  });

  it("falls back to gzip", async () => {
    const port = await start();
    expect((await get(port, "/big", { "accept-encoding": "gzip" })).encoding).toBe("gzip");
  });

  it("leaves small bodies alone", async () => {
    const port = await start();
    expect((await get(port, "/small", { "accept-encoding": "gzip, br" })).encoding).toBeUndefined();
  });

  it("never compresses server-sent events", async () => {
    const port = await start();
    expect((await get(port, "/stream", { "accept-encoding": "gzip, br" })).encoding).toBeUndefined();
  });

  it("honours x-no-compression", async () => {
    const port = await start();
    expect((await get(port, "/big", { "accept-encoding": "gzip, br", "x-no-compression": "1" })).encoding).toBeUndefined();
  });
});
