/**
 * Startup env var validation.
 *
 * Fails fast with a clear message when a var the server cannot run without
 * is missing, instead of booting successfully and then throwing (or silently
 * misbehaving) on the first request that needs it. Called once from
 * src/index.ts before the HTTP server starts listening.
 */
import { logger } from "./logger";
import { assertStagingIsSafe, resolveAppEnv } from "./appEnv";
import { isOpenAiConfigured } from "@workspace/integrations-openai-ai-server/config";
import { resolveDsn } from "./monitoring";
import { reportMediaModerationAtBoot } from "./mediaModeration";

type RequiredVar = {
  name: string;
  /** Only enforced when NODE_ENV=production; a helpful warning otherwise. */
  productionOnly?: boolean;
};

// Vars every request path depends on, directly or through a package this
// server imports at module-load time (e.g. @workspace/db reads DATABASE_URL
// when it creates its connection pool).
const REQUIRED_VARS: RequiredVar[] = [
  { name: "PORT" },
  { name: "DATABASE_URL" },
  { name: "CLERK_PUBLISHABLE_KEY" },
  { name: "CLERK_SECRET_KEY" },
  { name: "SESSION_SECRET" },
  { name: "STRIPE_SECRET_KEY", productionOnly: true },
  { name: "STRIPE_WEBHOOK_SECRET", productionOnly: true },
];

// Vars that only degrade a specific feature (push, email, AI photography,
// shipping labels, ...) rather than the whole server, so a missing one is
// worth a warning but never a boot failure.
const OPTIONAL_VARS = [
  "REDIS_URL",
  "AGORA_APP_ID",
  "AGORA_APP_CERTIFICATE",
  "AGORA_CUSTOMER_ID",
  "AGORA_CUSTOMER_SECRET",
  "AGORA_RECORDING_S3_BUCKET",
  "AGORA_RECORDING_S3_REGION",
  "AGORA_RECORDING_S3_ACCESS_KEY",
  "AGORA_RECORDING_S3_SECRET_KEY",
  "AGORA_RECORDING_S3_VENDOR",
  "AGORA_RECORDING_PUBLIC_URL_BASE",
  "GOOGLE_MAPS_API_KEY",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "MAIL_FROM",
  "REVENUECAT_PROJECT_ID",
  "REVENUECAT_WEBHOOK_AUTHORIZATION",
  "SHIPPO_WEBHOOK_SECRET",
  "POSTHOG_API_KEY",
];

// Not needed to boot, and never a boot failure (an existing deploy without
// them keeps running), but production without them is flying blind or
// unmoderated: logged at ERROR level in production (which also reaches
// Sentry when it is configured), WARN elsewhere.
type RecommendedCheck = { name: string; configured: (env: NodeJS.ProcessEnv) => boolean; impact: string };
export const PRODUCTION_RECOMMENDED: RecommendedCheck[] = [
  {
    name: "SENTRY_DSN",
    configured: (env) => resolveDsn(env.SENTRY_DSN) !== null,
    impact: "server errors are not reported (sentry.io: Project Settings > Client Keys (DSN))",
  },
  {
    name: "OPENAI_API_KEY (or AI_INTEGRATIONS_OPENAI_API_KEY + AI_INTEGRATIONS_OPENAI_BASE_URL)",
    configured: (env) => isOpenAiConfigured(env),
    impact: "image/video moderation and AI features are off",
  },
];

export function missingRecommended(env: NodeJS.ProcessEnv = process.env): RecommendedCheck[] {
  return PRODUCTION_RECOMMENDED.filter((check) => !check.configured(env));
}

/**
 * Throws with every missing required var listed at once (not one at a time)
 * so a misconfigured environment can be fixed in a single pass.
 */
export function validateEnv(): void {
  assertStagingIsSafe();
  const appEnv = resolveAppEnv();
  if (appEnv === "staging") logger.warn("Running in STAGING (APP_ENV=staging): test credentials only");
  const isProduction = process.env.NODE_ENV === "production";
  const missing = REQUIRED_VARS.filter(
    (v) => (!v.productionOnly || isProduction) && !process.env[v.name]?.trim(),
  ).map((v) => v.name);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        "The server cannot start without these — see docs/launch/README.md.",
    );
  }

  for (const check of missingRecommended()) {
    const message = `${check.name} is not set: ${check.impact}`;
    if (isProduction) logger.error({ missing: check.name }, message);
    else logger.warn({ missing: check.name }, message);
  }
  reportMediaModerationAtBoot();

  const missingOptional = OPTIONAL_VARS.filter((name) => !process.env[name]?.trim());
  if (missingOptional.length > 0) {
    logger.warn(
      { missing: missingOptional },
      "Optional environment variable(s) not set — the features that depend on them will be disabled",
    );
  }
}
