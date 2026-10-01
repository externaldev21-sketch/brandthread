import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  users: {},
  dataExportJobs: {},
}));
vi.mock("../lib/dataExport", () => ({ buildAccountDataExport: vi.fn() }));
vi.mock("../lib/objectStorage", () => ({ ObjectStorageService: class {} }));

import { processDataExportJob, downloadUrlFor, type ProcessDeps, type ReadyPatch } from "./dataExportJob";
import {
  canTransition,
  DATA_EXPORT_LINK_TTL_MS,
  hashDownloadToken,
  generateDownloadToken,
  isDownloadable,
  isValidTokenShape,
  nextExportRequestAt,
  statusAfterFailure,
} from "../lib/dataExportJobs";
import { isMailerConfigured, sendDataExportReadyEmail } from "../lib/mailer";

const NOW = new Date("2026-09-30T12:00:00Z");

function makeDeps(overrides: Partial<ProcessDeps> = {}) {
  const saved: ReadyPatch[] = [];
  const failures: Array<{ status: string; error: string }> = [];
  const deps: ProcessDeps = {
    now: () => NOW,
    origin: () => "https://brandthread.app",
    mailerConfigured: () => true,
    buildExport: vi.fn(async () => ({ profile: { name: "Maya" } })),
    uploadFile: vi.fn(async (jobId: string) => `/objects/data-exports/${jobId}.json`),
    getEmail: vi.fn(async () => "maya@example.com"),
    sendEmail: vi.fn(async () => true),
    saveReady: vi.fn(async (_id: string, patch: ReadyPatch) => { saved.push(patch); }),
    saveFailure: vi.fn(async (_id: string, status: string, error: string) => { failures.push({ status, error }); }),
    ...overrides,
  };
  return { deps, saved, failures };
}

const job = { id: "job-1", clerkId: "user_1", categories: ["profile"], attempts: 1 };

describe("job state machine", () => {
  it("allows only the documented transitions", () => {
    expect(canTransition("queued", "running")).toBe(true);
    expect(canTransition("running", "ready")).toBe(true);
    expect(canTransition("running", "queued")).toBe(true);
    expect(canTransition("ready", "expired")).toBe(true);
    expect(canTransition("queued", "ready")).toBe(false);
    expect(canTransition("failed", "queued")).toBe(false);
    expect(canTransition("expired", "ready")).toBe(false);
  });
  it("retries until three attempts, then fails", () => {
    expect(statusAfterFailure(1)).toBe("queued");
    expect(statusAfterFailure(2)).toBe("queued");
    expect(statusAfterFailure(3)).toBe("failed");
  });
});

describe("processDataExportJob", () => {
  it("builds, uploads, marks ready with a 7-day expiry and emails a tokenised link", async () => {
    const { deps, saved } = makeDeps();
    const status = await processDataExportJob(job, deps);
    expect(status).toBe("ready");
    expect(saved[0].status).toBe("ready");
    expect(saved[0].expiresAt.getTime()).toBe(NOW.getTime() + DATA_EXPORT_LINK_TTL_MS);
    const call = (deps.sendEmail as any).mock.calls[0][0];
    const token = new URL(call.downloadUrl).searchParams.get("token")!;
    expect(isValidTokenShape(token)).toBe(true);
    expect(saved[0].downloadTokenHash).toBe(hashDownloadToken(token));
    expect(saved[0].downloadTokenHash).not.toContain(token);
    expect(saved[saved.length - 1].emailedAt).toEqual(NOW);
  });

  it("mailer unconfigured: stays ready for in-app download and sends nothing", async () => {
    const { deps, saved } = makeDeps({ mailerConfigured: () => false });
    const status = await processDataExportJob(job, deps);
    expect(status).toBe("ready");
    expect(deps.sendEmail).not.toHaveBeenCalled();
    expect(saved).toHaveLength(1);
    expect(saved[0].emailedAt).toBeNull();
  });

  it("email send failure does not lose the export", async () => {
    const { deps, saved, failures } = makeDeps({ sendEmail: vi.fn(async () => false) });
    expect(await processDataExportJob(job, deps)).toBe("ready");
    expect(failures).toHaveLength(0);
    expect(saved).toHaveLength(1);
  });

  it("a build failure requeues on attempt 1 and fails on attempt 3", async () => {
    const boom = vi.fn(async () => { throw new Error("db down"); });
    const a = makeDeps({ buildExport: boom });
    expect(await processDataExportJob({ ...job, attempts: 1 }, a.deps)).toBe("queued");
    expect(a.failures[0]).toEqual({ status: "queued", error: "db down" });
    const b = makeDeps({ buildExport: boom });
    expect(await processDataExportJob({ ...job, attempts: 3 }, b.deps)).toBe("failed");
  });

  it("builds the link on the API download path", () => {
    expect(downloadUrlFor("https://brandthread.app", "abc")).toBe("https://brandthread.app/api/auth/data-export/download?token=abc");
  });
});

describe("download token", () => {
  it("is 256-bit hex and hashed with sha256", () => {
    const token = generateDownloadToken();
    expect(isValidTokenShape(token)).toBe(true);
    expect(hashDownloadToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDownloadToken(token)).not.toBe(token);
    expect(isValidTokenShape("short")).toBe(false);
    expect(isValidTokenShape(undefined)).toBe(false);
  });
  it("expires after the ttl and only while ready", () => {
    const expiresAt = new Date(NOW.getTime() + DATA_EXPORT_LINK_TTL_MS);
    expect(isDownloadable({ status: "ready", expiresAt }, NOW)).toBe(true);
    expect(isDownloadable({ status: "ready", expiresAt }, new Date(expiresAt.getTime() - 1))).toBe(true);
    expect(isDownloadable({ status: "ready", expiresAt }, expiresAt)).toBe(false);
    expect(isDownloadable({ status: "expired", expiresAt }, NOW)).toBe(false);
    expect(isDownloadable({ status: "ready", expiresAt: null }, NOW)).toBe(false);
  });
});

describe("rate limit window", () => {
  it("one request per 24 hours", () => {
    expect(nextExportRequestAt(null, NOW)).toBeNull();
    expect(nextExportRequestAt(new Date(NOW.getTime() - 23 * 3600_000), NOW)).not.toBeNull();
    expect(nextExportRequestAt(new Date(NOW.getTime() - 24 * 3600_000), NOW)).toBeNull();
  });
});

describe("mailer unconfigured", () => {
  const original = process.env.RESEND_API_KEY;
  beforeEach(() => { delete process.env.RESEND_API_KEY; });
  afterEach(() => { if (original) process.env.RESEND_API_KEY = original; });
  it("reports unconfigured and the send helper returns false without throwing", async () => {
    expect(isMailerConfigured()).toBe(false);
    await expect(sendDataExportReadyEmail({ to: "a@b.co", downloadUrl: "https://x", expiresAt: NOW })).resolves.toBe(false);
  });
});
