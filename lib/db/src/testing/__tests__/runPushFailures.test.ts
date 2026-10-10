import { EventEmitter } from "node:events";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  end: vi.fn(),
  spawn: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
}));
vi.mock("pg", () => ({
  default: {
    Client: class {
      connect = vi.fn().mockResolvedValue(undefined);
      query = mocks.query;
      end = mocks.end;
    },
  },
}));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn().mockResolvedValue("/tmp/mock-test-schema"),
  readdir: mocks.readdir,
  readFile: mocks.readFile,
  rm: mocks.rm,
}));
import { runDrizzlePushAgainst } from "../runPush";

function childResult(code: number | null, signal: string | null = null, output = "") {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  });
  queueMicrotask(() => {
    child.stderr.emit("data", Buffer.from(output));
    child.emit("close", code, signal);
  });
  return child;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue({ rows: [] });
  mocks.end.mockResolvedValue(undefined);
  mocks.readdir.mockResolvedValue([]);
  mocks.readFile.mockResolvedValue("");
  mocks.rm.mockResolvedValue(undefined);
});

describe("non-interactive test schema failure handling", () => {
  it("rejects a nonzero CLI exit and rolls back before migrations", async () => {
    mocks.spawn.mockImplementation(() => childResult(1, null, "invalid schema definition"));
    await expect(runDrizzlePushAgainst("postgres://localhost/dedicated_test"))
      .rejects.toThrow(/code 1.*invalid schema definition/s);
    expect(mocks.query).toHaveBeenCalledWith("ROLLBACK");
    expect(mocks.query).not.toHaveBeenCalledWith("COMMIT");
    expect(mocks.end).toHaveBeenCalled();
    expect(mocks.rm).toHaveBeenCalled();
    expect(mocks.spawn.mock.calls[0][2].stdio).toEqual(["ignore", "pipe", "pipe"]);
  });

  it("rejects signal termination rather than treating it as completion", async () => {
    mocks.spawn.mockImplementation(() => childResult(null, "SIGTERM"));
    await expect(runDrizzlePushAgainst("postgres://localhost/dedicated_test"))
      .rejects.toThrow(/code null.*SIGTERM/s);
  });

  it("rejects a zero exit with no SQL and includes the prompt diagnostic", async () => {
    mocks.spawn.mockImplementation(() => childResult(0, null, "Interactive prompts require a TTY terminal"));
    await expect(runDrizzlePushAgainst("postgres://localhost/dedicated_test"))
      .rejects.toThrow(/produced no SQL.*Interactive prompts require a TTY/s);
    expect(mocks.query).not.toHaveBeenCalledWith("COMMIT");
  });

  it("surfaces executable startup failures and still cleans up", async () => {
    mocks.spawn.mockImplementation(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("error", new Error("spawn pnpm ENOENT")));
      return child;
    });
    await expect(runDrizzlePushAgainst("postgres://localhost/dedicated_test"))
      .rejects.toThrow(/pnpm ENOENT/);
    expect(mocks.query).toHaveBeenCalledWith("ROLLBACK");
    expect(mocks.rm).toHaveBeenCalled();
  });

  it("redacts connection URLs from subprocess diagnostics", async () => {
    mocks.spawn.mockImplementation(() => childResult(1, null, "failed postgres://secret:password@host/test"));
    const error = await runDrizzlePushAgainst("postgres://localhost/dedicated_test").catch((error) => error);
    expect(error.message).toContain("[redacted database URL]");
    expect(error.message).not.toContain("secret:password");
  });

  it("rolls back SQL application failures despite successful generation", async () => {
    mocks.spawn.mockImplementation(() => childResult(0));
    mocks.readdir.mockResolvedValue(["base.sql"]);
    mocks.readFile.mockResolvedValue("invalid generated SQL");
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql === "invalid generated SQL") throw new Error("SQL syntax error");
      return { rows: [] };
    });
    await expect(runDrizzlePushAgainst("postgres://localhost/dedicated_test"))
      .rejects.toThrow(/SQL syntax error/);
    expect(mocks.query).toHaveBeenCalledWith("ROLLBACK");
    expect(mocks.query).not.toHaveBeenCalledWith("COMMIT");
  });
});