/**
 * AI credits catalogue: THE one place a product decision can change.
 *
 *  - PLAN_CREDIT_POLICY   what each seller plan gets
 *  - AI_TOOL_RULES        which endpoints cost credits (and which are free text)
 *  - CREDIT_PACKS         top-up packs (Starter / Growth only)
 *  - getSpendCaps()       emergency spend cap, hidden fair-use and anti-abuse limits
 *
 * Credits are tied to the seller plan (planCatalogue: Starter $29, Growth $79,
 * Pro $199). One credit is roughly $0.01 of provider cost, so a 2-credit
 * background removal is about two cents and a 50-credit video about fifty.
 */

export type AiCreditPlan = "free" | "starter" | "growth" | "pro";

export type PlanCreditPolicy = {
  /** Credits granted each UTC month. `null` means unlimited (Pro). */
  monthlyAllowance: number | null;
  /** Unused monthly credits carry over one month (never above one allowance). */
  rollover: boolean;
  /** May buy credit packs. */
  packsEligible: boolean;
};

export const PLAN_CREDIT_POLICY: Record<AiCreditPlan, PlanCreditPolicy> = {
  // No active paid plan: no credits (chat is never charged).
  free:    { monthlyAllowance: 0,    rollover: false, packsEligible: false },
  starter: { monthlyAllowance: 1000, rollover: true,  packsEligible: true },
  growth:  { monthlyAllowance: 4000, rollover: true,  packsEligible: true },
  // Unlimited. Hidden fair-use limits live in getSpendCaps().
  pro:     { monthlyAllowance: null, rollover: false, packsEligible: false },
};

export function creditPolicyForPlan(plan: AiCreditPlan): PlanCreditPolicy {
  return PLAN_CREDIT_POLICY[plan] ?? PLAN_CREDIT_POLICY.free;
}

/** Derived from PLAN_CREDIT_POLICY. `null` is unlimited: display code treats it as Infinity. */
export const MONTHLY_ALLOWANCE: Record<AiCreditPlan, number | null> = {
  free: PLAN_CREDIT_POLICY.free.monthlyAllowance,
  starter: PLAN_CREDIT_POLICY.starter.monthlyAllowance,
  growth: PLAN_CREDIT_POLICY.growth.monthlyAllowance,
  pro: PLAN_CREDIT_POLICY.pro.monthlyAllowance,
};

export type AiToolRule = {
  method: "GET" | "POST";
  /** Matched against the request path below /api (and /api/v1). */
  path: RegExp;
  tool: string;
  label: string;
  /**
   * 'credits' debits `cost` credits before the handler and refunds on failure.
   * 'text' is free on every plan: never debited, never shown, only subject to
   * the silent anti-abuse ceiling.
   */
  kind: "credits" | "text";
  cost: number;
};

const text = (path: RegExp, tool: string, label: string): AiToolRule =>
  ({ method: "POST", path, tool, label, kind: "text", cost: 0 });
const gen = (path: RegExp, tool: string, label: string, cost: number): AiToolRule =>
  ({ method: "POST", path, tool, label, kind: "credits", cost });

/**
 * Every endpoint that calls an AI provider. Generations cost credits (about
 * one cent each); text is free. The gate refunds automatically if a handler
 * answers with an error status, so routes never need their own billing code.
 */
export const AI_TOOL_RULES: AiToolRule[] = [
  // ── Text: free on every plan ──────────────────────────────────────────────
  text(/^\/ai\/chat(\/stream)?$/,                 "ai_chat",      "AI assistant"),
  text(/^\/ai\/brand-memory\/rebuild$/,           "brand_memory", "Brand memory"),
  text(/^\/brandthread-agent\/(chat|message)s?$/, "agent_chat",   "Brandthread agent"),
  text(/^\/store\/ai\//,                          "store_ai",     "Store AI"),

  // ── Image generation ──────────────────────────────────────────────────────
  gen(/^\/bg-removal\/remove$/,                   "bg_remove",    "Remove background",     2),
  gen(/^\/bg-removal\/replace$/,                  "bg_replace",   "Replace background",    4),
  gen(/^\/photography\/generate$/,                "photoshoot",   "AI photoshoot",         8),
  gen(/^\/photography\/(mockup-to-model|outfit-swap)$/, "model_photo", "Mockup to model",  8),
  gen(/^\/mockup\/generate$/,                     "mockup",       "Mockup",                5),
  gen(/^\/logo\/(generate|logo)$/,                "logo",         "Logo",                  5),
  gen(/^\/lifestyle\/generate$/,                  "lifestyle",    "Lifestyle image",       6),
  gen(/^\/techpack\/generate$/,                   "techpack",     "Tech pack",             4),

  // ── Routes that land with their features. Adjust the path here if the final
  //    route differs; nothing else needs to change. ─────────────────────────
  gen(/^\/ai-design\/generate$/,                  "ai_design",         "AI design",           5),
  gen(/^\/ai-design\/(refine|variation)s?$/,      "ai_design_refine",  "AI design refine",    4),
  gen(/^\/campaign(-gen)?\/generate$/,            "campaign_gen",      "Campaign set",       10),
  gen(/^\/video\/generate$/,                      "video_gen",         "AI video",           50),
];

export function findToolRule(method: string, path: string): AiToolRule | null {
  return AI_TOOL_RULES.find((r) => r.method === method.toUpperCase() && r.path.test(path)) ?? null;
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

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export type SpendCaps = {
  /** Emergency stop for all AI spend, in credits per UTC day. */
  globalDaily: number;
  /** Percent-of-cap levels that raise an alert, ascending. */
  alertThresholds: number[];
  /** Hidden: Pro generations per UTC day per user. */
  proDailyGenerations: number;
  /** Hidden: credits-worth a Pro user generates per month before jobs use the slow queue. */
  proFairUseCredits: number;
  /** Max Pro low-priority jobs running at once, across the server. */
  lowPriorityConcurrency: number;
  /** How long a low-priority job waits for a slot before it runs anyway. */
  lowPriorityWaitMs: number;
  /** Silent per-user ceiling for free text (chat) requests per UTC day. */
  textDailyPerUser: number;
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
    proDailyGenerations: intEnv("AI_PRO_DAILY_GENERATION_CEILING", 400),
    proFairUseCredits: intEnv("AI_PRO_FAIR_USE_CREDITS", 10_000),
    lowPriorityConcurrency: intEnv("AI_LOW_PRIORITY_CONCURRENCY", 2),
    lowPriorityWaitMs: intEnv("AI_LOW_PRIORITY_WAIT_MS", 10 * 60_000),
    textDailyPerUser: intEnv("AI_TEXT_DAILY_LIMIT_PER_USER", 500),
  };
}

/** Share of the allowance at or below which a balance counts as low. */
export const LOW_CREDITS_FRACTION = 0.2;
