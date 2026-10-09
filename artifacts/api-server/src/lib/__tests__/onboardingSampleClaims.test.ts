import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, onboardingAiSampleClaims: {} }));

import {
  IP_SLOTS_PER_DAY,
  OnboardingSampleClaimedError,
  claimOnboardingSampleKeys,
  completeOnboardingSampleKeys,
  hashClaim,
  ipSlotKeys,
  normalizeDeviceId,
  normalizeEmailForClaim,
  personClaimKeys,
  releaseOnboardingSampleKeys,
  type ClaimRow,
  type ClaimStore,
} from "../onboardingSampleClaims";

const LEASE = 15 * 60_000;

/** In-memory store with the same conflict rules as the Postgres upsert. */
function memoryStore() {
  const rows = new Map<string, ClaimRow & { status: "reserved" | "completed" }>();
  const store: ClaimStore = {
    async take(row, leaseCutoff) {
      const existing = rows.get(row.claimKey);
      const reclaimable = !existing
        || (existing.status === "reserved" && existing.accountId === row.accountId)
        || (existing.status === "reserved" && existing.reservedAt < leaseCutoff);
      if (!reclaimable) return false;
      rows.set(row.claimKey, { ...row, status: "reserved" });
      return true;
    },
    async release(reservationId) {
      for (const [k, r] of rows) if (r.reservationId === reservationId && r.status === "reserved") rows.delete(k);
    },
    async complete(reservationId) {
      for (const r of rows.values()) if (r.reservationId === reservationId && r.status === "reserved") r.status = "completed";
    },
  };
  return { store, rows };
}

const DEVICE = "6f1c2a9e-1b2c-4d5e-8f90-a1b2c3d4e5f6";

async function fullSample(store: ClaimStore, accountId: string, opts: { email?: string; deviceId?: string; ip?: string; now?: Date }) {
  const reservationId = `res-${accountId}-${Math.random()}`;
  await claimOnboardingSampleKeys({ accountId, reservationId, leaseMs: LEASE, store, ...opts });
  await completeOnboardingSampleKeys(reservationId, store);
  return reservationId;
}

describe("normalizers", () => {
  it("folds plus-tags and Gmail dots so one inbox is one person", () => {
    expect(normalizeEmailForClaim("Mila.Rose+brand2@GMAIL.com")).toBe("milarose@gmail.com");
    expect(normalizeEmailForClaim("mila.rose@googlemail.com")).toBe("milarose@gmail.com");
    expect(normalizeEmailForClaim("mila.rose+x@studio.co")).toBe("mila.rose@studio.co");
    expect(normalizeEmailForClaim("not-an-email")).toBeNull();
    expect(normalizeEmailForClaim("")).toBeNull();
  });

  it("accepts only install-id shaped device ids", () => {
    expect(normalizeDeviceId(DEVICE.toUpperCase())).toBe(DEVICE);
    expect(normalizeDeviceId("short")).toBeNull();
    expect(normalizeDeviceId("'; drop table x; --")).toBeNull();
    expect(normalizeDeviceId(42)).toBeNull();
  });

  it("never stores raw values", () => {
    const keys = personClaimKeys({ email: "a@b.co", deviceId: DEVICE });
    expect(keys.map((k) => k.kind)).toEqual(["email", "device"]);
    for (const k of keys) {
      expect(k.key).not.toContain("a@b.co");
      expect(k.key).not.toContain(DEVICE);
    }
    expect(hashClaim("email", "a@b.co")).toBe(hashClaim("email", "a@b.co"));
    expect(hashClaim("email", "a@b.co")).not.toBe(hashClaim("device", "a@b.co"));
  });

  it("gives each IP a fixed number of slots per UTC day", () => {
    const day1 = ipSlotKeys("203.0.113.5", new Date("2026-10-09T10:00:00Z"));
    const day2 = ipSlotKeys("203.0.113.5", new Date("2026-10-10T10:00:00Z"));
    expect(day1).toHaveLength(IP_SLOTS_PER_DAY);
    expect(day1.some((k) => day2.includes(k))).toBe(false);
    expect(ipSlotKeys("unknown", new Date())).toEqual([]);
  });
});

describe("claimOnboardingSampleKeys", () => {
  it("blocks a second account on the same device", async () => {
    const { store } = memoryStore();
    await fullSample(store, "user_1", { email: "one@studio.co", deviceId: DEVICE });
    await expect(
      claimOnboardingSampleKeys({ accountId: "user_2", reservationId: "r2", email: "two@studio.co", deviceId: DEVICE, leaseMs: LEASE, store }),
    ).rejects.toMatchObject({ code: "onboarding_sample_used", kind: "device" });
  });

  it("blocks a second account with the same inbox under a plus-tag", async () => {
    const { store } = memoryStore();
    await fullSample(store, "user_1", { email: "mila@gmail.com" });
    await expect(
      claimOnboardingSampleKeys({ accountId: "user_2", reservationId: "r2", email: "m.i.l.a+2@gmail.com", leaseMs: LEASE, store }),
    ).rejects.toBeInstanceOf(OnboardingSampleClaimedError);
  });

  it("caps samples per IP per day even with fresh emails and devices", async () => {
    const { store } = memoryStore();
    const now = new Date("2026-10-09T12:00:00Z");
    for (let i = 0; i < IP_SLOTS_PER_DAY; i++) {
      await fullSample(store, `user_${i}`, { email: `p${i}@x.co`, ip: "198.51.100.7", now });
    }
    await expect(
      claimOnboardingSampleKeys({ accountId: "user_x", reservationId: "rx", email: "new@x.co", ip: "198.51.100.7", now, leaseMs: LEASE, store }),
    ).rejects.toMatchObject({ kind: "ip" });
    // A different network is unaffected.
    await expect(
      claimOnboardingSampleKeys({ accountId: "user_y", reservationId: "ry", email: "y@x.co", ip: "198.51.100.8", now, leaseMs: LEASE, store }),
    ).resolves.toBeUndefined();
  });

  it("releases every key it took when one key conflicts", async () => {
    const { store, rows } = memoryStore();
    await fullSample(store, "user_1", { deviceId: DEVICE });
    const before = rows.size;
    await expect(
      claimOnboardingSampleKeys({ accountId: "user_2", reservationId: "r2", email: "fresh@x.co", deviceId: DEVICE, leaseMs: LEASE, store }),
    ).rejects.toBeInstanceOf(OnboardingSampleClaimedError);
    expect(rows.size).toBe(before);
  });

  it("a failed generation (released) does not use up the device", async () => {
    const { store } = memoryStore();
    await claimOnboardingSampleKeys({ accountId: "user_1", reservationId: "r1", deviceId: DEVICE, leaseMs: LEASE, store });
    await releaseOnboardingSampleKeys("r1", store);
    await expect(
      claimOnboardingSampleKeys({ accountId: "user_2", reservationId: "r2", deviceId: DEVICE, leaseMs: LEASE, store }),
    ).resolves.toBeUndefined();
  });

  it("an in-flight reservation blocks other accounts until its lease expires", async () => {
    const { store } = memoryStore();
    const t0 = new Date("2026-10-09T12:00:00Z");
    await claimOnboardingSampleKeys({ accountId: "user_1", reservationId: "r1", deviceId: DEVICE, now: t0, leaseMs: LEASE, store });
    await expect(
      claimOnboardingSampleKeys({ accountId: "user_2", reservationId: "r2", deviceId: DEVICE, now: new Date(t0.getTime() + 60_000), leaseMs: LEASE, store }),
    ).rejects.toBeInstanceOf(OnboardingSampleClaimedError);
    await expect(
      claimOnboardingSampleKeys({ accountId: "user_2", reservationId: "r3", deviceId: DEVICE, now: new Date(t0.getTime() + LEASE + 1), leaseMs: LEASE, store }),
    ).resolves.toBeUndefined();
  });
});
