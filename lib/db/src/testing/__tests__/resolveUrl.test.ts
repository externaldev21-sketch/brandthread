import { describe, expect, it } from "vitest";
import { deriveTestDatabaseUrl, resolveTestDatabaseUrl } from "../resolveUrl";

describe("resolveTestDatabaseUrl", () => {
  it("is unavailable (non-fatal) when nothing is configured", () => {
    const result = resolveTestDatabaseUrl({ databaseUrl: undefined, testDatabaseUrl: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fatal).toBe(false);
  });

  it("derives <db>_test from DATABASE_URL when TEST_DATABASE_URL is absent", () => {
    const result = resolveTestDatabaseUrl({
      databaseUrl: "postgres://user:pass@localhost:5432/brandthread",
      testDatabaseUrl: undefined,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(new URL(result.url).pathname).toBe("/brandthread_test");
  });

  it("uses TEST_DATABASE_URL verbatim when it differs from DATABASE_URL", () => {
    const result = resolveTestDatabaseUrl({
      databaseUrl: "postgres://user:pass@localhost:5432/brandthread",
      testDatabaseUrl: "postgres://user:pass@localhost:5432/brandthread_test",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe("postgres://user:pass@localhost:5432/brandthread_test");
  });

  it("hard-fails when TEST_DATABASE_URL equals DATABASE_URL", () => {
    const result = resolveTestDatabaseUrl({
      databaseUrl: "postgres://user:pass@localhost:5432/brandthread",
      testDatabaseUrl: "postgres://user:pass@localhost:5432/brandthread",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fatal).toBe(true);
  });

  it("hard-fails when TEST_DATABASE_URL points at the same host/db with different credentials", () => {
    const result = resolveTestDatabaseUrl({
      databaseUrl: "postgres://alice:secret@db.internal:5432/brandthread",
      testDatabaseUrl: "postgres://bob:other@db.internal:5432/brandthread",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fatal).toBe(true);
  });

  it("is ok with only TEST_DATABASE_URL set and no DATABASE_URL", () => {
    const result = resolveTestDatabaseUrl({
      databaseUrl: undefined,
      testDatabaseUrl: "postgres://user:pass@localhost:5432/brandthread_test",
    });
    expect(result.ok).toBe(true);
  });

  it("appends a second suffix if DATABASE_URL already ends with _test", () => {
    const url = deriveTestDatabaseUrl("postgres://u:p@h:5432/already_test");
    expect(new URL(url).pathname).toBe("/already_test_test2");
  });
});
