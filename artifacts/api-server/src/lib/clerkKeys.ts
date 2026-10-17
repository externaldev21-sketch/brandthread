/**
 * Clerk key diagnostics.
 *
 * A Clerk backend 401 `clerk_key_invalid` almost always means CLERK_SECRET_KEY
 * is wrong for the instance: pasted with quotes or a trailing newline, the
 * publishable key in the secret slot, or a dev (sk_test_) / prod (sk_live_)
 * key paired with the other instance's publishable key. These checks run
 * once at boot (validateEnv) and log one clear line per problem.
 *
 * Keys are never logged: at most the prefix plus the last 4 characters.
 * Everything here is pure so it is unit-tested without booting the server.
 */

export type ClerkKeyIssue = { level: "error" | "warn"; message: string };

export type ClerkKeyDiagnosis = {
  issues: ClerkKeyIssue[];
  /** Values with surrounding whitespace/quotes removed (only set when they changed). */
  sanitized: Partial<Record<"CLERK_SECRET_KEY" | "CLERK_PUBLISHABLE_KEY", string>>;
  /** Safe one-line summary, e.g. "secret=sk_test_…a1b2 publishable=pk_test_…c3d4 (example.clerk.accounts.dev)". */
  summary: string;
};

const SECRET_PREFIXES = ["sk_test_", "sk_live_"] as const;
const PUBLISHABLE_PREFIXES = ["pk_test_", "pk_live_"] as const;

/** `sk_test_…ab12` — never more than the prefix and last 4 characters. */
export function maskClerkKey(value: string | undefined | null): string {
  const v = (value ?? "").trim();
  if (!v) return "(unset)";
  const prefix = /^(sk|pk)_(test|live)_/.exec(v)?.[0] ?? "";
  const tail = v.length > prefix.length + 8 ? v.slice(-4) : "";
  return `${prefix || "unknown-prefix"}…${tail}`;
}

/** Strips surrounding whitespace and one layer of matching quotes. */
export function cleanClerkKey(raw: string): { value: string; hadWhitespace: boolean; hadQuotes: boolean; hadInnerWhitespace: boolean } {
  const trimmed = raw.trim();
  const hadWhitespace = trimmed !== raw;
  let value = trimmed;
  let hadQuotes = false;
  const first = value[0];
  if (value.length >= 2 && (first === '"' || first === "'" || first === "`") && value.endsWith(first)) {
    value = value.slice(1, -1).trim();
    hadQuotes = true;
  }
  return { value, hadWhitespace, hadQuotes, hadInnerWhitespace: /\s/.test(value) };
}

function envOf(key: string): "test" | "live" | null {
  const m = /^(?:sk|pk)_(test|live)_/.exec(key);
  return m ? (m[1] as "test" | "live") : null;
}

/** The Frontend API host a publishable key encodes (public info), or null if malformed. */
export function publishableKeyFrontendApi(key: string): string | null {
  const m = /^pk_(?:test|live)_(.+)$/.exec(key);
  if (!m) return null;
  try {
    const decoded = Buffer.from(m[1], "base64").toString("utf8");
    if (!decoded.endsWith("$")) return null;
    const host = decoded.slice(0, -1);
    return /^[a-z0-9.-]+$/i.test(host) ? host : null;
  } catch {
    return null;
  }
}

export function diagnoseClerkKeys(env: Record<string, string | undefined>): ClerkKeyDiagnosis {
  const issues: ClerkKeyIssue[] = [];
  const sanitized: ClerkKeyDiagnosis["sanitized"] = {};

  const check = (name: "CLERK_SECRET_KEY" | "CLERK_PUBLISHABLE_KEY"): string => {
    const raw = env[name];
    if (raw === undefined || raw.trim() === "") {
      issues.push({ level: "error", message: `${name} is not set. Add it in your environment secrets (Clerk Dashboard > API keys).` });
      return "";
    }
    const cleaned = cleanClerkKey(raw);
    if (cleaned.hadQuotes) {
      issues.push({ level: "warn", message: `${name} is wrapped in quotes; remove the quotes in your secrets (using the value without them).` });
    }
    if (cleaned.hadWhitespace) {
      issues.push({ level: "warn", message: `${name} has leading/trailing whitespace or a newline; remove it in your secrets (using the trimmed value).` });
    }
    if (cleaned.hadInnerWhitespace) {
      issues.push({ level: "error", message: `${name} contains spaces or line breaks inside the key; re-copy it from Clerk Dashboard > API keys.` });
    }
    if (cleaned.value !== raw) sanitized[name] = cleaned.value;
    return cleaned.value;
  };

  const secret = check("CLERK_SECRET_KEY");
  const publishable = check("CLERK_PUBLISHABLE_KEY");

  if (secret) {
    if (secret.startsWith("pk_")) {
      issues.push({ level: "error", message: "CLERK_SECRET_KEY holds a publishable key (pk_…); it must be the Secret key (sk_test_… or sk_live_…)." });
    } else if (!SECRET_PREFIXES.some((p) => secret.startsWith(p))) {
      issues.push({ level: "error", message: `CLERK_SECRET_KEY must start with sk_test_ or sk_live_ (got ${maskClerkKey(secret)}).` });
    }
  }
  if (publishable) {
    if (publishable.startsWith("sk_")) {
      issues.push({ level: "error", message: "CLERK_PUBLISHABLE_KEY holds a secret key (sk_…); it must be the Publishable key (pk_test_… or pk_live_…). Rotate that secret key: publishable keys are shipped to clients." });
    } else if (!PUBLISHABLE_PREFIXES.some((p) => publishable.startsWith(p))) {
      issues.push({ level: "error", message: `CLERK_PUBLISHABLE_KEY must start with pk_test_ or pk_live_ (got ${maskClerkKey(publishable)}).` });
    } else if (!publishableKeyFrontendApi(publishable)) {
      issues.push({ level: "error", message: `CLERK_PUBLISHABLE_KEY (${maskClerkKey(publishable)}) is malformed or truncated; re-copy it from Clerk Dashboard > API keys.` });
    }
  }

  const secretEnv = secret ? envOf(secret) : null;
  const publishableEnv = publishable ? envOf(publishable) : null;
  if (secretEnv && publishableEnv && secretEnv !== publishableEnv) {
    issues.push({
      level: "error",
      message: `Clerk key mismatch: CLERK_SECRET_KEY is a ${secretEnv === "test" ? "development (sk_test_)" : "production (sk_live_)"} key but CLERK_PUBLISHABLE_KEY is a ${publishableEnv === "test" ? "development (pk_test_)" : "production (pk_live_)"} key. Both must come from the same Clerk instance.`,
    });
  }

  const expoPublishable = env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  if (expoPublishable && publishable && cleanClerkKey(expoPublishable).value !== publishable) {
    issues.push({
      level: "warn",
      message: `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY (${maskClerkKey(expoPublishable)}) differs from CLERK_PUBLISHABLE_KEY (${maskClerkKey(publishable)}); the app and server may be talking to different Clerk instances.`,
    });
  }

  const host = publishable ? publishableKeyFrontendApi(publishable) : null;
  const summary = `secret=${maskClerkKey(secret)} publishable=${maskClerkKey(publishable)}${host ? ` (${host})` : ""}`;
  return { issues, sanitized, summary };
}

export const CLERK_KEY_INVALID_MESSAGE =
  "Clerk rejected CLERK_SECRET_KEY (401 clerk_key_invalid). Copy the Secret key from Clerk Dashboard > API keys for the SAME instance as CLERK_PUBLISHABLE_KEY (sk_test_ with pk_test_, sk_live_ with pk_live_) into your secrets and restart.";

/** True for a Clerk backend error / token verification error caused by an invalid secret key. */
export function isClerkKeyInvalidError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { errors?: Array<{ code?: unknown }>; reason?: unknown; code?: unknown; message?: unknown };
  if (Array.isArray(e.errors) && e.errors.some((x) => x?.code === "clerk_key_invalid")) return true;
  if (e.code === "clerk_key_invalid" || e.reason === "secret-key-invalid") return true;
  return typeof e.message === "string" && e.message.includes("clerk_key_invalid");
}

/** True when clerkMiddleware's auth-state headers say the secret key was rejected. */
export function isClerkKeyInvalidAuthState(reason: unknown, message: unknown): boolean {
  return reason === "secret-key-invalid"
    || (typeof message === "string" && message.includes("clerk_key_invalid"));
}

/**
 * Returns a function that reports true at most once per `intervalMs`, so a
 * bad key logs a clear line regularly without flooding the log on every
 * request.
 */
export function createLogThrottle(intervalMs: number, now: () => number = Date.now): () => boolean {
  let last = -Infinity;
  return () => {
    const t = now();
    if (t - last < intervalMs) return false;
    last = t;
    return true;
  };
}
