import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { server, isApiOwnedPath } = require("./serve.js") as {
  server: http.Server;
  isApiOwnedPath: (pathname: string) => boolean;
};

describe("api-owned public paths", () => {
  it("recognises the server-rendered public pages", () => {
    for (const p of [
      "/l/abc123",
      "/bio/janedoe",
      "/bio/janedoe/go/42",
      "/g/WIN2026",
      "/dmca",
      "/legal/ip-notice",
      "/.well-known/apple-app-site-association",
      "/.well-known/assetlinks.json",
    ]) {
      expect(isApiOwnedPath(p), p).toBe(true);
    }
  });

  it("leaves app routes to the web app", () => {
    for (const p of ["/", "/live", "/live/abc", "/u/janedoe", "/invite/ABC", "/l", "/g", "/bio", "/legal", "/changelog"]) {
      expect(isApiOwnedPath(p), p).toBe(false);
    }
  });
});

describe("forwarding api-owned paths", () => {
  let upstream: http.Server;
  let web: http.Server;
  let webPort = 0;
  const seen: string[] = [];

  beforeAll(async () => {
    upstream = http.createServer((req, res) => {
      seen.push(req.url ?? "");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html>link in bio</html>");
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", () => r()));
    process.env.API_INTERNAL_ORIGIN = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    web = server;
    await new Promise<void>((r) => web.listen(0, "127.0.0.1", () => r()));
    webPort = (web.address() as AddressInfo).port;
  });

  afterAll(async () => {
    delete process.env.API_INTERNAL_ORIGIN;
    await new Promise<void>((r) => web.close(() => r()));
    await new Promise<void>((r) => upstream.close(() => r()));
  });

  it("proxies a link-in-bio page to api-server instead of the SPA shell", async () => {
    const res = await fetch(`http://127.0.0.1:${webPort}/bio/janedoe?utm_source=ig`, { headers: { accept: "text/html" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("link in bio");
    expect(seen).toContain("/bio/janedoe?utm_source=ig");
  });

  it("answers 502 (not a fake 200 page) when api-server is unreachable", async () => {
    process.env.API_INTERNAL_ORIGIN = "http://127.0.0.1:1";
    const res = await fetch(`http://127.0.0.1:${webPort}/dmca`, { headers: { accept: "text/html" } });
    expect(res.status).toBe(502);
  });
});
