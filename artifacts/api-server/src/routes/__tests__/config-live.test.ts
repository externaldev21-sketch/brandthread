/**
 * BT-376: GET /api/config/live tells the app whether Go Live can work
 * (Agora configured), so the client hides Go Live instead of failing.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import express from "express";
import { isLiveAvailable, liveConfigPayload } from "../../lib/liveAvailability";
import configLiveRouter from "../config-live";
import { applyLiveSection, renderNotes, readDemoEnv } from "../../scripts/reviewDemo/plan";

describe("isLiveAvailable", () => {
  it("is true only when both AGORA_APP_ID and AGORA_APP_CERTIFICATE are set", () => {
    expect(isLiveAvailable({ AGORA_APP_ID: "id", AGORA_APP_CERTIFICATE: "cert" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isLiveAvailable({ AGORA_APP_ID: "id" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isLiveAvailable({ AGORA_APP_CERTIFICATE: "cert" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isLiveAvailable({ AGORA_APP_ID: "  ", AGORA_APP_CERTIFICATE: "cert" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isLiveAvailable({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("payload never leaks the Agora values", () => {
    const payload = liveConfigPayload({ AGORA_APP_ID: "secret-id", AGORA_APP_CERTIFICATE: "secret-cert" } as NodeJS.ProcessEnv);
    expect(payload).toEqual({ liveAvailable: true });
    expect(JSON.stringify(payload)).not.toContain("secret");
  });
});

describe("GET /api/config/live", () => {
  const saved = { id: process.env.AGORA_APP_ID, cert: process.env.AGORA_APP_CERTIFICATE };
  afterEach(() => {
    if (saved.id === undefined) delete process.env.AGORA_APP_ID; else process.env.AGORA_APP_ID = saved.id;
    if (saved.cert === undefined) delete process.env.AGORA_APP_CERTIFICATE; else process.env.AGORA_APP_CERTIFICATE = saved.cert;
  });

  async function fetchFlag() {
    const app = express();
    app.use("/api/config/live", configLiveRouter);
    const server = app.listen(0);
    await new Promise<void>((r) => server.once("listening", () => r()));
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/api/config/live`);
      return { status: res.status, body: await res.json() };
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }

  it("reports false without Agora (no auth needed)", async () => {
    delete process.env.AGORA_APP_ID;
    delete process.env.AGORA_APP_CERTIFICATE;
    expect(await fetchFlag()).toEqual({ status: 200, body: { liveAvailable: false } });
  });

  it("reports true with Agora configured", async () => {
    process.env.AGORA_APP_ID = "app";
    process.env.AGORA_APP_CERTIFICATE = "cert";
    expect(await fetchFlag()).toEqual({ status: 200, body: { liveAvailable: true } });
  });
});

describe("REVIEW_NOTES live sections", () => {
  const tpl = "a\n<!-- if:live -->\n- Go live with the seller\n<!-- endif:live -->\nb {{REVIEW_DEMO_BUYER_EMAIL}}\n";
  const env = readDemoEnv({
    REVIEW_DEMO_BUYER_EMAIL: "buyer@reviewers.example.com",
    REVIEW_DEMO_BUYER_PASSWORD: "a-long-enough-pass-1",
    REVIEW_DEMO_SELLER_EMAIL: "seller@reviewers.example.com",
    REVIEW_DEMO_SELLER_PASSWORD: "another-long-pass-2",
  }).env!;

  it("drops Go Live instructions when Agora is not configured", () => {
    expect(applyLiveSection(tpl, false)).toBe("a\nb {{REVIEW_DEMO_BUYER_EMAIL}}\n");
    expect(renderNotes(tpl, env, { liveAvailable: false })).not.toMatch(/go live/i);
  });

  it("keeps them, without markers, when it is", () => {
    const out = renderNotes(tpl, env, { liveAvailable: true });
    expect(out).toBe("a\n- Go live with the seller\nb buyer@reviewers.example.com\n");
  });
});
