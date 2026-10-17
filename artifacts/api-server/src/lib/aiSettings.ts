/**
 * Per-account Brandthread AI settings (the AI Settings screen), persisted in
 * seller_settings.settings->'ai' (migration 270).
 *
 * The server is the source of truth for the toggles that change what the AI
 * is allowed to see or do:
 *  - enabled=false            → /ai/chat and /ai/chat/stream refuse (409)
 *  - suggestionsEnabled=false → /ai/suggestions returns []
 *  - brandMemoryEnabled=false → client-sent brand memory is ignored
 *  - dataSources.<x>=false    → that part of the seller snapshot is withheld
 *                               from the model (applyDataSourceSettings)
 * sessionMemoryEnabled and the four confirm* flags are honoured by the app
 * (local conversation storage and the confirm dialog before applying an AI
 * action); they are stored here so they follow the account across devices.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { SellerSnapshot } from "./sellerSnapshot";

export const AI_DATA_SOURCES = [
  "products", "orders", "inventory", "analytics", "customers",
  "content", "manufacturers", "store", "marketing",
] as const;
export type AIDataSource = (typeof AI_DATA_SOURCES)[number];

export interface AISettings {
  enabled: boolean;
  suggestionsEnabled: boolean;
  sessionMemoryEnabled: boolean;
  brandMemoryEnabled: boolean;
  confirmSensitiveActions: boolean;
  confirmDestructiveActions: boolean;
  confirmPublishing: boolean;
  confirmSending: boolean;
  dataSources: Record<AIDataSource, boolean>;
}

const BOOLEAN_KEYS = [
  "enabled", "suggestionsEnabled", "sessionMemoryEnabled", "brandMemoryEnabled",
  "confirmSensitiveActions", "confirmDestructiveActions", "confirmPublishing", "confirmSending",
] as const;

export const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: true,
  suggestionsEnabled: true,
  sessionMemoryEnabled: true,
  brandMemoryEnabled: true,
  confirmSensitiveActions: true,
  confirmDestructiveActions: true,
  confirmPublishing: true,
  confirmSending: true,
  dataSources: Object.fromEntries(AI_DATA_SOURCES.map((k) => [k, true])) as Record<AIDataSource, boolean>,
};

/**
 * Merge an untrusted partial over `base`, keeping only known boolean keys.
 * Unknown keys and non-boolean values are dropped, never stored.
 */
export function normalizeAISettings(input: unknown, base: AISettings = DEFAULT_AI_SETTINGS): AISettings {
  const out: AISettings = { ...base, dataSources: { ...base.dataSources } };
  if (!input || typeof input !== "object") return out;
  const raw = input as Record<string, unknown>;
  for (const key of BOOLEAN_KEYS) {
    if (typeof raw[key] === "boolean") out[key] = raw[key] as boolean;
  }
  const ds = raw.dataSources;
  if (ds && typeof ds === "object") {
    for (const key of AI_DATA_SOURCES) {
      const v = (ds as Record<string, unknown>)[key];
      if (typeof v === "boolean") out.dataSources[key] = v;
    }
  }
  return out;
}

export async function loadAISettings(ownerId: string): Promise<AISettings> {
  const result = await db.execute(sql`
    SELECT settings->'ai' AS ai FROM seller_settings WHERE owner_id = ${ownerId}
  `);
  const row = result.rows[0] as { ai?: unknown } | undefined;
  return normalizeAISettings(row?.ai ?? null);
}

/** Like loadAISettings, but a storage failure falls back to the defaults. */
export async function loadAISettingsOrDefault(ownerId: string): Promise<AISettings> {
  try {
    return await loadAISettings(ownerId);
  } catch {
    return normalizeAISettings(null);
  }
}

export async function saveAISettings(ownerId: string, partial: unknown): Promise<AISettings> {
  const current = await loadAISettings(ownerId);
  const next = normalizeAISettings(partial, current);
  const patch = JSON.stringify({ ai: next });
  await db.execute(sql`
    INSERT INTO seller_settings (owner_id, settings, updated_at)
    VALUES (${ownerId}, ${patch}::jsonb, now())
    ON CONFLICT (owner_id) DO UPDATE
      SET settings   = seller_settings.settings || ${patch}::jsonb,
          updated_at = now()
  `);
  return next;
}

/** Which snapshot sections each AI Settings data-source toggle controls. */
export const DATA_SOURCE_SNAPSHOT_KEYS: Record<AIDataSource, (keyof SellerSnapshot)[]> = {
  products:      ["products"],
  orders:        ["orders"],
  inventory:     ["inventory"],
  analytics:     ["revenue"],
  customers:     ["customers", "conversations"],
  content:       ["content"],
  manufacturers: ["manufacturerOrders"],
  store:         ["storefront", "shipping"],
  marketing:     ["boosts", "discountCodes"],
};

export const EXCLUDED_BY_SETTINGS = "excluded_by_seller_ai_settings";

/**
 * Returns a copy of the snapshot with every section whose data source is
 * switched off replaced by an explicit exclusion marker, plus the list of
 * excluded source names so the system prompt can tell the model why.
 */
export function applyDataSourceSettings(
  snapshot: SellerSnapshot,
  dataSources: Record<AIDataSource, boolean>,
): { snapshot: Record<string, unknown>; excluded: AIDataSource[] } {
  const out: Record<string, unknown> = { ...snapshot };
  const excluded: AIDataSource[] = [];
  for (const source of AI_DATA_SOURCES) {
    if (dataSources[source] !== false) continue;
    excluded.push(source);
    for (const key of DATA_SOURCE_SNAPSHOT_KEYS[source]) out[key] = EXCLUDED_BY_SETTINGS;
  }
  return { snapshot: out, excluded };
}
