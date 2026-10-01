/**
 * AI credits catalogue: what each AI tool costs, how many free credits each
 * plan gets per month, the purchasable packs, and the spend-cap config.
 * Everything a product decision can change lives here.
 */

export type AiCreditPlan = "free" | "starter" | "growth" | "pro";

/** Free credits granted each UTC month. Unused monthly credits do not roll over. */
export const MONTHLY_ALLOWANCE: Record<AiCreditPlan, number> = {
  free: 20,
  starter: 50,
  growth: 150,
  pro: 600,
};

export type AiToolRule = {
  method: "GET" | "POST";
  /** Matched against the request path below /api (and /api/v1). */
  path: RegExp;
  tool: string;
  label: string;
  cost: number;
  /** 'text' tools are unlimited on paid plans: never debited (cost 0), only the route rate limit applies. */
  kind?: "text";
};

/**
 * Every endpoint that calls a paid AI provider. The gate debits this cost
 * before the handler runs and refunds it automatically if the handler answers
 * with an error status, so routes never need their own billing code.
 */
export const AI_TOOL_RULES: AiToolRule[] = [
  { method: "POST", path: /^\/ai\/chat(\/stream)?$/,              tool: "ai_chat",          label: "AI assistant",          cost: 1 },
  { method: "POST", path: /^\/ai\/brand-memory\/rebuild$/,        tool: "brand_memory",     label: "Brand memory",          cost: 1 },
  { method: "POST", path: /^\/brandthread-agent\/(chat|message)s?$/, tool: "agent_chat",    label: "Brandthread agent",     cost: 1 },
  { method: "POST", path: /^\/store\/ai\//,                       tool: "store_ai",         label: "Store AI",              cost: 2 },
  { method: "POST", path: /^\/ai-helpers\/caption$/,            tool: "ai_caption",       label: "Caption and hashtags",  cost: 0, kind: "text" },
  { method: "POST", path: /^\/ai-helpers\/product-description$/, tool: "ai_product_description", label: "Product description", cost: 0, kind: "text" },
  { method: "POST", path: /^\/ai-helpers\/size-chart$/,          tool: "ai_size_chart",    label: "Size chart",            cost: 0, kind: "text" },
  { method: "POST", path: /^\/logo\/(generate|logo)$/,            tool: "logo",             label: "Logo",                  cost: 5 },
  { method: "POST", path: /^\/mockup\/generate$/,                 tool: "mockup",           label: "Mockup",                cost: 5 },
  { method: "POST", path: /^\/photography\/generate$/,            tool: "photoshoot",       label: "AI photoshoot",         cost: 8 },
  { method: "POST", path: /^\/photography\/(mockup-to-model|outfit-swap)$/, tool: "model_photo", label: "Model photo",      cost: 10 },
  { method: "POST", path: /^\/lifestyle\/generate$/,              tool: "lifestyle",        label: "Lifestyle image",       cost: 6 },
  { method: "POST", path: /^\/techpack\/generate$/,               tool: "techpack",         label: "Tech pack",             cost: 4 },
  { method: "POST", path: /^\/bg-removal\/remove$/,               tool: "bg_remove",        label: "Remove background",     cost: 2 },
  { method: "POST", path: /^\/bg-removal\/replace$/,              tool: "bg_replace",       label: "Replace background",    cost: 4 },
];

export function findToolRule(method: string, path: string): AiToolRule | null {
  return AI_TOOL_RULES.find((r) => r.method === method.toUpperCase() && r.path.test(path)) ?? null;
}

export type CreditPack = { id: string; credits: number; amountCents: number; label: string };

export const CREDIT_PACKS: CreditPack[] = [
  { id: "credits_100",  credits: 100,  amountCents: 499,  label: "100 credits" },
  { id: "credits_300",  credits: 300,  amountCents: 1299, label: "300 credits" },
  { id: "credits_1000", credits: 1000, amountCents: 3499, label: "1,000 credits" },
];

export function findPack(id: string): CreditPack | null {
  return CREDIT_PACKS.find((p) => p.id === id) ?? null;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export type SpendCaps = {
  perUserDaily: number;
  globalDaily: number;
  /** Percent-of-cap levels that raise an alert, ascending. */
  alertThresholds: number[];
};

/** Read at call time so tests and env changes take effect without a restart. */
export function getSpendCaps(): SpendCaps {
  const raw = process.env.AI_SPEND_ALERT_THRESHOLDS?.trim();
  const parsed = (raw ? raw.split(",") : ["50", "80", "100"])
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 100);
  return {
    perUserDaily: intEnv("AI_DAILY_CREDIT_CAP_PER_USER", 300),
    globalDaily: intEnv("AI_GLOBAL_DAILY_CREDIT_CAP", 100_000),
    alertThresholds: [...new Set(parsed)].sort((a, b) => a - b),
  };
}
