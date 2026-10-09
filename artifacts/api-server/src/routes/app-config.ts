/**
 * GET /api/v1/app/config — public, unauthenticated client release config.
 *
 * Tells the mobile app which native versions are still supported (the
 * force-update gate), which OTA updates are critical, and any release-flag
 * overrides. Everything comes from env vars, so it works with no database and
 * signed-out clients can read it. With nothing set, nobody is ever asked to
 * update and no flag is overridden.
 *
 *   MIN_APP_VERSION_IOS / MIN_APP_VERSION_ANDROID  e.g. "1.2.0"
 *   LATEST_APP_VERSION                             e.g. "1.4.0" (informational)
 *   APP_STORE_URL_IOS / APP_STORE_URL_ANDROID      store listing URLs
 *   APP_FLAGS                                      JSON object of booleans, e.g. {"force_update_gate":false}
 *   OTA_CRITICAL_UPDATE_IDS                        comma-separated EAS update ids to apply promptly
 */
import { Router, type IRouter } from "express";

export type AppConfigResponse = {
  minSupportedVersion: { ios: string | null; android: string | null };
  latestVersion: string | null;
  storeUrls: { ios: string | null; android: string | null };
  flags: Record<string, boolean>;
  criticalUpdateIds: string[];
};

const VERSION_RE = /^v?\d{1,9}(\.\d{1,9}){0,2}(-[0-9A-Za-z.-]+)?$/;
const FLAG_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;
const UPDATE_ID_RE = /^[0-9A-Za-z-]{8,64}$/;
const MAX_FLAGS = 100;
const MAX_UPDATE_IDS = 50;

function version(raw: string | undefined): string | null {
  const value = raw?.trim();
  return value && VERSION_RE.test(value) ? value : null;
}

function storeUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "itms-apps:" || url.protocol === "market:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function flags(raw: string | undefined): Record<string, boolean> {
  if (!raw?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (Object.keys(out).length >= MAX_FLAGS) break;
      if (FLAG_NAME_RE.test(name) && typeof value === "boolean") out[name] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function updateIds(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => UPDATE_ID_RE.test(id))
    .slice(0, MAX_UPDATE_IDS);
}

/** Pure: builds the response from env. Invalid values are dropped, never thrown. */
export function resolveAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfigResponse {
  return {
    minSupportedVersion: {
      ios: version(env.MIN_APP_VERSION_IOS),
      android: version(env.MIN_APP_VERSION_ANDROID),
    },
    latestVersion: version(env.LATEST_APP_VERSION),
    storeUrls: {
      ios: storeUrl(env.APP_STORE_URL_IOS),
      android: storeUrl(env.APP_STORE_URL_ANDROID),
    },
    flags: flags(env.APP_FLAGS),
    criticalUpdateIds: updateIds(env.OTA_CRITICAL_UPDATE_IDS),
  };
}

const router: IRouter = Router();

router.get("/config", (_req, res) => {
  // Short shared cache: a version bump reaches every client within minutes.
  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  res.json(resolveAppConfig());
});

export default router;
