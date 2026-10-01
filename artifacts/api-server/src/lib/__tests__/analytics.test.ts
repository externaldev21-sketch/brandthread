import { afterEach, describe, expect, it, vi } from "vitest";
import { amountBucket, createAnalytics, sanitizeProperties } from "../analytics";

const live = { POSTHOG_API_KEY: "phc_abc123", NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv;

afterEach(() => vi.useRealTimers());

describe("sanitizeProperties", () => {
  it("keeps allow-listed keys and drops everything else", () => {
    const out = sanitizeProperties("purchase_completed", {
      amount_bucket: "50-100",
      currency: "usd",
      email: "a@b.com",
      name: "Jane Doe",
      address: "1 Main St",
    });
    expect(out).toEqual({ amount_bucket: "50-100", currency: "usd" });
  });
  it("drops free text, emails and non-primitive values even under allowed keys", () => {
    const out = sanitizeProperties("purchase_completed", {
      currency: "jane@example.com",
      charge_model: "a long sentence of free text",
      item_count: { nested: 1 },
      is_guest: true,
    });
    expect(out).toEqual({ is_guest: true });
  });
  it("rejects unknown events", () => {
    expect(sanitizeProperties("message_text_sent", { a: 1 })).toBeNull();
    expect(sanitizeProperties("__proto__", {})).toBeNull();
  });
});

describe("amountBucket", () => {
  it("never returns the exact amount", () => {
    expect(amountBucket(1999)).toBe("0-25");
    expect(amountBucket(7500)).toBe("50-100");
    expect(amountBucket(250000)).toBe("1000-plus");
    expect(amountBucket(NaN)).toBe("unknown");
  });
});

describe("createAnalytics", () => {
  it("is a no-op with no key and makes no network call", async () => {
    const fetchImpl = vi.fn();
    const a = createAnalytics({ env: { NODE_ENV: "production" } as never, fetchImpl });
    expect(a.enabled).toBe(false);
    a.capture("purchase_completed", "user_1", { currency: "usd" });
    await a.flush();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("is a no-op in NODE_ENV=test even with a key", async () => {
    const fetchImpl = vi.fn();
    const a = createAnalytics({ env: { ...live, NODE_ENV: "test" } as never, fetchImpl });
    a.capture("purchase_completed", "user_1", {});
    await a.flush();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("treats placeholder keys as unset", () => {
    expect(createAnalytics({ env: { POSTHOG_API_KEY: "replace_me", NODE_ENV: "production" } as never }).enabled).toBe(false);
  });
  it("batches events into one POST to the batch endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const a = createAnalytics({ env: { ...live, POSTHOG_HOST: "https://eu.i.posthog.com/" } as never, fetchImpl, batchSize: 50 });
    a.capture("purchase_completed", "user_1", { currency: "usd", email: "x@y.z" });
    a.capture("purchase_completed", null, { currency: "usd" });
    await a.flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://eu.i.posthog.com/batch/");
    const body = JSON.parse(init.body);
    expect(body.api_key).toBe("phc_abc123");
    expect(body.batch).toHaveLength(2);
    expect(body.batch[0].distinct_id).toBe("user_1");
    expect(JSON.stringify(body)).not.toContain("x@y.z");
    expect(body.batch[1].properties.$process_person_profile).toBe(false);
  });
  it("flushes on a timer without the caller awaiting anything", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const a = createAnalytics({ env: live as never, fetchImpl, flushIntervalMs: 1000 });
    a.capture("purchase_completed", "user_1", {});
    expect(fetchImpl).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1100);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("swallows network failures and synchronous throws", async () => {
    const a = createAnalytics({ env: live as never, fetchImpl: vi.fn().mockRejectedValue(new Error("down")) });
    a.capture("purchase_completed", "user_1", {});
    await expect(a.flush()).resolves.toBeUndefined();
    const b = createAnalytics({ env: live as never, fetchImpl: (() => { throw new Error("boom"); }) as never });
    b.capture("purchase_completed", "user_1", {});
    await expect(b.flush()).resolves.toBeUndefined();
  });
  it("caps the queue so a long outage cannot grow memory", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const a = createAnalytics({ env: live as never, fetchImpl, batchSize: 1000, maxQueue: 3 });
    for (let i = 0; i < 10; i++) a.capture("purchase_completed", `u${i}`, {});
    await a.flush();
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).batch).toHaveLength(3);
  });
});
