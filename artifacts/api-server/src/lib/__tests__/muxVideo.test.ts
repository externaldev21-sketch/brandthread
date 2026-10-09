import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createMuxAsset,
  hlsUrlForPlaybackId,
  muxConfig,
  parseMuxAssetEvent,
  scheduleHlsTranscode,
  verifyMuxSignature,
} from "../muxVideo";

const secret = "whsec_test";
const sign = (body: string, t: number, key = secret) =>
  `t=${t},v1=${createHmac("sha256", key).update(`${t}.${body}`).digest("hex")}`;

describe("muxConfig", () => {
  it("is off unless all three keys are present", () => {
    expect(muxConfig({})).toBeNull();
    expect(muxConfig({ MUX_TOKEN_ID: "a", MUX_TOKEN_SECRET: "b" })).toBeNull();
    expect(muxConfig({ MUX_TOKEN_ID: "a", MUX_TOKEN_SECRET: "b", MUX_WEBHOOK_SECRET: " " })).toBeNull();
    expect(muxConfig({ MUX_TOKEN_ID: "a", MUX_TOKEN_SECRET: "b", MUX_WEBHOOK_SECRET: "c" }))
      .toEqual({ tokenId: "a", tokenSecret: "b", webhookSecret: "c" });
  });

  it("scheduling is a silent no-op when off", () => {
    const prev = { ...process.env };
    delete process.env.MUX_TOKEN_ID;
    expect(() => scheduleHlsTranscode("post", "/objects/uploads/x")).not.toThrow();
    process.env = prev;
  });
});

describe("verifyMuxSignature", () => {
  const body = JSON.stringify({ type: "video.asset.ready" });
  const now = 1_700_000_000;

  it("accepts a valid signature inside the tolerance window", () => {
    expect(verifyMuxSignature(Buffer.from(body), sign(body, now), secret, now)).toBe(true);
    expect(verifyMuxSignature(body, sign(body, now - 100), secret, now)).toBe(true);
  });

  it("rejects tampering, wrong secrets, stale timestamps and malformed headers", () => {
    expect(verifyMuxSignature(body + " ", sign(body, now), secret, now)).toBe(false);
    expect(verifyMuxSignature(body, sign(body, now, "other"), secret, now)).toBe(false);
    expect(verifyMuxSignature(body, sign(body, now - 301), secret, now)).toBe(false);
    expect(verifyMuxSignature(body, undefined, secret, now)).toBe(false);
    expect(verifyMuxSignature(body, "v1=abc", secret, now)).toBe(false);
    expect(verifyMuxSignature(body, `t=${now},v1=zz`, secret, now)).toBe(false);
    expect(verifyMuxSignature(body, sign(body, now), "", now)).toBe(false);
  });
});

describe("parseMuxAssetEvent", () => {
  it("returns the HLS URL and poster for a ready asset with a public playback id", () => {
    expect(parseMuxAssetEvent({
      type: "video.asset.ready",
      data: { id: "asset1", passthrough: "post-1", playback_ids: [{ id: "signedOnly1234", policy: "signed" }, { id: "Pub1234567890", policy: "public" }] },
    })).toEqual({
      kind: "ready", assetId: "asset1", postId: "post-1",
      hlsUrl: "https://stream.mux.com/Pub1234567890.m3u8",
      posterUrl: "https://image.mux.com/Pub1234567890/thumbnail.jpg?time=0",
    });
  });

  it("treats errors, missing public ids and unrelated events correctly", () => {
    expect(parseMuxAssetEvent({ type: "video.asset.errored", data: { id: "a2" } })).toEqual({ kind: "errored", assetId: "a2", postId: null });
    expect(parseMuxAssetEvent({ type: "video.asset.ready", data: { id: "a3", playback_ids: [] } })).toMatchObject({ kind: "errored" });
    expect(parseMuxAssetEvent({ type: "video.upload.created", data: { id: "a4" } })).toBeNull();
    expect(parseMuxAssetEvent(null)).toBeNull();
    expect(parseMuxAssetEvent({ type: "video.asset.ready" })).toBeNull();
  });

  it("only builds stream URLs from safe playback ids", () => {
    expect(hlsUrlForPlaybackId("../../evil")).toBeNull();
    expect(hlsUrlForPlaybackId("abcDEF1234")).toBe("https://stream.mux.com/abcDEF1234.m3u8");
  });
});

describe("createMuxAsset", () => {
  const config = { tokenId: "id", tokenSecret: "sec", webhookSecret: "w" };

  it("posts the input URL with basic auth and returns the asset id", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ data: { id: "asset9" } }) }));
    await expect(createMuxAsset(config, "https://signed/url", "post-9", fetchImpl)).resolves.toBe("asset9");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://api.mux.com/video/v1/assets");
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("id:sec").toString("base64")}`);
    expect(JSON.parse(init.body)).toMatchObject({ input: [{ url: "https://signed/url" }], playback_policy: ["public"], passthrough: "post-9" });
  });

  it("throws on API errors (callers log and keep the MP4)", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    await expect(createMuxAsset(config, "u", "p", fetchImpl)).rejects.toThrow(/401/);
  });
});
