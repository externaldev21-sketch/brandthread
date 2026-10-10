import OpenAI from "openai";

/**
 * Where the OpenAI credentials come from. Two setups are accepted:
 *
 *   1. Replit AI integration: AI_INTEGRATIONS_OPENAI_API_KEY together with
 *      AI_INTEGRATIONS_OPENAI_BASE_URL (both are provisioned by Replit).
 *   2. A standard OpenAI key on any host: OPENAI_API_KEY, with an optional
 *      OPENAI_BASE_URL (defaults to https://api.openai.com/v1).
 *
 * Nothing here runs at import time, so a server without either setup still
 * boots; only the AI features that need a client fail, with a clear error.
 */
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

export type OpenAiConfigSource = "replit_integration" | "openai_api_key";

export interface OpenAiConfig {
  apiKey: string;
  baseURL: string;
  source: OpenAiConfigSource;
}

type Env = Record<string, string | undefined>;

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** The credentials to use, or null when no AI provider is configured. */
export function resolveOpenAiConfig(env: Env = process.env): OpenAiConfig | null {
  const integrationKey = clean(env.AI_INTEGRATIONS_OPENAI_API_KEY);
  const integrationBase = clean(env.AI_INTEGRATIONS_OPENAI_BASE_URL);
  if (integrationKey && integrationBase) {
    return { apiKey: integrationKey, baseURL: integrationBase, source: "replit_integration" };
  }
  const apiKey = clean(env.OPENAI_API_KEY);
  if (apiKey) {
    return { apiKey, baseURL: clean(env.OPENAI_BASE_URL) ?? DEFAULT_OPENAI_BASE_URL, source: "openai_api_key" };
  }
  return null;
}

export function isOpenAiConfigured(env: Env = process.env): boolean {
  return resolveOpenAiConfig(env) !== null;
}

export class OpenAiNotConfiguredError extends Error {
  readonly code = "OPENAI_NOT_CONFIGURED";
  constructor() {
    super(
      "OpenAI is not configured. Set OPENAI_API_KEY (and optionally OPENAI_BASE_URL), " +
        "or AI_INTEGRATIONS_OPENAI_API_KEY with AI_INTEGRATIONS_OPENAI_BASE_URL on Replit.",
    );
    this.name = "OpenAiNotConfiguredError";
  }
}

/** Creates a new client from the current env, or throws OpenAiNotConfiguredError. */
export function createOpenAiClient(env: Env = process.env): OpenAI {
  const config = resolveOpenAiConfig(env);
  if (!config) throw new OpenAiNotConfiguredError();
  return new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
}

/**
 * An `OpenAI`-shaped object that creates the real client on first use
 * (`lazy.chat.completions.create(...)`). Importing a module that holds one
 * never throws; the first call without credentials throws
 * OpenAiNotConfiguredError. `onCreate` runs once on the new client (used to
 * attach usage metering).
 */
export function lazyOpenAiClient(onCreate?: (client: OpenAI) => void): OpenAI {
  let client: OpenAI | null = null;
  const get = (): OpenAI => {
    if (!client) {
      const created = createOpenAiClient();
      onCreate?.(created);
      client = created;
    }
    return client;
  };
  return new Proxy({} as OpenAI, {
    get(_target, prop) {
      const real = get() as unknown as Record<PropertyKey, unknown>;
      const value = real[prop];
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(real) : value;
    },
    has(_target, prop) {
      return prop in (get() as object);
    },
  });
}
