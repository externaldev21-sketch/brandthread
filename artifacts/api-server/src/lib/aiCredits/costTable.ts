/**
 * AI provider cost table: what one call of each credit tool costs us at worst,
 * and the credit prices and plan allowances derived from it.
 *
 * Every number here is a list price or a documented worst case, so a credit
 * never buys more provider cost than CREDIT_USD. Plan allowances are sized from
 * planCatalogue prices so that a seller who spends a whole month's credits on
 * the most expensive tool still costs less than MAX_AI_COST_SHARE of the plan
 * price (enforced by __tests__/costTable.test.ts for every tier and tool).
 *
 * When a provider price, model, quality, size, or retry count changes, change
 * the recipe here; credits and allowances follow.
 */
import { getImageModelChain } from "@workspace/integrations-openai-ai-server/image-model";
import { AI_IMAGE_MODEL_PRICES, AI_MODEL_PRICES, type ImageModelPrice } from "../admin/aiPricing";
import { PLAN_CATALOGUE, type SellerPlanId } from "../planCatalogue";

/** Most provider cost one credit may buy, in US dollars. */
export const CREDIT_USD = 0.01;
/** Hard ceiling: a tier's full monthly credits may never cost more than this share of its price. */
export const MAX_AI_COST_SHARE = 0.2;
/** Allowances are sized a little under the ceiling. */
export const TARGET_AI_COST_SHARE = 0.19;

// Token assumptions for worst-case image calls.
/** One input image at high input fidelity (1024-1536px), in image-input tokens. */
const INPUT_IMAGE_TOKENS = 6_500;
/** Prompt text sent with an image call (fashion standards + brief). */
const IMAGE_PROMPT_TOKENS = 2_000;
/** Visual QA (lib/integrations-openai-ai-server/src/image/quality.ts): gpt-4o-mini, detail "high". */
const QA_MODEL = "gpt-4o-mini";
/** gpt-4o-mini bills a high-detail 1024px image at about 25.5k input tokens. */
const QA_TOKENS_PER_IMAGE = 25_501;
const QA_TEXT_TOKENS = 1_500;
const QA_OUTPUT_TOKENS = 500;

export type ImageRecipe = {
  kind: "image";
  provider: "openai";
  /** Priced against the most expensive model in the client's chain (OPENAI_IMAGE_MODEL + fallbacks). */
  model: "image-chain";
  operation: "generate" | "edit";
  quality: "low" | "medium" | "high";
  size: "1024x1024";
  /** Input images sent with each attempt (edits). */
  inputImages: number;
  /** Images produced per billed unit. */
  outputs: number;
  /** generateWithVisualQa: one generation plus one correction pass. */
  attempts: number;
  /** Images the QA call inspects per attempt: references plus the candidate. */
  qaImages: number;
};

export type TextRecipe = {
  kind: "text";
  provider: "openai";
  model: string;
  maxInputTokens: number;
  maxOutputTokens: number;
};

export type FlatRecipe = {
  kind: "flat";
  provider: string;
  model: string;
  /** Worst-case list price per call. */
  usdPerCall: number;
  note: string;
};

export type CostRecipe = ImageRecipe | TextRecipe | FlatRecipe;

const image = (r: Omit<ImageRecipe, "kind" | "provider" | "model" | "size" | "quality" | "attempts" | "outputs"> & Partial<Pick<ImageRecipe, "outputs">>): ImageRecipe => ({
  kind: "image", provider: "openai", model: "image-chain", size: "1024x1024", quality: "high", attempts: 2, outputs: 1, ...r,
});

/**
 * One entry per credit tool in AI_TOOL_RULES (and the metered free tools).
 * For per-unit tools (model_photo) the recipe is one unit: one reference or garment.
 */
export const AI_COST_TABLE: Record<string, CostRecipe> = {
  // routes/bg-removal.ts: one edit of the source, QA sees source + result.
  bg_remove:  image({ operation: "edit", inputImages: 1, qaImages: 2 }),
  // Source plus optional background image.
  bg_replace: image({ operation: "edit", inputImages: 2, qaImages: 3 }),
  // routes/photography.ts /generate: up to 4 product photos in one edit.
  photoshoot: image({ operation: "edit", inputImages: 4, qaImages: 5 }),
  // Mockup to Model / Outfit Swap: per reference or garment, mockup + reference.
  model_photo: image({ operation: "edit", inputImages: 2, qaImages: 3 }),
  // routes/mockup.ts: edit of one source image (or a plain generation).
  mockup:     image({ operation: "edit", inputImages: 1, qaImages: 2 }),
  // routes/logo.ts: plain generation.
  logo:       image({ operation: "generate", inputImages: 0, qaImages: 1 }),
  // routes/lifestyle.ts: up to 4 reference + 4 product photos.
  lifestyle:  image({ operation: "edit", inputImages: 8, qaImages: 9 }),
  // routes/techpack.ts: short sanitized notes in, six sections of copy out.
  techpack:   { kind: "text", provider: "openai", model: "gpt-4.1", maxInputTokens: 4_000, maxOutputTokens: 3_000 },
  // Routes that land with their features: priced as the closest existing pipeline.
  ai_design:        image({ operation: "generate", inputImages: 0, qaImages: 1 }),
  ai_design_refine: image({ operation: "edit", inputImages: 1, qaImages: 2 }),
  campaign_gen:     image({ operation: "generate", inputImages: 0, qaImages: 1, outputs: 4 }),
  video_gen: { kind: "flat", provider: "openai", model: "sora-2", usdPerCall: 1.2, note: "$0.10/s list price, 12s max clip" },

  // Metered tools: free to the user, counted toward the global AI spend cap.
  // routes/logo.ts onboardingSampleRouter: the same pipeline as a paid logo.
  onboarding_sample: image({ operation: "generate", inputImages: 0, qaImages: 1 }),
  // routes/support-chat.ts: 12 x 3,000 chars + account context in, 800 tokens out.
  support_chat: { kind: "text", provider: "openai", model: "gpt-5.4-mini", maxInputTokens: 14_000, maxOutputTokens: 800 },
  // routes/store-ai.ts: gpt-5 vision on up to 4 low-detail images, or gpt-4.1 on <= 4KB of answers.
  store_ai:     { kind: "text", provider: "openai", model: "gpt-5", maxInputTokens: 6_000, maxOutputTokens: 1_500 },
};

/** An unpriced model (set by env before aiPricing.ts learns it) is priced as the dearest known one. */
function imageModelPrice(model: string): ImageModelPrice {
  const known = AI_IMAGE_MODEL_PRICES[model];
  if (known) return known;
  const all = Object.values(AI_IMAGE_MODEL_PRICES);
  const max = (pick: (p: ImageModelPrice) => number) => Math.max(...all.map(pick));
  return {
    output: { low: max((p) => p.output.low), medium: max((p) => p.output.medium), high: max((p) => p.output.high) },
    imageInputPerMTok: max((p) => p.imageInputPerMTok),
    textInputPerMTok: max((p) => p.textInputPerMTok),
  };
}

function tokenCost(model: string, input: number, output: number): number {
  const price = AI_MODEL_PRICES[model];
  if (!price) throw new Error(`No token price for ${model}: add it to AI_MODEL_PRICES`);
  return (input * price.input + output * price.output) / 1_000_000;
}

/** One image attempt on one model, in dollars. */
function imageAttemptUsd(r: ImageRecipe, model: string): number {
  const p = imageModelPrice(model);
  return r.outputs * p.output[r.quality]
    + (r.inputImages * INPUT_IMAGE_TOKENS * p.imageInputPerMTok) / 1_000_000
    + (IMAGE_PROMPT_TOKENS * p.textInputPerMTok) / 1_000_000;
}

function qaUsd(r: ImageRecipe): number {
  return r.outputs * tokenCost(QA_MODEL, r.qaImages * QA_TOKENS_PER_IMAGE + QA_TEXT_TOKENS, QA_OUTPUT_TOKENS);
}

/** Worst-case provider cost of one call (one unit for per-unit tools), in dollars. */
export function worstCaseUsd(recipe: CostRecipe, imageModels: string[] = getImageModelChain()): number {
  switch (recipe.kind) {
    case "image": {
      // Any model in the fallback chain may serve the call: price the dearest.
      const attempt = Math.max(...imageModels.map((m) => imageAttemptUsd(recipe, m)));
      return recipe.attempts * (attempt + qaUsd(recipe));
    }
    case "text":
      return tokenCost(recipe.model, recipe.maxInputTokens, recipe.maxOutputTokens);
    case "flat":
      return recipe.usdPerCall;
  }
}

/** Credits for one call (one unit) of a tool: worst-case cost rounded up to whole credits. */
export function creditsForTool(tool: string, imageModels?: string[]): number {
  const recipe = AI_COST_TABLE[tool];
  if (!recipe) throw new Error(`AI tool ${tool} has no cost recipe`);
  return Math.max(1, Math.ceil(worstCaseUsd(recipe, imageModels) / CREDIT_USD - 1e-9));
}

/**
 * Largest monthly allowance a plan price supports at TARGET_AI_COST_SHARE,
 * rounded down to 50 credits.
 */
export function maxAllowanceForPrice(amountCents: number): number {
  const credits = Math.floor(((amountCents / 100) * TARGET_AI_COST_SHARE) / CREDIT_USD);
  return Math.floor(credits / 50) * 50;
}

/** Derived from the plan's price in planCatalogue (the single price source). */
export function maxAllowanceForPlan(plan: SellerPlanId): number {
  return maxAllowanceForPrice(PLAN_CATALOGUE[plan].amountCents);
}
