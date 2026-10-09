/**
 * Pure helpers for Stripe Connect Express onboarding: requirement -> step
 * mapping, hosted-link selection, redirect allow-listing and the signed state
 * token used by the unauthenticated Stripe redirect endpoints. No Stripe / DB
 * imports so every branch is unit-testable.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type StepId = "identity" | "bank_account" | "tax_info";
export type StepStatus = "complete" | "needed" | "in_review";

export interface ConnectStep {
  id: StepId;
  label: string;
  status: StepStatus;
  /** Short line under the label (what Stripe still needs, or "Verified"). */
  detail: string;
  /** Stripe requirement ids currently blocking (or under review for) this step. */
  requirements: string[];
  /** True when Stripe marks any of them past due. */
  pastDue: boolean;
  /** Requirement ids Stripe will ask for later (future_requirements). */
  upcoming: string[];
}

export interface RequirementsLike {
  currently_due?: string[] | null;
  eventually_due?: string[] | null;
  past_due?: string[] | null;
  pending_verification?: string[] | null;
  disabled_reason?: string | null;
  current_deadline?: number | null;
  errors?: Array<{ requirement?: string; code?: string; reason?: string }> | null;
}

export interface AccountLike {
  details_submitted?: boolean | null;
  charges_enabled?: boolean | null;
  payouts_enabled?: boolean | null;
  requirements?: RequirementsLike | null;
  future_requirements?: RequirementsLike | null;
}

export const STEP_LABELS: Record<StepId, string> = {
  identity: "Identity",
  bank_account: "Bank account",
  tax_info: "Tax info",
};

const STEP_IDLE_DETAIL: Record<StepId, string> = {
  identity: "Confirm who you are",
  bank_account: "Where payouts are sent",
  tax_info: "SSN or EIN for your W-9",
};

/** Map one Stripe requirement id (e.g. "individual.dob.day") to a setup step. */
export function stepForRequirement(id: string): StepId {
  if (/external_account|bank_account/.test(id)) return "bank_account";
  if (/tax_id|ssn_last_4|id_number|vat_id/.test(id)) return "tax_info";
  return "identity";
}

/** Short seller-facing label for a requirement id. */
export function requirementShortLabel(id: string): string {
  if (/external_account|bank_account/.test(id)) return "Bank account details";
  if (/ssn_last_4/.test(id)) return "Last 4 of SSN";
  if (/id_number|tax_id|vat_id/.test(id)) return "Tax ID (SSN, ITIN or EIN)";
  if (/verification\.document|verification\.additional_document/.test(id)) return "Photo ID";
  if (/dob\./.test(id)) return "Date of birth";
  if (/address\./.test(id)) return "Home address";
  if (/first_name|last_name|\.name$/.test(id)) return "Legal name";
  if (/phone/.test(id)) return "Phone number";
  if (/email/.test(id)) return "Email";
  if (/business_profile\.(url|product_description)/.test(id)) return "Business description";
  if (/business_profile/.test(id)) return "Business details";
  if (/tos_acceptance/.test(id)) return "Accept Stripe's terms";
  if (/relationship|representative|owners|directors|executives/.test(id)) return "Business contacts";
  if (/company\./.test(id)) return "Company information";
  if (/individual\./.test(id)) return "Personal information";
  return id.replace(/[._]/g, " ");
}

const uniq = (xs: string[]) => [...new Set(xs)];

function summarize(ids: string[]): string {
  const labels = uniq(ids.map(requirementShortLabel));
  if (labels.length <= 2) return labels.join(" and ");
  return `${labels.slice(0, 2).join(", ")} and ${labels.length - 2} more`;
}

/**
 * Build the ordered identity / bank / tax checklist from a Stripe account.
 * `hasBankAccount` comes from the external-account list (last4 present).
 */
export function buildConnectSteps(account: AccountLike | null, opts: { hasBankAccount?: boolean } = {}): ConnectStep[] {
  const ids: StepId[] = ["identity", "bank_account", "tax_info"];
  if (!account) {
    return ids.map((id) => ({
      id, label: STEP_LABELS[id], status: "needed" as const, detail: STEP_IDLE_DETAIL[id],
      requirements: [], pastDue: false, upcoming: [],
    }));
  }
  const req = account.requirements ?? {};
  const due = uniq([...(req.currently_due ?? []), ...(req.past_due ?? [])]);
  const past = new Set(req.past_due ?? []);
  const pending = uniq(req.pending_verification ?? []);
  const future = uniq([
    ...(account.future_requirements?.currently_due ?? []),
    ...(account.future_requirements?.eventually_due ?? []),
  ]);
  const rejected = typeof req.disabled_reason === "string" && req.disabled_reason.startsWith("rejected");
  const submitted = account.details_submitted === true;

  return ids.map((id) => {
    const mine = (xs: string[]) => xs.filter((x) => stepForRequirement(x) === id);
    const needs = mine(due);
    const reviewing = mine(pending);
    const upcoming = mine(future);
    const errors = (req.errors ?? [])
      .map((e) => e.requirement)
      .filter((r): r is string => typeof r === "string" && stepForRequirement(r) === id);
    let status: StepStatus = "complete";
    let detail = "Verified";
    if (needs.length > 0 || errors.length > 0) {
      status = "needed";
      detail = summarize(needs.length ? needs : errors);
    } else if (reviewing.length > 0) {
      status = "in_review";
      detail = "Stripe is reviewing this";
    } else if (id === "bank_account" && opts.hasBankAccount === false) {
      status = "needed";
      detail = submitted ? "Add a payout bank account" : STEP_IDLE_DETAIL[id];
    } else if (!submitted) {
      status = "needed";
      detail = STEP_IDLE_DETAIL[id];
    } else if (id === "identity" && rejected) {
      status = "needed";
      detail = "Stripe could not verify your details";
    } else if (id === "tax_info") {
      detail = "W-9 on file. Stripe files your 1099";
    }
    return {
      id, label: STEP_LABELS[id], status, detail,
      requirements: status === "needed" ? needs : status === "in_review" ? reviewing : [],
      pastDue: needs.some((n) => past.has(n)),
      upcoming,
    };
  });
}

export type SetupState = "not_started" | "in_progress" | "in_review" | "complete" | "restricted";

export function deriveSetupState(account: AccountLike | null, steps: ConnectStep[]): SetupState {
  if (!account) return "not_started";
  const active = account.charges_enabled === true && account.payouts_enabled === true;
  if (active && steps.every((s) => s.status === "complete")) return "complete";
  if (steps.some((s) => s.status === "needed")) {
    return account.details_submitted === true ? "restricted" : "in_progress";
  }
  if (steps.some((s) => s.status === "in_review")) return "in_review";
  // Everything submitted and nothing due, but Stripe has not enabled payouts yet.
  return active ? "complete" : "in_review";
}

export function deadlineIso(account: AccountLike | null): string | null {
  const d = account?.requirements?.current_deadline;
  return typeof d === "number" && d > 0 ? new Date(d * 1000).toISOString() : null;
}

export type HostedLinkKind = "account_onboarding" | "login_link";

/**
 * Express accounts: Stripe's `account_update` links are Custom-only, so an
 * Express seller who never finished, or has requirements outstanding, gets
 * `account_onboarding`; a fully submitted account with nothing due gets a
 * login link to the Express dashboard (where the W-9 and 1099s live).
 */
export function selectHostedLink(account: AccountLike): HostedLinkKind {
  const req = account.requirements;
  const outstanding = (req?.currently_due?.length ?? 0) + (req?.past_due?.length ?? 0) > 0
    || Boolean(req?.disabled_reason && !req.disabled_reason.startsWith("requirements.pending"));
  if (account.details_submitted !== true || outstanding) return "account_onboarding";
  return "login_link";
}

// ── Redirect allow-list ──────────────────────────────────────────────────────

export const APP_SCHEME = "brandthread";
export const APP_RETURN_DEEP_LINK = `${APP_SCHEME}://payout-setup?returned=1`;
export const APP_REFRESH_DEEP_LINK = `${APP_SCHEME}://payout-setup?refresh=1`;

/** Returns the URL when it is https on an allow-listed origin, else null. */
export function allowListedRedirect(value: unknown, allowedOrigins: string[]): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  return allowedOrigins.includes(url.origin) ? url.toString() : null;
}

// ── Signed state for the unauthenticated Stripe redirects ───────────────────

export function signConnectState(clerkUserId: string, secret: string, nowMs = Date.now(), ttlMs = 24 * 3600_000): string {
  const body = Buffer.from(JSON.stringify({ u: clerkUserId, e: nowMs + ttlMs })).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyConnectState(token: unknown, secret: string, nowMs = Date.now()): string | null {
  if (typeof token !== "string" || token.length > 1024) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof parsed.u !== "string" || typeof parsed.e !== "number" || parsed.e < nowMs) return null;
    return parsed.u;
  } catch {
    return null;
  }
}

// ── Webhook transition ──────────────────────────────────────────────────────

/** Notify the seller only on a transition into a worse state, never on repeats. */
export function shouldNotifyRestricted(prev: string | null | undefined, next: string, pastDue: string[]): boolean {
  if (next === "restricted" && prev !== "restricted") return true;
  if (prev === "active" && next !== "active") return true;
  return pastDue.length > 0 && prev !== next;
}
