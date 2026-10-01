import { describe, expect, it } from "vitest";
import { assertStagingIsSafe, resolveAppEnv, stagingSafetyProblems } from "../appEnv";

describe("resolveAppEnv", () => {
  it("follows NODE_ENV when APP_ENV is unset, so existing deployments are unchanged", () => {
    expect(resolveAppEnv({ NODE_ENV: "production" })).toBe("production");
    expect(resolveAppEnv({ NODE_ENV: "development" })).toBe("development");
    expect(resolveAppEnv({})).toBe("development");
  });

  it("lets APP_ENV select staging on a production build", () => {
    expect(resolveAppEnv({ NODE_ENV: "production", APP_ENV: "Staging" })).toBe("staging");
  });

  it("ignores unknown values", () => {
    expect(resolveAppEnv({ NODE_ENV: "production", APP_ENV: "qa" })).toBe("production");
  });
});

describe("staging safety", () => {
  const safe = {
    APP_ENV: "staging",
    STRIPE_SECRET_KEY: "sk_test_123",
    CLERK_SECRET_KEY: "sk_test_abc",
    CLERK_PUBLISHABLE_KEY: "pk_test_abc",
    DATABASE_URL: "postgres://staging",
  };

  it("accepts test credentials", () => {
    expect(stagingSafetyProblems(safe)).toEqual([]);
    expect(() => assertStagingIsSafe(safe)).not.toThrow();
  });

  it("refuses live Stripe and Clerk keys", () => {
    const problems = stagingSafetyProblems({
      ...safe,
      STRIPE_SECRET_KEY: "sk_live_123",
      CLERK_SECRET_KEY: "sk_live_abc",
      CLERK_PUBLISHABLE_KEY: "pk_live_abc",
    });
    expect(problems).toHaveLength(3);
    expect(() => assertStagingIsSafe({ ...safe, STRIPE_SECRET_KEY: "rk_live_1" })).toThrow(/staging/);
  });

  it("refuses the production database", () => {
    expect(
      stagingSafetyProblems({ ...safe, PRODUCTION_DATABASE_URL: "postgres://staging" }),
    ).toHaveLength(1);
  });

  it("never blocks production or development", () => {
    const live = { STRIPE_SECRET_KEY: "sk_live_123", CLERK_SECRET_KEY: "sk_live_abc" };
    expect(stagingSafetyProblems({ ...live, NODE_ENV: "production" })).toEqual([]);
    expect(stagingSafetyProblems({ ...live, APP_ENV: "development" })).toEqual([]);
  });
});
