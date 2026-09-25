/**
 * Startup env var validation.
 *
 * Fails fast with a clear message when a var the server cannot run without
 * is missing, instead of booting successfully and then throwing (or silently
 * misbehaving) on the first request that needs it. Called once from
 * src/index.ts before the HTTP server starts listening.
 */
import { logger } from "./logger";

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
  "AGORA_APP_ID",
  "AGORA_APP_CERTIFICATE",
  "AI_INTEGRATIONS_OPENAI_API_KEY",
  "GOOGLE_MAPS_API_KEY",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "REVENUECAT_PROJECT_ID",
  "REVENUECAT_WEBHOOK_AUTHORIZATION",
  "SHIPPO_WEBHOOK_SECRET",
];

/**
 * Throws with every missing required var listed at once (not one at a time)
 * so a misconfigured environment can be fixed in a single pass.
 */
export function validateEnv(): void {
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

  const missingOptional = OPTIONAL_VARS.filter((name) => !process.env[name]?.trim());
  if (missingOptional.length > 0) {
    logger.warn(
      { missing: missingOptional },
      "Optional environment variable(s) not set — the features that depend on them will be disabled",
    );
  }
}
