import { describe, expect, it } from "vitest";
import { buildPoolConfig } from "../../poolConfig";

describe("buildPoolConfig", () => {
  it("is just the connection string when nothing is set (previous behavior)", () => {
    expect(buildPoolConfig("postgres://x/y", {})).toEqual({ connectionString: "postgres://x/y" });
  });

  it("applies every knob", () => {
    expect(
      buildPoolConfig("postgres://x/y", {
        DB_POOL_MAX: "25",
        DB_POOL_IDLE_MS: "30000",
        DB_CONNECT_TIMEOUT_MS: "5000",
        DB_STATEMENT_TIMEOUT_MS: "15000",
        DB_IDLE_IN_TX_TIMEOUT_MS: "10000",
      }),
    ).toEqual({
      connectionString: "postgres://x/y",
      max: 25,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 15000,
      idle_in_transaction_session_timeout: 10000,
    });
  });

  it("ignores blank, zero, negative, fractional and non-numeric values", () => {
    expect(
      buildPoolConfig("postgres://x/y", {
        DB_POOL_MAX: "", DB_POOL_IDLE_MS: "0", DB_CONNECT_TIMEOUT_MS: "-5",
        DB_STATEMENT_TIMEOUT_MS: "1.5", DB_IDLE_IN_TX_TIMEOUT_MS: "abc",
      }),
    ).toEqual({ connectionString: "postgres://x/y" });
  });

  it("applies production defaults (BT-474)", () => {
    expect(buildPoolConfig("postgres://x/y", { NODE_ENV: "production" })).toEqual({
      connectionString: "postgres://x/y",
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      statement_timeout: 15000,
      idle_in_transaction_session_timeout: 60000,
    });
    expect(buildPoolConfig("postgres://x/y", { DB_POOL_DEFAULTS: "on" })).toMatchObject({ statement_timeout: 15000 });
    expect(buildPoolConfig("postgres://x/y", { NODE_ENV: "production", DB_POOL_DEFAULTS: "off" })).toEqual({
      connectionString: "postgres://x/y",
    });
  });

  it("env overrides each production default, and 0/off turns one off", () => {
    expect(
      buildPoolConfig("postgres://x/y", {
        NODE_ENV: "production",
        DB_POOL_MAX: "4",
        DB_STATEMENT_TIMEOUT_MS: "off",
        DB_IDLE_IN_TX_TIMEOUT_MS: "0",
      }),
    ).toEqual({
      connectionString: "postgres://x/y",
      max: 4,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  });
});
