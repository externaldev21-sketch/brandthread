import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { IP_NOTICE_PATHS, ipNoticePage, renderIpNoticePage } from "../ipNoticePage";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.get([...IP_NOTICE_PATHS], ipNoticePage);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

describe("public IP / DMCA notice page", () => {
  it.each(IP_NOTICE_PATHS)("is served without auth at %s with a locked-down CSP", async (route) => {
    const response = await fetch(`${base}${route}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const csp = response.headers.get("content-security-policy") ?? "";
    const html = await response.text();
    const nonce = csp.match(/script-src 'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    expect(html).toContain(`<script nonce="${nonce}">`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'self'");
  });

  it("carries every field and statement the intake endpoint requires", () => {
    const html = renderIpNoticePage("n0nce");
    for (const id of ["claimantName", "claimantEmail", "rightsType", "listingUrl", "description", "goodFaith", "accuracy", "signature"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain("/api/ip-cases");
    expect(html).toContain("channel:'web_notice'");
    expect(html).toContain("goodFaithStatement:true,accuracyStatement:true");
    expect(html).toContain("repeat-infringer");
  });
});
