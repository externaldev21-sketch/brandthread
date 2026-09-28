import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildReplayUrl,
  getRecordingEnv,
  isAgoraCloudRecordingConfigured,
  pickReplayFile,
  recordingUidForChannel,
  type RecordingEnv,
} from "./agoraCloudRecording";

const ENV_KEYS = [
  "AGORA_APP_ID",
  "AGORA_CUSTOMER_ID",
  "AGORA_CUSTOMER_SECRET",
  "AGORA_RECORDING_S3_BUCKET",
  "AGORA_RECORDING_S3_REGION",
  "AGORA_RECORDING_S3_ACCESS_KEY",
  "AGORA_RECORDING_S3_SECRET_KEY",
  "AGORA_RECORDING_S3_VENDOR",
  "AGORA_RECORDING_PUBLIC_URL_BASE",
] as const;

const FULL_ENV: Record<(typeof ENV_KEYS)[number], string> = {
  AGORA_APP_ID: "app123",
  AGORA_CUSTOMER_ID: "cust123",
  AGORA_CUSTOMER_SECRET: "secret123",
  AGORA_RECORDING_S3_BUCKET: "bt-live-replays",
  AGORA_RECORDING_S3_REGION: "us-east-1",
  AGORA_RECORDING_S3_ACCESS_KEY: "AKIA...",
  AGORA_RECORDING_S3_SECRET_KEY: "shh",
  AGORA_RECORDING_S3_VENDOR: "",
  AGORA_RECORDING_PUBLIC_URL_BASE: "",
};

let originalValues: Record<string, string | undefined>;

beforeEach(() => {
  originalValues = {};
  for (const key of ENV_KEYS) originalValues[key] = process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalValues[key] === undefined) delete process.env[key];
    else process.env[key] = originalValues[key];
  }
});

function setEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}) {
  for (const key of ENV_KEYS) process.env[key] = FULL_ENV[key];
  for (const [key, value] of Object.entries(overrides)) process.env[key as any] = value;
}

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

describe("getRecordingEnv / isAgoraCloudRecordingConfigured", () => {
  it("is null (unconfigured) when any required var is missing — never crashes, never fabricates config", () => {
    clearEnv();
    expect(getRecordingEnv()).toBeNull();
    expect(isAgoraCloudRecordingConfigured()).toBe(false);
  });

  it("is null when only some vars are set (e.g. Agora creds but no bucket)", () => {
    clearEnv();
    process.env.AGORA_APP_ID = "app123";
    process.env.AGORA_CUSTOMER_ID = "cust123";
    process.env.AGORA_CUSTOMER_SECRET = "secret123";
    expect(getRecordingEnv()).toBeNull();
  });

  it("resolves a full config once every var is set, defaulting vendor to 1 (Amazon S3)", () => {
    setEnv();
    const env = getRecordingEnv();
    expect(env).not.toBeNull();
    expect(env?.vendor).toBe(1);
    expect(env?.bucket).toBe("bt-live-replays");
    expect(isAgoraCloudRecordingConfigured()).toBe(true);
  });

  it("honors an explicit AGORA_RECORDING_S3_VENDOR override", () => {
    setEnv({ AGORA_RECORDING_S3_VENDOR: "6" });
    expect(getRecordingEnv()?.vendor).toBe(6);
  });
});

describe("recordingUidForChannel", () => {
  it("is deterministic and stays out of the host/viewer uid range (< 1,000,000)", () => {
    const uid1 = recordingUidForChannel("bt_12345_abcdef");
    const uid2 = recordingUidForChannel("bt_12345_abcdef");
    expect(uid1).toBe(uid2);
    expect(uid1).toBeGreaterThanOrEqual(900_000_000);
    expect(uid1).toBeLessThan(1_000_000_000);
  });

  it("differs across channels (collision-avoidant, not guaranteed unique)", () => {
    expect(recordingUidForChannel("channel-a")).not.toBe(recordingUidForChannel("channel-b"));
  });
});

describe("pickReplayFile", () => {
  it("returns null for an empty file list — the 'not ready yet' case", () => {
    expect(pickReplayFile([])).toBeNull();
  });

  it("picks the playable mp4 entry over an hls entry", () => {
    const file = pickReplayFile([
      { fileName: "recordings/x/abc.m3u8", trackType: "hls" },
      { fileName: "recordings/x/abc_mixed.mp4", trackType: "mp4", isPlayable: true },
    ]);
    expect(file?.fileName).toBe("recordings/x/abc_mixed.mp4");
  });

  it("ignores an mp4 explicitly marked not playable yet", () => {
    const file = pickReplayFile([
      { fileName: "recordings/x/abc_mixed.mp4", trackType: "mp4", isPlayable: false },
      { fileName: "recordings/x/def_mixed.mp4", trackType: "mp4", isPlayable: true },
    ]);
    expect(file?.fileName).toBe("recordings/x/def_mixed.mp4");
  });
});

describe("buildReplayUrl", () => {
  const baseEnv: RecordingEnv = {
    appId: "app123",
    customerId: "cust",
    customerSecret: "secret",
    bucket: "bt-live-replays",
    region: "us-east-1",
    accessKey: "ak",
    secretKey: "sk",
    vendor: 1,
  };

  it("builds a virtual-hosted-style S3 URL when no public URL base is configured", () => {
    expect(buildReplayUrl(baseEnv, "recordings/x/abc_mixed.mp4")).toBe(
      "https://bt-live-replays.s3.us-east-1.amazonaws.com/recordings/x/abc_mixed.mp4",
    );
  });

  it("prefers AGORA_RECORDING_PUBLIC_URL_BASE (e.g. a CDN domain) when set", () => {
    const env: RecordingEnv = { ...baseEnv, publicUrlBase: "https://cdn.example.com/live/" };
    expect(buildReplayUrl(env, "recordings/x/abc_mixed.mp4")).toBe(
      "https://cdn.example.com/live/recordings/x/abc_mixed.mp4",
    );
  });
});
