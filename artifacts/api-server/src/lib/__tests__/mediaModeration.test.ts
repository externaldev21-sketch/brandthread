import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  VIDEO_FRAME_COUNT,
  decide,
  frameOffsets,
  isAllowedVideoUrl,
  allowedVideoHosts,
  mediaModerationEnabled,
  mergeFrames,
  screenImageBuffer,
  screenImageUrl,
  screenText,
  screenVideo,
  setMediaModerationProvider,
  setTextModerationProvider,
  setVideoFrameExtractor,
  worstVerdict,
  type FrameScores,
} from "../mediaModeration";

const clean: FrameScores = { flags: {}, scores: { sexual: 0.01, violence: 0.02 } };
const png = Buffer.from("89504e470d0a1a0a", "hex");

const ENV_KEYS = ["AI_INTEGRATIONS_OPENAI_BASE_URL", "AI_INTEGRATIONS_OPENAI_API_KEY", "MEDIA_MODERATION_ENABLED"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
  setMediaModerationProvider();
  setTextModerationProvider();
  setVideoFrameExtractor();
});

describe("feature flag", () => {
  it("is off without the AI integration env and skips without calling anything", async () => {
    expect(mediaModerationEnabled()).toBe(false);
    expect((await screenImageBuffer(png, "image/png")).verdict).toBe("skipped");
    expect((await screenImageUrl("https://x.test/a.jpg")).verdict).toBe("skipped");
    expect((await screenVideo({ url: "https://storage.googleapis.com/b/v.mp4" })).verdict).toBe("skipped");
    expect((await screenText("hello")).verdict).toBe("skipped");
  });

  it("is on when both keys are present, and can be switched off", () => {
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://ai.test";
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "k";
    expect(mediaModerationEnabled()).toBe(true);
    process.env.MEDIA_MODERATION_ENABLED = "false";
    expect(mediaModerationEnabled()).toBe(false);
  });

  it("needs both keys", () => {
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "k";
    expect(mediaModerationEnabled()).toBe(false);
  });
});

describe("verdicts from a mocked provider", () => {
  it("allows clean images", async () => {
    setMediaModerationProvider(async () => clean);
    const v = await screenImageBuffer(png, "image/png");
    expect(v).toMatchObject({ verdict: "allow", categories: [], framesChecked: 1 });
  });

  it("holds flagged sexual content", async () => {
    setMediaModerationProvider(async () => ({ flags: { sexual: true }, scores: { sexual: 0.7 } }));
    const v = await screenImageBuffer(png, "image/png");
    expect(v.verdict).toBe("hold");
    expect(v.categories).toEqual(["sexual"]);
    expect(v.maxScore).toBe(0.7);
  });

  it("holds high scores even when the model did not flag", () => {
    expect(decide({ flags: {}, scores: { violence: 0.75 } }, 1, "t").verdict).toBe("hold");
    expect(decide({ flags: {}, scores: { violence: 0.4 } }, 1, "t").verdict).toBe("allow");
  });

  it("rejects sexual/minors and graphic violence", () => {
    expect(decide({ flags: { "sexual/minors": true }, scores: {} }, 1, "t").verdict).toBe("reject");
    expect(decide({ flags: {}, scores: { "sexual/minors": 0.35 } }, 1, "t").verdict).toBe("reject");
    const v = decide({ flags: { "violence/graphic": true, violence: true }, scores: { "violence/graphic": 0.9, violence: 0.95 } }, 1, "t");
    expect(v.verdict).toBe("reject");
    expect(v.categories).toContain("violence/graphic");
  });

  it("fails open to HOLD (unverified) when the provider throws", async () => {
    setMediaModerationProvider(async () => { throw new Error("down"); });
    const v = await screenImageUrl("https://x.test/a.jpg");
    expect(v).toMatchObject({ verdict: "hold", unverified: true, categories: ["review_unavailable"] });
  });

  it("holds non-http image refs as unverified instead of fetching them", async () => {
    setMediaModerationProvider(async () => clean);
    expect((await screenImageUrl("file:///etc/passwd")).verdict).toBe("hold");
  });
});

describe("frame aggregation", () => {
  it("merges flags with OR and scores with max", () => {
    const merged = mergeFrames([
      { flags: {}, scores: { sexual: 0.1, violence: 0.9 } },
      { flags: { sexual: true }, scores: { sexual: 0.6, violence: 0.2 } },
    ]);
    expect(merged.flags).toEqual({ sexual: true });
    expect(merged.scores).toEqual({ sexual: 0.6, violence: 0.9 });
  });

  it("video: one bad frame among clean ones decides the verdict", async () => {
    let n = 0;
    setMediaModerationProvider(async () => (++n === 4 ? { flags: { "violence/graphic": true }, scores: { "violence/graphic": 0.93 } } : clean));
    setVideoFrameExtractor(async ({ frames }) => Array.from({ length: frames }, () => png));
    const v = await screenVideo({ buffer: png });
    expect(v.verdict).toBe("reject");
    expect(v.framesChecked).toBe(VIDEO_FRAME_COUNT);
    expect(v.scores["violence/graphic"]).toBe(0.93);
    expect(v.maxScore).toBe(0.93);
  });

  it("video: max score is taken across frames", async () => {
    const seen = [0.1, 0.72, 0.3, 0.2, 0.1, 0.05];
    let i = 0;
    setMediaModerationProvider(async () => ({ flags: {}, scores: { violence: seen[i++] } }));
    setVideoFrameExtractor(async ({ frames }) => Array.from({ length: frames }, () => png));
    const v = await screenVideo({ buffer: png });
    expect(v.verdict).toBe("hold");
    expect(v.scores.violence).toBe(0.72);
  });

  it("video: extractor failure (e.g. no ffmpeg) holds as unverified", async () => {
    setMediaModerationProvider(async () => clean);
    setVideoFrameExtractor(async () => { throw new Error("ffmpeg missing"); });
    const v = await screenVideo({ buffer: png });
    expect(v).toMatchObject({ verdict: "hold", unverified: true });
  });

  it("video: URLs outside the allowed hosts are never downloaded", async () => {
    const extractor = vi.fn(async () => [png]);
    setMediaModerationProvider(async () => clean);
    setVideoFrameExtractor(extractor);
    const v = await screenVideo({ url: "http://169.254.169.254/latest/meta-data" });
    expect(v.verdict).toBe("hold");
    expect(extractor).not.toHaveBeenCalled();
    const ok = await screenVideo({ url: "https://storage.googleapis.com/b/v.mp4" });
    expect(ok.verdict).toBe("allow");
    expect(extractor).toHaveBeenCalledOnce();
  });

  it("worstVerdict: reject > hold > allow, scores max-ed", () => {
    const a = decide({ flags: {}, scores: { violence: 0.2 } }, 1, "t");
    const b = decide({ flags: { sexual: true }, scores: { sexual: 0.8 } }, 1, "t");
    const c = decide({ flags: { "sexual/minors": true }, scores: {} }, 1, "t");
    expect(worstVerdict([a, b]).verdict).toBe("hold");
    expect(worstVerdict([a, b, c]).verdict).toBe("reject");
    expect(worstVerdict([a]).verdict).toBe("allow");
    expect(worstVerdict([]).verdict).toBe("skipped");
  });
});

describe("helpers", () => {
  it("spreads frame offsets across the clip", () => {
    const offsets = frameOffsets(12, 6);
    expect(offsets).toHaveLength(6);
    expect(offsets[0]).toBeGreaterThan(0);
    expect(offsets[5]).toBeLessThan(12);
    expect(frameOffsets(0, 6)).toEqual([0]);
  });

  it("allows only known hosts and never private addresses", () => {
    const hosts = allowedVideoHosts(["api.brandthread.test"]);
    expect(isAllowedVideoUrl("https://storage.googleapis.com/b/x.mp4", hosts)).toBe(true);
    expect(isAllowedVideoUrl("https://api.brandthread.test/api/posts/media/x", hosts)).toBe(true);
    expect(isAllowedVideoUrl("https://evil.test/x.mp4", hosts)).toBe(false);
    expect(isAllowedVideoUrl("http://localhost:3000/x", ["localhost"])).toBe(false);
    expect(isAllowedVideoUrl("http://10.0.0.5/x", ["10.0.0.5"])).toBe(false);
    expect(isAllowedVideoUrl("ftp://storage.googleapis.com/x", hosts)).toBe(false);
  });
});

describe("text layer", () => {
  it("holds flagged text and allows clean text", async () => {
    setTextModerationProvider(async (t) => (t.includes("bad") ? { flags: { hate: true }, scores: { hate: 0.8 } } : clean));
    expect((await screenText("nice jacket")).verdict).toBe("allow");
    expect((await screenText("bad words")).verdict).toBe("hold");
  });

  it("only sexual/minors rejects text; provider errors allow", async () => {
    setTextModerationProvider(async () => ({ flags: { "violence/graphic": true }, scores: {} }));
    expect((await screenText("x")).verdict).toBe("hold");
    setTextModerationProvider(async () => ({ flags: { "sexual/minors": true }, scores: {} }));
    expect((await screenText("x")).verdict).toBe("reject");
    setTextModerationProvider(async () => { throw new Error("down"); });
    expect((await screenText("x")).verdict).toBe("allow");
  });
});
