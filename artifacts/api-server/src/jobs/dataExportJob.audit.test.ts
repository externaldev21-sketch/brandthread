import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@workspace/db")>(),
  db: {},
  users: {},
  dataExportJobs: {},
}));
vi.mock("../lib/dataExport", () => ({ buildAccountDataExport: vi.fn() }));
vi.mock("../lib/objectStorage", () => ({ ObjectStorageService: class {} }));

import { processDataExportJob, type ProcessDeps, type ReadyPatch } from "./dataExportJob";

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

describe("processDataExportJob after the export is ready (audit)", () => {
  it("a failing email lookup on the last attempt keeps the job ready instead of failing it", async () => {
    const { deps, saved, failures } = makeDeps({ getEmail: vi.fn(async () => { throw new Error("db blip"); }) });
    const status = await processDataExportJob({ id: "job-1", clerkId: "user_1", categories: ["profile"], attempts: 3 }, deps);
    expect(status).toBe("ready");
    expect(saved).toHaveLength(1);
    expect(saved[0]!.status).toBe("ready");
    expect(failures).toEqual([]);
  });

  it("a failing emailedAt write keeps the job ready", async () => {
    let calls = 0;
    const { deps, failures } = makeDeps({
      saveReady: vi.fn(async () => { calls += 1; if (calls === 2) throw new Error("db blip"); }),
    });
    expect(await processDataExportJob({ id: "job-2", clerkId: "user_1", categories: ["profile"], attempts: 1 }, deps)).toBe("ready");
    expect(failures).toEqual([]);
  });
});
