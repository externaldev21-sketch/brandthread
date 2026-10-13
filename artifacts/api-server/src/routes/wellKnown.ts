/**
 * Universal links (iOS) and App Links (Android) verification files.
 *
 * The web app (artifacts/mobile/server/appLinks.js) serves the same files on
 * the share host; keep the two path lists in sync.
 *
 * Both platforms fetch these from the website's root at app-install time to
 * confirm the app is authorized to open brandthread.app links, so they must
 * be served at the exact paths below with no auth, no redirect, and JSON.
 *
 * Values come from env vars because they depend on the owner's Apple/Google
 * developer accounts, which don't exist yet — see docs/launch/README.md for
 * what to set once those accounts are created. Until then this responds with
 * an empty (but validly-shaped) association file rather than failing, so the
 * server keeps booting in every environment.
 */
import { Router, type IRouter } from "express";

const router: IRouter = Router();

export const DEEP_LINK_PATHS = [
  "/u/*",
  "/c/*",
  // Growth links (BT-311): referral invites, community invites, live
  // streams and giveaways open in the app instead of Safari.
  "/invite/*",
  "/community-join*",
  "/live/*",
  "/g/*",
  "/store/*",
  "/drops/*",
  "/p/*",
  "/post/*",
  "/s/*",
  "/tag/*",
  "/place/*",
  "/invite/*",
  "/onboarding*",
  "/team-invite*",
  "/checkout-return*",
  // Order emails' "Track order" button (lib/brandthreadEmail.ts orderDeepLink).
  "/buyer-order-detail*",
];

function appleAppId(): string | null {
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  const bundleId = process.env.IOS_BUNDLE_IDENTIFIER?.trim() || "com.brandthread.mobile";
  if (!teamId) return null;
  return `${teamId}.${bundleId}`;
}

/**
 * App Clip ("instant checkout without install"). Only advertised once the
 * App Clip target exists and APP_CLIP_BUNDLE_ID is set (plus APPLE_TEAM_ID);
 * until then the association file carries no `appclips` key at all.
 */
export function appClipAppId(): string | null {
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  const clipBundleId = process.env.APP_CLIP_BUNDLE_ID?.trim();
  if (!teamId || !clipBundleId) return null;
  return `${teamId}.${clipBundleId}`;
}

function androidSha256Fingerprints(): string[] {
  const raw = process.env.ANDROID_SHA256_CERT_FINGERPRINTS?.trim();
  if (!raw) return [];
  return raw.split(",").map((fp) => fp.trim()).filter(Boolean);
}

/**
 * Names the env vars still missing for app-link verification (BT-302). Until
 * they are set, iOS/Android keep shared https links in the browser.
 */
export function missingAppLinkEnv(): string[] {
  const missing: string[] = [];
  if (!appleAppId()) missing.push("APPLE_TEAM_ID");
  if (androidSha256Fingerprints().length === 0) missing.push("ANDROID_SHA256_CERT_FINGERPRINTS");
  return missing;
}

router.get("/apple-app-site-association", (_req, res) => {
  const appId = appleAppId();
  const clipId = appClipAppId();
  res.setHeader("Content-Type", "application/json");
  res.json({
    applinks: {
      apps: [],
      details: appId
        ? [{ appID: appId, paths: DEEP_LINK_PATHS }]
        : [],
    },
    ...(clipId ? { appclips: { apps: [clipId] } } : {}),
  });
});

router.get("/assetlinks.json", (_req, res) => {
  const fingerprints = androidSha256Fingerprints();
  const packageName = process.env.ANDROID_PACKAGE_NAME?.trim() || "com.brandthread.mobile";
  res.setHeader("Content-Type", "application/json");
  res.json(
    fingerprints.length
      ? [
          {
            relation: ["delegate_permission/common.handle_all_urls"],
            target: {
              namespace: "android_app",
              package_name: packageName,
              sha256_cert_fingerprints: fingerprints,
            },
          },
        ]
      : [],
  );
});

export default router;
