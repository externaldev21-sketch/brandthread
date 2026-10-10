import { afterEach, describe, expect, it, vi } from "vitest";

const createMock = vi.hoisted(() => vi.fn());
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { audio: { transcriptions: { create: createMock } } },
}));

import {
  captionsAvailable, captionsEnvConfigured, cleanCaptionText, formatVttTime, languageCode,
  moderateSegments, normalizeWhisperSegments, resetCaptionsFlagCache, segmentsToVtt, transcribeAudio,
} from "./captions";

const ENV_KEYS = ["AI_INTEGRATIONS_OPENAI_BASE_URL", "AI_INTEGRATIONS_OPENAI_API_KEY"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
  resetCaptionsFlagCache();
  createMock.mockReset();
});

describe("WebVTT conversion", () => {
  it("formats timestamps as HH:MM:SS.mmm", () => {
    expect(formatVttTime(0)).toBe("00:00:00.000");
    expect(formatVttTime(1.5)).toBe("00:00:01.500");
    expect(formatVttTime(61.234)).toBe("00:01:01.234");
    expect(formatVttTime(3725.007)).toBe("01:02:05.007");
    expect(formatVttTime(-3)).toBe("00:00:00.000");
  });

  it("builds numbered cues under a WEBVTT header", () => {
    const vtt = segmentsToVtt([
      { start: 0, end: 2.4, text: "Hello there" },
      { start: 2.4, end: 5, text: "Welcome back" },
    ]);
    expect(vtt).toBe(
      "WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.400\nHello there\n\n2\n00:00:02.400 --> 00:00:05.000\nWelcome back\n",
    );
  });

  it("produces a bare header for no segments", () => {
    expect(segmentsToVtt([])).toBe("WEBVTT\n\n");
  });

  it("cleans cue-breaking characters and whitespace", () => {
    expect(cleanCaptionText("  a --> b \n <i>c</i> & d ")).toBe("a --› b ‹i›c‹/i› + d");
  });

  it("normalizes whisper segments: drops empties, keeps order, avoids overlap", () => {
    const out = normalizeWhisperSegments([
      { start: 0, end: 3, text: " one " },
      { start: 2.5, end: 2.6, text: "two" },
      { start: 5, end: 6, text: "   " },
      { start: Number.NaN, end: 7, text: "bad" },
    ]);
    expect(out).toEqual([
      { start: 0, end: 3, text: "one" },
      { start: 3, end: 3.2, text: "two" },
    ]);
  });

  it("maps whisper language names to codes", () => {
    expect(languageCode("english")).toBe("en");
    expect(languageCode("Spanish")).toBe("es");
    expect(languageCode("fr")).toBe("fr");
    expect(languageCode(undefined)).toBe("en");
    expect(languageCode("klingon")).toBe("en");
  });
});

describe("moderation", () => {
  it("skips segments the public moderator rejects", () => {
    const { kept, skipped } = moderateSegments([
      { start: 0, end: 1, text: "Lovely jacket" },
      { start: 1, end: 2, text: "kill yourself" },
    ]);
    expect(kept.map((s) => s.text)).toEqual(["Lovely jacket"]);
    expect(skipped).toBe(1);
  });
});

describe("availability gating", () => {
  it("is unavailable without the AI env keys, without touching the database", async () => {
    delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    expect(captionsEnvConfigured()).toBe(false);
    expect(await captionsAvailable()).toBe(false);
  });

  it("needs both keys", () => {
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://ai.test";
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    expect(captionsEnvConfigured()).toBe(false);
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "k";
    expect(captionsEnvConfigured()).toBe(true);
  });
});

describe("Whisper call", () => {
  it("requests verbose_json with segment timestamps and returns segments", async () => {
    createMock.mockResolvedValue({ language: "english", segments: [{ start: 0, end: 1, text: "hi" }] });
    const result = await transcribeAudio(Buffer.from("audio"));
    expect(result.segments).toHaveLength(1);
    const arg = createMock.mock.calls[0][0];
    expect(arg.model).toBe("whisper-1");
    expect(arg.response_format).toBe("verbose_json");
    expect(arg.timestamp_granularities).toEqual(["segment"]);
  });
});
