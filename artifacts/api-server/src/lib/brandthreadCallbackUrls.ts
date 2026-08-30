import { getWebOrigin } from "./webOrigin";

type CallbackKind = "manufacturer_onboarding" | "sample_checkout";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasExactQueryParams(url: URL, expected: readonly string[]): boolean {
  const keys = Array.from(url.searchParams.keys());
  return keys.length === expected.length
    && expected.every((key) => url.searchParams.getAll(key).length === 1)
    && keys.every((key) => expected.includes(key));
}

export function isAllowedBrandthreadCallbackUrl(value: unknown, kind: CallbackKind): value is string {
  if (typeof value !== "string" || !value) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;

    if (url.protocol === "brandthread:") {
      if (url.port) return false;
      if (kind === "manufacturer_onboarding") {
        return url.hostname === "payouts"
          && (url.pathname === "/complete" || url.pathname === "/refresh")
          && !url.search;
      }
      return url.hostname === "sample-detail"
        && (url.pathname === "" || url.pathname === "/")
        && hasExactQueryParams(url, ["id", "paymentReturn"])
        && UUID_RE.test(url.searchParams.get("id") ?? "")
        && url.searchParams.get("paymentReturn") === "1";
    }

    const configuredOrigin = new URL(getWebOrigin()).origin;
    const isConfiguredOrigin = url.origin === configuredOrigin;
    const isDevelopmentLocalhost =
      process.env.NODE_ENV !== "production"
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (!isConfiguredOrigin && !isDevelopmentLocalhost) return false;

    if (kind === "manufacturer_onboarding") {
      return url.pathname === "/manufacturers/payment" && !url.search;
    }
    return url.pathname === "/sample-detail"
      && hasExactQueryParams(url, ["id", "paymentReturn"])
      && UUID_RE.test(url.searchParams.get("id") ?? "")
      && url.searchParams.get("paymentReturn") === "1";
  } catch {
    return false;
  }
}