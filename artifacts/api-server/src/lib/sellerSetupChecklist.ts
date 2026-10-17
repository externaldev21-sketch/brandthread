/**
 * Seller guided-setup checklist (the "Store setup" screen in the mobile app).
 *
 * Tasks that can be read from real account state are DERIVED here and can
 * never be ticked by hand — "Set up payments" is done only when Stripe Connect
 * reports the account active. The few tasks with no server signal
 * (connect_manufacturer) keep a manual completed flag. Per-seller UI state
 * (skips, dismissed tips, walkthrough shown, ...) lives in
 * storefronts.setup_checklist so it follows the seller to a new phone, and the
 * task order is prioritised from the seller's onboarding goals.
 */

export const SETUP_TASK_IDS = [
  "verify_account",
  "connect_payments",
  "first_product",
  "shipping_rates",
  "customize_store",
  "connect_domain",
  "publish_store",
  "first_post",
  "connect_manufacturer",
] as const;

export type SetupTaskId = (typeof SETUP_TASK_IDS)[number];

/** Tasks whose completion comes only from server data. */
export const DERIVED_SETUP_TASK_IDS = [
  "verify_account",
  "connect_payments",
  "first_product",
  "shipping_rates",
  "customize_store",
  "connect_domain",
  "publish_store",
  "first_post",
] as const satisfies readonly SetupTaskId[];

export interface SetupDerivationInput {
  accountType: string | null;
  onboardingComplete: boolean;
  stripeAccountStatus: string | null;
  productCount: number;
  shippingConfigured: boolean;
  logoUrl: string | null;
  verifiedDomain: boolean;
  storePublished: boolean;
  postCount: number;
}

export function deriveSetupTasks(input: SetupDerivationInput): Record<(typeof DERIVED_SETUP_TASK_IDS)[number], boolean> {
  return {
    verify_account: (input.accountType === "seller" || input.accountType === "both") && input.onboardingComplete,
    connect_payments: input.stripeAccountStatus === "active",
    first_product: input.productCount > 0,
    shipping_rates: input.shippingConfigured,
    customize_store: typeof input.logoUrl === "string" && input.logoUrl.trim().length > 0,
    connect_domain: input.verifiedDomain,
    publish_store: input.storePublished,
    first_post: input.postCount > 0,
  };
}

const MAX_GOALS = 20;
const MAX_LIST = 200;

export function normalizeOnboardingGoals(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const g of raw) {
    if (typeof g !== "string") continue;
    const v = g.trim().slice(0, 80);
    if (v && !out.includes(v)) out.push(v);
    if (out.length >= MAX_GOALS) break;
  }
  return out;
}

/** Onboarding goal label → setup tasks it makes more urgent, most urgent first. */
const GOAL_TASKS: Record<string, SetupTaskId[]> = {
  "Launch my store": ["customize_store", "publish_store", "connect_domain"],
  "Grow sales": ["first_product", "connect_payments", "publish_store"],
  "Build content": ["first_post"],
  "Find manufacturers": ["connect_manufacturer"],
  "Manage production": ["connect_manufacturer"],
  "Ship orders": ["shipping_rates"],
  "Manage inventory": ["first_product"],
  "Create designs": ["first_product"],
};

/**
 * Task order for the checklist: account creation stays first, then tasks the
 * seller's goals point at (in goal order), then the rest in default order.
 */
export function orderSetupTasks(goals: string[]): SetupTaskId[] {
  const boosted: SetupTaskId[] = [];
  for (const goal of goals) {
    for (const id of GOAL_TASKS[goal] ?? []) {
      if (id !== "verify_account" && !boosted.includes(id)) boosted.push(id);
    }
  }
  const rest = SETUP_TASK_IDS.filter((id) => id !== "verify_account" && !boosted.includes(id));
  return ["verify_account", ...boosted, ...rest];
}

export interface StoredSetupState {
  started: boolean;
  dismissed: boolean;
  walkthroughShown: boolean;
  celebrated: boolean;
  dismissedTips: string[];
  openedFeatures: string[];
  /** Per task: skipped for any task; completed only for non-derived tasks. */
  tasks: Partial<Record<SetupTaskId, { completed?: boolean; skipped?: boolean }>>;
}

function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 120).slice(0, MAX_LIST);
}

/**
 * Sanitise a stored/submitted setup state. A `completed` flag on a derived task
 * is dropped — those come from the server and cannot be marked by hand.
 */
export function sanitizeSetupState(raw: unknown): StoredSetupState {
  const v = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const rawTasks = v.tasks && typeof v.tasks === "object" && !Array.isArray(v.tasks)
    ? (v.tasks as Record<string, unknown>)
    : {};
  const tasks: StoredSetupState["tasks"] = {};
  for (const id of SETUP_TASK_IDS) {
    const t = rawTasks[id];
    if (!t || typeof t !== "object") continue;
    const entry: { completed?: boolean; skipped?: boolean } = {};
    const rec = t as Record<string, unknown>;
    if (rec.skipped === true) entry.skipped = true;
    if (rec.completed === true && !(DERIVED_SETUP_TASK_IDS as readonly string[]).includes(id)) entry.completed = true;
    if (entry.skipped || entry.completed) tasks[id] = entry;
  }
  return {
    started: v.started === true,
    dismissed: v.dismissed === true,
    walkthroughShown: v.walkthroughShown === true,
    celebrated: v.celebrated === true,
    dismissedTips: stringList(v.dismissedTips),
    openedFeatures: stringList(v.openedFeatures),
    tasks,
  };
}
