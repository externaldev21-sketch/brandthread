/** Timeline ordering and the Opened, Evidence due, Submitted, Under review, Outcome steps. */
import { isFinalDisputeStatus } from "./evidence";

export type TimelineEvent = {
  id: string;
  kind: string;
  occurredAt: Date;
  payload?: Record<string, unknown>;
};

/** Oldest first; ties broken by lifecycle order, then id, so the result is stable. */
const KIND_ORDER = [
  "created", "funds_withdrawn", "evidence_due_soon", "updated", "evidence_submitted",
  "accepted", "funds_reinstated", "won", "lost", "warning_closed",
];

export function sortTimelineEvents<T extends TimelineEvent>(events: T[]): T[] {
  return [...events].sort((a, b) => {
    const dt = a.occurredAt.getTime() - b.occurredAt.getTime();
    if (dt !== 0) return dt;
    const dk = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
    if (dk !== 0) return dk;
    return a.id.localeCompare(b.id);
  });
}

export type StepState = "done" | "current" | "upcoming" | "skipped";
export type TimelineStepKey = "opened" | "evidence_due" | "submitted" | "under_review" | "outcome";
export type TimelineStep = {
  key: TimelineStepKey;
  label: string;
  state: StepState;
  at: string | null;
  detail: string | null;
};

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function buildTimelineSteps(input: {
  status: string;
  createdAt: Date;
  evidenceDueBy: Date | null;
  evidenceSubmittedAt: Date | null;
  events: TimelineEvent[];
  now?: Date;
}): TimelineStep[] {
  const now = input.now ?? new Date();
  const events = sortTimelineEvents(input.events);
  const find = (...kinds: string[]) => events.find((e) => kinds.includes(e.kind));
  const final = isFinalDisputeStatus(input.status);
  const submittedAt = input.evidenceSubmittedAt ?? find("evidence_submitted")?.occurredAt ?? null;
  const submitted = !!submittedAt || input.status === "under_review";
  const outcomeEvent = find("won", "lost", "warning_closed", "accepted");

  const opened: TimelineStep = {
    key: "opened", label: "Dispute opened", state: "done",
    at: (find("created")?.occurredAt ?? input.createdAt).toISOString(), detail: null,
  };

  const pastDue = !!input.evidenceDueBy && input.evidenceDueBy.getTime() < now.getTime();
  const dueState: StepState = submitted ? "done" : final ? "skipped" : "current";
  const evidenceDue: TimelineStep = {
    key: "evidence_due", label: "Evidence due", state: dueState,
    at: input.evidenceDueBy ? input.evidenceDueBy.toISOString() : null,
    detail: input.evidenceDueBy
      ? dueState === "current" && pastDue ? `Was due ${fmtDate(input.evidenceDueBy)}` : `Due ${fmtDate(input.evidenceDueBy)}`
      : null,
  };

  const submittedStep: TimelineStep = {
    key: "submitted", label: "Evidence submitted",
    state: submitted ? "done" : final ? "skipped" : "upcoming",
    at: submittedAt ? submittedAt.toISOString() : null, detail: null,
  };

  const reviewState: StepState = input.status === "under_review"
    ? "current"
    : submitted && final ? "done" : final ? "skipped" : "upcoming";
  const underReview: TimelineStep = {
    key: "under_review", label: "Under review", state: reviewState, at: null, detail: null,
  };

  const outcomeLabel = input.status === "won" ? "Won"
    : input.status === "lost" ? "Lost"
    : input.status === "closed" ? "Closed" : "Outcome";
  const outcome: TimelineStep = {
    key: "outcome", label: outcomeLabel,
    state: final ? "done" : "upcoming",
    at: final && outcomeEvent ? outcomeEvent.occurredAt.toISOString() : null,
    detail: null,
  };

  return [opened, evidenceDue, submittedStep, underReview, outcome];
}
