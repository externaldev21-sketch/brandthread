import { describe, expect, it } from "vitest";
import { buildTimelineSteps, sortTimelineEvents } from "../timeline";

const t = (s: string) => new Date(`2026-10-${s}:00.000Z`);

describe("timeline ordering", () => {
  it("orders by time, then lifecycle order, then id", () => {
    const sorted = sortTimelineEvents([
      { id: "c", kind: "won", occurredAt: t("05T10:00") },
      { id: "b", kind: "funds_withdrawn", occurredAt: t("01T10:00") },
      { id: "a", kind: "created", occurredAt: t("01T10:00") },
      { id: "z", kind: "updated", occurredAt: t("03T10:00") },
      { id: "y", kind: "updated", occurredAt: t("03T10:00") },
    ]);
    expect(sorted.map((e) => e.id)).toEqual(["a", "b", "y", "z", "c"]);
  });

  it("does not mutate its input", () => {
    const input = [{ id: "b", kind: "won", occurredAt: t("02T00:00") }, { id: "a", kind: "created", occurredAt: t("01T00:00") }];
    sortTimelineEvents(input);
    expect(input[0].id).toBe("b");
  });
});

describe("timeline steps", () => {
  const base = { createdAt: t("01T10:00"), evidenceDueBy: t("14T10:00"), evidenceSubmittedAt: null as Date | null, events: [] as any[], now: t("02T10:00") };
  const states = (s: ReturnType<typeof buildTimelineSteps>) => s.map((x) => x.state);

  it("needs_response: opened done, evidence due current", () => {
    const steps = buildTimelineSteps({ ...base, status: "needs_response" });
    expect(steps.map((s) => s.key)).toEqual(["opened", "evidence_due", "submitted", "under_review", "outcome"]);
    expect(states(steps)).toEqual(["done", "current", "upcoming", "upcoming", "upcoming"]);
    expect(steps[1].detail).toBe("Due Oct 14");
  });

  it("flags a missed deadline", () => {
    const steps = buildTimelineSteps({ ...base, status: "needs_response", now: t("20T10:00") });
    expect(steps[1].detail).toBe("Was due Oct 14");
  });

  it("under_review", () => {
    const steps = buildTimelineSteps({ ...base, status: "under_review", evidenceSubmittedAt: t("03T10:00") });
    expect(states(steps)).toEqual(["done", "done", "done", "current", "upcoming"]);
    expect(steps[2].at).toBe(t("03T10:00").toISOString());
  });

  it("won and lost after a submission", () => {
    const events = [{ id: "e", kind: "won", occurredAt: t("09T10:00") }];
    const won = buildTimelineSteps({ ...base, status: "won", evidenceSubmittedAt: t("03T10:00"), events });
    expect(states(won)).toEqual(["done", "done", "done", "done", "done"]);
    expect(won[4].label).toBe("Won");
    expect(won[4].at).toBe(t("09T10:00").toISOString());
    const lost = buildTimelineSteps({ ...base, status: "lost", evidenceSubmittedAt: t("03T10:00") });
    expect(lost[4].label).toBe("Lost");
  });

  it("skips submission and review when a dispute ends without evidence", () => {
    const steps = buildTimelineSteps({ ...base, status: "lost" });
    expect(states(steps)).toEqual(["done", "skipped", "skipped", "skipped", "done"]);
  });

  it("treats a stored evidence_submitted event as submitted", () => {
    const steps = buildTimelineSteps({ ...base, status: "under_review", events: [{ id: "s", kind: "evidence_submitted", occurredAt: t("04T10:00") }] });
    expect(steps[2]).toMatchObject({ state: "done", at: t("04T10:00").toISOString() });
  });
});
