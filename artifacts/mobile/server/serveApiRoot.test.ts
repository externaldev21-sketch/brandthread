import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { isApiRootPath, server } = require("./serve.js") as {
  isApiRootPath: (pathname: string) => boolean;
  server: http.Server;
};

describe("root-level API pages (BT-301)", () => {
  it("claims exactly the API's root pages and nothing the app routes", () => {
    for (const path of [
      "/.well-known/apple-app-site-association",
      "/.well-known/assetlinks.json",
      "/l/abc123",
      "/bio/maison",
      "/bio/maison/shop",
      "/bio/maison/go/link_1",
      "/bio/maison/p/prod_1",
      "/g/spring",
      "/u/maison",
    ]) expect(isApiRootPath(path), path).toBe(true);
    for (const path of [
      "/", "/live-replays", "/location", "/u", "/u/maison/posts", "/l", "/bio", "/giveaways",
      "/.well-known/other", "/store/product/prod_1", "/api/healthz",
    ]) expect(isApiRootPath(path), path).toBe(false);
  });

  describe("forwarding", () => {
    let api: http.Server;
    let web: http.Server;
    let webBase = "";
    const seen: Array<{ url?: string; forwardedHost?: string }> = [];

    beforeAll(async () => {
      api = http.createServer((req, res) => {
        seen.push({ url: req.url, forwardedHost: req.headers["x-forwarded-host"] as string | undefined });
        if (req.url === "/l/abc123") {
          res.writeHead(302, { location: "https://brandthread.app/store/maison" });
          res.end();
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ applinks: { apps: [], details: [{ appID: "TEAM.com.brandthread.mobile" }] } }));
      });
      await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
      process.env.API_INTERNAL_ORIGIN = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
      web = server;
      await new Promise<void>((resolve) => web.listen(0, "127.0.0.1", resolve));
      webBase = `http://127.0.0.1:${(web.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      delete process.env.API_INTERNAL_ORIGIN;
      await new Promise((resolve) => web.close(resolve));
      await new Promise((resolve) => api.close(resolve));
    });

    it("serves the AASA as JSON from the API, not the SPA shell", async () => {
      const res = await fetch(`${webBase}/.well-known/apple-app-site-association`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect((await res.json()).applinks.details).toHaveLength(1);
      expect(seen.at(-1)).toMatchObject({ url: "/.well-known/apple-app-site-association" });
    });

    it("passes a short link's redirect straight through", async () => {
      const res = await fetch(`${webBase}/l/abc123`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://brandthread.app/store/maison");
      // The public host reaches the API so it can build absolute URLs.
      expect(seen.at(-1)?.url).toBe("/l/abc123");
      expect(seen.at(-1)?.forwardedHost).toBe(new URL(webBase).host);
    });

    it("keeps the query string", async () => {
      await fetch(`${webBase}/bio/maison?utm_source=ig`);
      expect(seen.at(-1)?.url).toBe("/bio/maison?utm_source=ig");
    });

    it("answers 502, never the SPA shell, when the API is down", async () => {
      const saved = process.env.API_INTERNAL_ORIGIN;
      process.env.API_INTERNAL_ORIGIN = "http://127.0.0.1:1";
      const res = await fetch(`${webBase}/g/spring`, { headers: { accept: "text/html" } });
      process.env.API_INTERNAL_ORIGIN = saved;
      expect(res.status).toBe(502);
    });
  });
});
