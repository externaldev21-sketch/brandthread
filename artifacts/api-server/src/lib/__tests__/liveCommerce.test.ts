import { describe, expect, it } from "vitest";
import {
  REMINDER_LEAD_MS, applyPin, reminderCopy, reminderDue, sanitizeProductTags, validateScheduleInput,
} from "../liveCommerce";

const NOW = new Date("2026-10-01T12:00:00Z");
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

describe("applyPin", () => {
  const tags = [
    { productId: "a", productName: "A", priceCents: 1000, highlighted: true },
    { productId: "b", productName: "B", priceCents: 2000 },
  ];
  it("pins a tagged product and moves the legacy highlight with it", () => {
    const r = applyPin(tags, "b");
    expect(r).toMatchObject({ ok: true, pinnedProductId: "b" });
    if (r.ok) expect(r.productTags.map((t) => t.highlighted)).toEqual([false, true]);
  });
  it("refuses a product that is not tagged on the live", () => {
    expect(applyPin(tags, "zzz")).toMatchObject({ ok: false });
  });
  it("unpins with null and clears every highlight", () => {
    const r = applyPin(tags, null);
    expect(r).toMatchObject({ ok: true, pinnedProductId: null });
    if (r.ok) expect(r.productTags.every((t) => t.highlighted === false)).toBe(true);
  });
  it("tolerates a malformed tag list", () => {
    expect(applyPin(null, "a")).toMatchObject({ ok: false });
    expect(applyPin(undefined, null)).toMatchObject({ ok: true, productTags: [] });
  });
});

describe("validateScheduleInput", () => {
  it("accepts a title and a future time, trimming text", () => {
    const r = validateScheduleInput({ title: "  Fall drop  ", startsAt: at(3_600_000), description: " hi " }, NOW);
    expect(r).toMatchObject({ ok: true, title: "Fall drop", description: "hi" });
  });
  it("requires a title and a valid time", () => {
    expect(validateScheduleInput({ startsAt: at(3_600_000) }, NOW)).toMatchObject({ ok: false });
    expect(validateScheduleInput({ title: "x" }, NOW)).toMatchObject({ ok: false });
    expect(validateScheduleInput({ title: "x", startsAt: "not a date" }, NOW)).toMatchObject({ ok: false });
  });
  it("rejects past or near-immediate times and anything over 60 days out", () => {
    expect(validateScheduleInput({ title: "x", startsAt: at(-1000) }, NOW)).toMatchObject({ ok: false });
    expect(validateScheduleInput({ title: "x", startsAt: at(10_000) }, NOW)).toMatchObject({ ok: false });
    expect(validateScheduleInput({ title: "x", startsAt: at(61 * 86_400_000) }, NOW)).toMatchObject({ ok: false });
  });
  it("caps title and description length", () => {
    expect(validateScheduleInput({ title: "x".repeat(81), startsAt: at(3_600_000) }, NOW)).toMatchObject({ ok: false });
    expect(validateScheduleInput({ title: "x", description: "y".repeat(201), startsAt: at(3_600_000) }, NOW)).toMatchObject({ ok: false });
  });
});

describe("sanitizeProductTags", () => {
  it("keeps only tags with a product id, dedupes, and clamps price", () => {
    const out = sanitizeProductTags([
      { productId: "a", productName: "A", priceCents: 500, evil: "x" },
      { productId: "a" },
      { productName: "no id" },
      { productId: "b", priceCents: -5 },
      null,
    ]);
    expect(out).toEqual([
      { productId: "a", productName: "A", priceCents: 500 },
      { productId: "b", productName: "Product", priceCents: 0 },
    ]);
  });
  it("returns [] for non-arrays", () => {
    expect(sanitizeProductTags("nope")).toEqual([]);
  });
});

describe("reminderDue", () => {
  const base = { status: "scheduled", reminderSentAt: null as Date | null };
  it("is due inside the lead window, not before", () => {
    expect(reminderDue({ ...base, startsAt: new Date(NOW.getTime() + REMINDER_LEAD_MS - 1000) }, NOW)).toBe(true);
    expect(reminderDue({ ...base, startsAt: new Date(NOW.getTime() + REMINDER_LEAD_MS + 60_000) }, NOW)).toBe(false);
  });
  it("is due right at and shortly after start if the job was late", () => {
    expect(reminderDue({ ...base, startsAt: new Date(NOW.getTime() - 5 * 60_000) }, NOW)).toBe(true);
    expect(reminderDue({ ...base, startsAt: new Date(NOW.getTime() - 3 * 3_600_000) }, NOW)).toBe(false);
  });
  it("never fires twice or for lives that are no longer scheduled", () => {
    const startsAt = new Date(NOW.getTime() + 60_000);
    expect(reminderDue({ ...base, startsAt, reminderSentAt: NOW }, NOW)).toBe(false);
    expect(reminderDue({ ...base, startsAt, status: "live" }, NOW)).toBe(false);
    expect(reminderDue({ ...base, startsAt, status: "cancelled" }, NOW)).toBe(false);
  });
});

describe("reminderCopy", () => {
  it("names the minutes remaining", () => {
    expect(reminderCopy("Fall drop", new Date(NOW.getTime() + 600_000), NOW).body).toBe("Fall drop starts in 10 minutes.");
    expect(reminderCopy("Fall drop", new Date(NOW.getTime() + 20_000), NOW).body).toBe("Fall drop starts in a minute.");
  });
});
