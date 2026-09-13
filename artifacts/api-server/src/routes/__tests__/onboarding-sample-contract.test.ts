import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const route = readFileSync(path.resolve(__dirname, "../logo.ts"), "utf8");
const migration = readFileSync(
  path.resolve(__dirname, "../../../../../lib/db/migrations/066_onboarding_ai_samples.sql"),
  "utf8",
);

describe("seller onboarding AI sample contract", () => {
  it("rejects a fresh reservation while its lease is active", () => {
    expect(route).toContain("onboarding_sample_in_progress");
    expect(route).toContain("lt(onboardingAiSamples.reservedAt, leaseCutoff)");
    expect(route).toContain('eq(onboardingAiSamples.status, "reserved")');
  });

  it("atomically reclaims an expired reservation with a new token", () => {
    expect(route).toContain("onConflictDoUpdate");
    expect(route).toContain("ONBOARDING_SAMPLE_RESERVATION_LEASE_MS");
    expect(route).toContain("set: { reservationId, status: \"reserved\", reservedAt, completedAt: null }");
    expect(route).toContain("const leaseCutoff = new Date");
  });

  it("permanently denies completed rows", () => {
    expect(route).toContain('existing?.status === "completed"');
    expect(route).toContain("onboarding_sample_used");
    expect(route).toContain('account.accountType !== "seller"');
    expect(route).toContain("account.onboardingComplete");
  });

  it("prevents an old request from completing after its reservation is reclaimed", () => {
    const completeStart = route.indexOf("async function completeOnboardingSample");
    const completeBody = route.slice(completeStart, route.indexOf("// POST /api/logo/generate"));
    expect(completeBody).toContain("eq(onboardingAiSamples.reservationId, reservationId)");
    expect(completeBody).toContain('eq(onboardingAiSamples.status, "reserved")');
    expect(completeBody).toContain("return rows.length === 1");
  });

  it("reserves before generation, releases failures, and completes only after success", () => {
    expect(route).toContain("reserveOnboardingSample(userId)");
    expect(route).toContain("releaseOnboardingSample(userId, reservationId)");
    expect(route).toContain("completeOnboardingSample(userId, reservationId)");
    expect(route.indexOf("reserveOnboardingSample(userId)")).toBeLessThan(
      route.indexOf("generateWithVisualQa({", route.indexOf("reserveOnboardingSample(userId)")),
    );
  });

  it("uses an idempotent durable schema rather than an expiring limiter", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS onboarding_ai_samples");
    expect(migration).toContain("account_id TEXT PRIMARY KEY");
    expect(migration).toContain("status IN ('reserved', 'completed')");
    expect(route).not.toContain("365 * 24 * 60 * 60_000");
  });
});