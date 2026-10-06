/**
 * Config for the social E2E UI harness only (src/__e2e__/*.e2e.ts) — kept
 * out of the default `vitest run` include so CI never starts a long-lived
 * server. Same isolated-test-database guarantees as vitest.config.ts.
 */
import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

export default mergeConfig(base, defineConfig({
  test: {
    include: ["src/__e2e__/**/*.e2e.ts"],
    testTimeout: 6 * 60 * 60 * 1000,
    hookTimeout: 120_000,
  },
}));
