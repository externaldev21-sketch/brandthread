/**
 * aiSettings.ts
 *
 * Pure policy helpers for the seller's AI Settings (persisted per account in
 * `ai_assistant_settings`, migration 116). Everything here is side-effect
 * free so it can be unit tested without a database:
 *
 *  - normalizeAiSettings()      — coerce any stored / client JSON into a full,
 *                                 strictly-boolean settings object.
 *  - mergeStricter()            — combine the stored settings with the ones a
 *                                 client sends on a request. A client can only
 *                                 ever make the policy STRICTER (turn things
 *                                 off / add confirmations), never looser, so a
 *                                 stale or tampered client cannot re-enable a
 *                                 data source the seller turned off.
 *  - redactSnapshotForAi()      — drop every snapshot section that belongs to
 *                                 a disabled data source before it reaches the
 *                                 model.
 *  - sanitizeScreenContext()    — strip screen-context details (customer name,
 *                                 order number, …) that belong to a disabled
 *                                 data source.
 *  - actionConfirmationReason() — which confirm-before-action rule (if any)
 *                                 applies to an assistant action card.
 *  - suggestionCategoryAllowed()— whether a dashboard suggestion category may
 *                                 be produced under the current data sources.
 */

export const AI_DATA_SOURCE_KEYS = [
  "products",
  "orders",
  "inventory",
  "analytics",
  "customers",
  "content",
  "manufacturers",
  "store",
  "marketing",
] as const;

export type AiDataSourceKey = (typeof AI_DATA_SOURCE_KEYS)[number];
export type AiDataSources = Record<AiDataSourceKey, boolean>;

export interface AiAssistantSettings {
  enabled: boolean;
  suggestionsEnabled: boolean;
  sessionMemoryEnabled: boolean;
  brandMemoryEnabled: boolean;
  confirmSensitiveActions: boolean;
  confirmDestructiveActions: boolean;
  confirmPublishing: boolean;
  confirmSending: boolean;
  dataSources: AiDataSources;
}

/** "Off" switches — false is the restrictive value. */
const PERMISSION_KEYS = [
  "enabled",
  "suggestionsEnabled",
  "sessionMemoryEnabled",
  "brandMemoryEnabled",
] as const;

/** Confirm-before-action switches — true is the restrictive value. */
const CONFIRM_KEYS = [
  "confirmSensitiveActions",
  "confirmDestructiveActions",
  "confirmPublishing",
  "confirmSending",
] as const;

export const DEFAULT_AI_ASSISTANT_SETTINGS: AiAssistantSettings = {
  enabled: true,
  suggestionsEnabled: true,
  sessionMemoryEnabled: true,
  brandMemoryEnabled: true,
  confirmSensitiveActions: true,
  confirmDestructiveActions: true,
  confirmPublishing: true,
  confirmSending: true,
  dataSources: {
    products: true,
    orders: true,
    inventory: true,
    analytics: true,
    customers: true,
    content: true,
    manufacturers: true,
    store: true,
    marketing: true,
  },
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/**
 * Returns a complete settings object. Unknown keys are dropped, non-boolean
 * values fall back to the defaults, missing data sources default to on.
 */
export function normalizeAiSettings(raw: unknown): AiAssistantSettings {
  const src = isRecord(raw) ? raw : {};
  const d = DEFAULT_AI_ASSISTANT_SETTINGS;
  const dsRaw = isRecord(src.dataSources) ? src.dataSources : {};
  const dataSources = {} as AiDataSources;
  for (const k of AI_DATA_SOURCE_KEYS) dataSources[k] = bool(dsRaw[k], d.dataSources[k]);

  const out = { ...d, dataSources } as AiAssistantSettings;
  for (const k of PERMISSION_KEYS) out[k] = bool(src[k], d[k]);
  for (const k of CONFIRM_KEYS) out[k] = bool(src[k], d[k]);
  return out;
}

/**
 * Combine stored (account) settings with settings sent by the client on a
 * request. Only values the client explicitly sends are considered, and each
 * one can only tighten the stored policy.
 */
export function mergeStricter(stored: AiAssistantSettings, requested: unknown): AiAssistantSettings {
  if (!isRecord(requested)) return stored;
  const out: AiAssistantSettings = { ...stored, dataSources: { ...stored.dataSources } };
  for (const k of PERMISSION_KEYS) {
    if (requested[k] === false) out[k] = false;
  }
  for (const k of CONFIRM_KEYS) {
    if (requested[k] === true) out[k] = true;
  }
  if (isRecord(requested.dataSources)) {
    for (const k of AI_DATA_SOURCE_KEYS) {
      if (requested.dataSources[k] === false) out.dataSources[k] = false;
    }
  }
  return out;
}

export function disabledDataSources(settings: AiAssistantSettings): AiDataSourceKey[] {
  return AI_DATA_SOURCE_KEYS.filter((k) => !settings.dataSources[k]);
}

// ─── Snapshot redaction ───────────────────────────────────────────────────────

/**
 * Which data sources a snapshot section depends on. A section is dropped when
 * ANY of its sources is off (e.g. revenue is derived from orders and is an
 * analytics figure, so turning off either removes it).
 */
export const SNAPSHOT_SECTION_SOURCES: Record<string, AiDataSourceKey[]> = {
  storefront: ["store"],
  shipping: ["store"],
  products: ["products"],
  inventory: ["inventory"],
  orders: ["orders"],
  revenue: ["orders", "analytics"],
  content: ["content"],
  customers: ["customers"],
  conversations: ["customers"],
  boosts: ["marketing"],
  discountCodes: ["marketing"],
  manufacturerOrders: ["manufacturers"],
};

export function redactSnapshotForAi<T extends { snapshotAt: string }>(
  snapshot: T,
  settings: AiAssistantSettings,
): Record<string, unknown> & { snapshotAt: string } {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(snapshot)) {
    const sources = SNAPSHOT_SECTION_SOURCES[key];
    if (sources && sources.some((s) => !settings.dataSources[s])) continue;
    out[key] = value;
  }
  return out as Record<string, unknown> & { snapshotAt: string };
}

// ─── Screen context ───────────────────────────────────────────────────────────

/** The data source a screen's details come from. */
const SCREEN_SOURCE: Record<string, AiDataSourceKey> = {
  products: "products",
  product_detail: "products",
  orders: "orders",
  order_detail: "orders",
  analytics: "analytics",
  store_builder: "store",
  content: "content",
  inventory: "inventory",
  manufacturer_hub: "manufacturers",
  marketing: "marketing",
  customers: "customers",
};

/**
 * Removes screen-context details that belong to a disabled data source.
 * When the screen's own source is off, only `screen` and a `restricted` flag
 * survive. Otherwise cross-source fields are stripped individually
 * (customer name on an order → customers, stock on a product → inventory).
 */
export function sanitizeScreenContext(
  context: Record<string, unknown> | undefined,
  settings: AiAssistantSettings,
): Record<string, unknown> {
  const ctx = isRecord(context) ? context : {};
  const screen = typeof ctx.screen === "string" ? ctx.screen : "general";
  const source = SCREEN_SOURCE[screen];
  if (source && !settings.dataSources[source]) {
    return { screen, restricted: true };
  }
  const out: Record<string, unknown> = { ...ctx, screen };
  if (!settings.dataSources.customers) {
    delete out.customerName;
    delete out.customerId;
  }
  if (!settings.dataSources.inventory) delete out.inventory;
  return out;
}

// ─── Action confirmations ─────────────────────────────────────────────────────

export type AiConfirmationReason = "destructive" | "publishing" | "sending" | "sensitive";

/** Action types that change account data when applied. */
const MUTATING_ACTION_TYPES = new Set([
  "edit", "apply", "create_draft", "duplicate", "schedule", "export",
]);

const PUBLISH_RE = /\b(publish|publishing|go live|goes live|make (?:it )?live|launch)\b/i;
const SEND_RE = /\b(send|sending|email|e-mail|sms|text message|notify|notification|dm)\b/i;

export interface ActionCardLike {
  type?: unknown;
  title?: unknown;
  description?: unknown;
  isDestructive?: unknown;
  requiresConfirmation?: unknown;
}

/**
 * The confirm-before-action rule that applies to this card under the given
 * settings, or null when it may be applied without a confirmation step.
 * Checked most-severe first so the dialog copy names the strongest reason.
 */
export function actionConfirmationReason(
  card: ActionCardLike,
  settings: AiAssistantSettings,
): AiConfirmationReason | null {
  const type = typeof card.type === "string" ? card.type : "";
  const text = `${typeof card.title === "string" ? card.title : ""} ${typeof card.description === "string" ? card.description : ""}`;

  if (card.isDestructive === true && settings.confirmDestructiveActions) return "destructive";
  if ((type === "schedule" || PUBLISH_RE.test(text)) && settings.confirmPublishing) return "publishing";
  if (SEND_RE.test(text) && settings.confirmSending) return "sending";
  if ((MUTATING_ACTION_TYPES.has(type) || card.requiresConfirmation === true) && settings.confirmSensitiveActions) {
    return "sensitive";
  }
  return null;
}

/** Stamps `requiresConfirmation` on a model-produced card from the seller's rules. */
export function applyConfirmationPolicy<T extends ActionCardLike>(
  card: T,
  settings: AiAssistantSettings,
): T & { requiresConfirmation: boolean } {
  return { ...card, requiresConfirmation: actionConfirmationReason(card, settings) !== null };
}

// ─── Suggestions ──────────────────────────────────────────────────────────────

const SUGGESTION_CATEGORY_SOURCE: Record<string, AiDataSourceKey> = {
  inventory: "inventory",
  orders: "orders",
  content: "content",
  marketing: "marketing",
  store: "store",
  customers: "customers",
  production: "manufacturers",
  analytics: "analytics",
};

export function suggestionCategoryAllowed(category: string, settings: AiAssistantSettings): boolean {
  if (!settings.enabled || !settings.suggestionsEnabled) return false;
  const source = SUGGESTION_CATEGORY_SOURCE[category];
  return source ? settings.dataSources[source] : true;
}

// ─── Prompt copy ──────────────────────────────────────────────────────────────

const SOURCE_LABEL: Record<AiDataSourceKey, string> = {
  products: "products",
  orders: "orders and revenue",
  inventory: "inventory",
  analytics: "analytics and revenue",
  customers: "customers and customer conversations",
  content: "content and posts",
  manufacturers: "manufacturers and production",
  store: "store and shipping",
  marketing: "marketing, boosts and discount codes",
};

/** System-prompt line describing the areas the seller has turned off, or "". */
export function dataSourcePromptNote(settings: AiAssistantSettings): string {
  const off = disabledDataSources(settings);
  if (off.length === 0) return "";
  return [
    `The seller has turned off AI access to: ${off.map((k) => SOURCE_LABEL[k]).join("; ")}.`,
    "That data is not in the snapshot. Do not reference, infer, or estimate anything about those areas;",
    "if asked, say AI access to that area is turned off in AI Settings.",
  ].join(" ");
}
