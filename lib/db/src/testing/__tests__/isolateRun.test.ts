import { describe, expect, it } from "vitest";
import { isolateTestDatabaseRun } from "../resolveUrl";

describe("non-destructive derived test database isolation", () => {
  it("preserves the server and options while selecting a new safe database", () => {
    const source = "postgres://localhost/original_test?sslmode=disable";
    const result = new URL(isolateTestDatabaseRun(source, "run_123"));
    expect(result.pathname).toBe("/brandthread_test_run_123");
    expect(result.hostname).toBe("localhost");
    expect(result.search).toBe("?sslmode=disable");
    expect(new URL(source).pathname).toBe("/original_test");
  });
  it("produces separate databases for independent runs", () => {
    expect(isolateTestDatabaseRun("postgres://localhost/app_test", "one"))
      .not.toBe(isolateTestDatabaseRun("postgres://localhost/app_test", "two"));
  });
  it.each(["", "a-b", '";DROP DATABASE app;', "a".repeat(41)])("rejects unsafe run IDs: %s", (id) => {
    expect(() => isolateTestDatabaseRun("postgres://localhost/app_test", id)).toThrow();
  });
});
