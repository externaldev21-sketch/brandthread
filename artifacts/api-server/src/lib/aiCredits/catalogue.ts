/**
 * AI credits catalogue: THE one place a product decision can change.
 *
 *  - PLAN_CREDIT_POLICY   what each seller plan gets
 *  - AI_TOOL_RULES        which endpoints cost credits, which are metered, which are free text
 *  - CREDIT_PACKS         top-up packs (Starter / Growth only)
 *  - getSpendCaps()       emergency spend cap, daily ceilings, trial and past-due limits
 *
 * Credit prices and allowances come from the provider cost table
 * (costTable.ts): one credit never buys more than CREDIT_USD ($0.01) of
 * worst-case provider cost, and each plan's allowance is sized from its
 * planCatalogue price so that a whole month of credits costs under 20% of the
 * price. No plan is unlimited.
 */
import { normalizeGatePath } from "../gatePath";
import type { SellerPlanId } from "../planCatalogue";
import { creditsForTool, maxAllowanceForPlan } from "./costTable";

export type AiCreditPlan = "free" | "starter" | "growth" | "pro";

export type PlanCreditPolicy = {
  /** Credits granted each UTC month once paid (trials and past-due get trialAllowance()). */
  monthlyAllowance: number;
  /** Unused monthly credits carry over one month (never above one allowance). */
  rollover: boolean;
  /** May buy credit packs. */
  packsEligible: boolean;
};

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * AI_MONTHLY_CREDITS_STARTER / _GROWTH / _PRO may lower an allowance; they can
 * never raise it above what the plan price supports (the 20% cost line).
 */
function allowanceFor(plan: SellerPlanId): number {
  const max = maxAllowanceForPlan(plan);
  return Math.min(intEnv(`AI_MONTHLY_CREDITS_${plan.toUpperCase()}`, max), max);
}

export const PLAN_CREDIT_POLICY: Record<AiCreditPlan, PlanCreditPolicy> = {
  // No active paid plan: no credits (chat is never charged).
  free:    { monthlyAllowance: 0,                       rollover: false, packsEligible: false },
  starter: { monthlyAllowance: allowanceFor("starter"), rollover: true,  packsEligible: true },
  growth:  { monthlyAllowance: allowanceFor("growth"),  rollover: true,  packsEligible: true },
  // Finite like every plan: anything that calls a paid provider has a ceiling.
  pro:     { monthlyAllowance: allowanceFor("pro"),     rollover: true,  packsEligible: false },
};

export function creditPolicyForPlan(plan: AiCreditPlan): PlanCreditPolicy {
  return PLAN_CREDIT_POLICY[plan] ?? PLAN_CREDIT_POLICY.free;
}

/** Derived from PLAN_CREDIT_POLICY. */
export const MONTHLY_ALLOWANCE: Record<AiCreditPlan, number> = {
  free: PLAN_CREDIT_POLICY.free.monthlyAllowance,
  starter: PLAN_CREDIT_POLICY.starter.monthlyAllowance,
  growth: PLAN_CREDIT_POLICY.growth.monthlyAllowance,
  pro: PLAN_CREDIT_POLICY.pro.monthlyAllowance,
};

/**
 * Credits a trialing subscription (or a past-due one inside its grace period)
 * gets for the month: AI_TRIAL_CREDITS (default 100), never above the plan's
 * own allowance. The rest of the allowance is topped up once an invoice is paid.
 */
export function trialAllowance(plan: AiCreditPlan): number {
  return Math.min(intEnv("AI_TRIAL_CREDITS", 100), creditPolicyForPlan(plan).monthlyAllowance);
}

export type AiToolRule = {
  method: "GET" | "POST";
  /** Matched against the normalized request path below /api (and /api/v1). */
  path: RegExp;
  tool: string;
  label: string;
  /**
   * 'credits' debits `cost` x units credits before the handler and refunds on failure.
   * 'metered' is free to the user, but adds `cost` credits-worth to the global
   *   emergency cap and counts toward a per-user daily ceiling for that tool.
   * 'text' is free on every plan: never debited, never shown, only subject to
   *   the silent anti-abuse ceiling.
   */
  kind: "credits" | "metered" | "text";
  cost: number;
  /** Billed units in one request (references, garments); `cost` is per unit. */
  units?: (body: unknown) => number;
  /** Upper bound for `units`, matching the route's own validation. */
  maxUnits?: number;
  /** 'metered' only: calls per user per UTC day, read at call time. */
  dailyLimit?: () => number;
};

const text = (path: RegExp, tool: string, label: string): AiToolRule =>
  ({ method: "POST", path, tool, label, kind: "text", cost: 0 });
const gen = (path: RegExp, tool: string, label: string, extra: Partial<AiToolRule> = {}): AiToolRule =>
  ({ method: "POST", path, tool, label, kind: "credits", cost: creditsForTool(tool), ...extra });
const metered = (path: RegExp, tool: string, label: string, dailyLimit: () => number): AiToolRule =>
  ({ method: "POST", path, tool, label, kind: "metered", cost: creditsForTool(tool), dailyLimit });

const arrayLength = (key: string) => (body: unknown): number => {
  const value = body && typeof body === "object" ? (body as Record<string, unknown>)[key] : undefined;
  return Array.isArray(value) ? value.length : 1;
};

/**
 * Every endpoint that calls an AI provider. Generations cost credits (priced
 * from costTable.ts); metered tools are free but capped; text is free. The
 * gate refunds automatically if a handler answers with an error status, so
 * routes never need their own billing code.
 */
export const AI_TOOL_RULES: AiToolRule[] = [
  // ── Metered: free to the user, capped per day, counted toward the global cap
  metered(/^\/support-chat\/message$/,  "support_chat",      "Support chat",           () => getSpendCaps().supportChatDailyPerUser),
  metered(/^\/store\/ai\//,              "store_ai",          "Store AI",               () => getSpendCaps().storeAiDailyPerUser),
  // The single free onboarding logo (routes/logo.ts onboardingSampleRouter).
  metered(/^\/onboarding-sample\/logo$/, "onboarding_sample", "Onboarding sample logo", () => getSpendCaps().onboardingSampleDailyPerUser),

  // ── Text: free on every plan ──────────────────────────────────────────────
  text(/^\/ai\/chat(\/stream)?$/,                 "ai_chat",      "AI assistant"),
  text(/^\/ai\/brand-memory\/rebuild$/,           "brand_memory", "Brand memory"),
  text(/^\/brandthread-agent\/(chat|message)s?$/, "agent_chat",   "Brandthread agent"),
  text(/^\/ai-helpers\/caption$/,                 "ai_caption",   "Caption and hashtags"),
  text(/^\/ai-helpers\/product-description$/,     "ai_product_description", "Product description"),
  text(/^\/ai-helpers\/size-chart$/,              "ai_size_chart", "Size chart"),

  // ── Image generation ──────────────────────────────────────────────────────
  gen(/^\/bg-removal\/remove$/,                   "bg_remove",    "Remove background"),
  gen(/^\/bg-removal\/replace$/,                  "bg_replace",   "Replace background"),
  gen(/^\/photography\/generate$/,                "photoshoot",   "AI photoshoot"),
  // Charged per reference / garment: each one is its own generation with visual QA.
  gen(/^\/photography\/mockup-to-model$/,         "model_photo",  "Mockup to model (per photo)", { units: arrayLength("references"), maxUnits: 5 }),
  gen(/^\/photography\/outfit-swap$/,             "model_photo",  "Mockup to model (per photo)", { units: arrayLength("garmentImages"), maxUnits: 4 }),
  gen(/^\/photography\/(mockup-to-model|outfit-swap)\/retry$/, "model_photo", "Mockup to model (per photo)"),
  gen(/^\/mockup\/generate$/,                     "mockup",       "Mockup"),
  gen(/^\/logo\/generate$/,                       "logo",         "Logo"),
  gen(/^\/lifestyle\/generate$/,                  "lifestyle",    "Lifestyle image"),
  gen(/^\/techpack\/generate$/,                   "techpack",     "Tech pack"),

  // ── Routes that land with their features. Adjust the path here if the final
  //    route differs; nothing else needs to change. ─────────────────────────
  gen(/^\/ai-design\/generate$/,                  "ai_design",         "AI design"),
  gen(/^\/ai-design\/(refine|variation)s?$/,      "ai_design_refine",  "AI design refine"),
  gen(/^\/campaign(-gen)?\/generate$/,            "campaign_gen",      "Campaign set"),
  gen(/^\/video\/generate$/,                      "video_gen",         "AI video"),
];

/**
 * The path is normalized first (case, repeated and trailing slashes): Express
 * routes `/Logo/Generate/` to the same handler as `/logo/generate`.
 */
export function findToolRule(method: string, path: string): AiToolRule | null {
  const normalized = normalizeGatePath(path);
  return AI_TOOL_RULES.find((r) => r.method === method.toUpperCase() && r.path.test(normalized)) ?? null;
}

/**
 * res.locals key a multi-output handler (Mockup to Model, Outfit Swap) sets
 * when it answers 200 with some outputs failed: the gate gives those units back.
 */
export const AI_FAILED_UNITS_LOCAL = "aiCreditFailedUnits";

/** Billed units for one request, clamped to [1, maxUnits]. */
export function unitsFor(rule: AiToolRule, body: unknown): number {
  if (!rule.units) return 1;
  const n = rule.units(body);
  return Number.isInteger(n) && n > 0 ? Math.min(n, rule.maxUnits ?? 1) : 1;
}

/** One entry per credit tool (several rules can share a tool), for display. */
export function creditToolPrices(): Array<{ tool: string; label: string; cost: number }> {
  const seen = new Map<string, { tool: string; label: string; cost: number }>();
  for (const r of AI_TOOL_RULES) {
    if (r.kind === "credits" && !seen.has(r.tool)) seen.set(r.tool, { tool: r.tool, label: r.label, cost: r.cost });
  }
  return [...seen.values()];
}

export type CreditPack = { id: string; credits: number; amountCents: number; label: string };

/** Starter / Growth only. Prices are proposals (about 1.2 cents per credit, cheaper in bulk). */
export const CREDIT_PACKS: CreditPack[] = [
  { id: "credits_500",  credits: 500,  amountCents: 599,  label: "500 credits" },
  { id: "credits_1500", credits: 1500, amountCents: 1499, label: "1,500 credits" },
  { id: "credits_5000", credits: 5000, amountCents: 4499, label: "5,000 credits" },
];

export function findPack(id: string): CreditPack | null {
  return CREDIT_PACKS.find((p) => p.id === id) ?? null;
}

/** Packs a plan may buy (empty for Pro and for accounts without a paid plan). */
export function packsForPlan(plan: AiCreditPlan): CreditPack[] {
  return creditPolicyForPlan(plan).packsEligible ? CREDIT_PACKS : [];
}

export type SpendCaps = {
  /** Emergency stop for all AI spend, in credits per UTC day. */
  globalDaily: number;
  /** Percent-of-cap levels that raise an alert, ascending. */
  alertThresholds: number[];
  /** Generation units (each reference or garment is one) per user per UTC day on a paid plan. */
  dailyGenerations: number;
  /** Generation units per user per UTC day while trialing or past due. */
  trialDailyGenerations: number;
  /** Days a past-due subscription keeps the reduced allowance before AI tools stop. */
  pastDueGraceDays: number;
  /** Max low-priority jobs running at once, across the server. */
  lowPriorityConcurrency: number;
  /** How long a low-priority job waits for a slot before it runs anyway. */
  lowPriorityWaitMs: number;
  /** Silent per-user ceiling for free text (chat) requests per UTC day. */
  textDailyPerUser: number;
  /** Support chat messages per user per UTC day. */
  supportChatDailyPerUser: number;
  /** Store AI requests per user per UTC day. */
  storeAiDailyPerUser: number;
  /** Onboarding sample attempts per user per UTC day (failed attempts are given back). */
  onboardingSampleDailyPerUser: number;
};

/** Read at call time so tests and env changes take effect without a restart. */
export function getSpendCaps(): SpendCaps {
  const raw = process.env.AI_SPEND_ALERT_THRESHOLDS?.trim();
  const parsed = (raw ? raw.split(",") : ["50", "80", "100"])
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 100);
  return {
    globalDaily: intEnv("AI_GLOBAL_DAILY_CREDIT_CAP", 250_000),
    alertThresholds: [...new Set(parsed)].sort((a, b) => a - b),
    dailyGenerations: intEnv("AI_DAILY_GENERATION_CEILING", 100),
    trialDailyGenerations: intEnv("AI_TRIAL_DAILY_GENERATION_CEILING", 10),
    pastDueGraceDays: intEnv("AI_PAST_DUE_GRACE_DAYS", 3),
    lowPriorityConcurrency: intEnv("AI_LOW_PRIORITY_CONCURRENCY", 2),
    lowPriorityWaitMs: intEnv("AI_LOW_PRIORITY_WAIT_MS", 10 * 60_000),
    textDailyPerUser: intEnv("AI_TEXT_DAILY_LIMIT_PER_USER", 500),
    supportChatDailyPerUser: intEnv("AI_SUPPORT_CHAT_DAILY_LIMIT_PER_USER", 50),
    storeAiDailyPerUser: intEnv("AI_STORE_AI_DAILY_LIMIT_PER_USER", 30),
    onboardingSampleDailyPerUser: intEnv("AI_ONBOARDING_SAMPLE_DAILY_LIMIT_PER_USER", 1),
  };
}

/** Share of the allowance at or below which a balance counts as low. */
export const LOW_CREDITS_FRACTION = 0.2;
