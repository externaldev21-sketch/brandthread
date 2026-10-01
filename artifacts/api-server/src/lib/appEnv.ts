/**
 * Which deployment this server is: `production`, `staging` or `development`.
 *
 * Set `APP_ENV`. When unset it follows NODE_ENV (`production` -> production,
 * anything else -> development), so existing deployments behave exactly as
 * before. Staging is a production-like build that must never hold real money or
 * real customers, so it is refused at boot if it is wired to live credentials.
 */

export type AppEnv = "production" | "staging" | "development";

export function resolveAppEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  const explicit = env.APP_ENV?.trim().toLowerCase();
  if (explicit === "production" || explicit === "staging" || explicit === "development") {
    return explicit;
  }
  return env.NODE_ENV === "production" ? "production" : "development";
}

/**
 * Problems that make a staging server unsafe. Empty for other environments.
 * Pure so it can be tested without booting the server.
 */
export function stagingSafetyProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  if (resolveAppEnv(env) !== "staging") return [];
  const problems: string[] = [];
  const stripeKey = env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (stripeKey.startsWith("sk_live_") || stripeKey.startsWith("rk_live_")) {
    problems.push("STRIPE_SECRET_KEY is a live key; staging must use sk_test_ keys");
  }
  const clerkSecret = env.CLERK_SECRET_KEY?.trim() ?? "";
  if (clerkSecret.startsWith("sk_live_")) {
    problems.push("CLERK_SECRET_KEY is a production Clerk key; staging needs its own Clerk instance (sk_test_)");
  }
  const clerkPublishable = env.CLERK_PUBLISHABLE_KEY?.trim() ?? "";
  if (clerkPublishable.startsWith("pk_live_")) {
    problems.push("CLERK_PUBLISHABLE_KEY is a production key; staging needs its own Clerk instance (pk_test_)");
  }
  const production = env.PRODUCTION_DATABASE_URL?.trim();
  if (production && env.DATABASE_URL?.trim() === production) {
    problems.push("DATABASE_URL is the same database as PRODUCTION_DATABASE_URL");
  }
  return problems;
}

/** Throws when a staging server is pointed at live credentials. Called once at boot. */
export function assertStagingIsSafe(env: NodeJS.ProcessEnv = process.env): void {
  const problems = stagingSafetyProblems(env);
  if (problems.length > 0) {
    throw new Error(`Refusing to start in staging: ${problems.join("; ")}. See docs/reliability/staging.md.`);
  }
}
