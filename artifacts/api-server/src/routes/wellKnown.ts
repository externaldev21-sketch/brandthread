/**
 * Universal links (iOS) and App Links (Android) verification files.
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

const DEEP_LINK_PATHS = [
  "/u/*",
  "/c/*",
  "/store/*",
  "/drops/*",
  "/onboarding*",
  "/team-invite*",
];

function appleAppId(): string | null {
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  const bundleId = process.env.IOS_BUNDLE_IDENTIFIER?.trim() || "com.brandthread.mobile";
  if (!teamId) return null;
  return `${teamId}.${bundleId}`;
}

function androidSha256Fingerprints(): string[] {
  const raw = process.env.ANDROID_SHA256_CERT_FINGERPRINTS?.trim();
  if (!raw) return [];
  return raw.split(",").map((fp) => fp.trim()).filter(Boolean);
}

router.get("/apple-app-site-association", (_req, res) => {
  const appId = appleAppId();
  res.setHeader("Content-Type", "application/json");
  res.json({
    applinks: {
      apps: [],
      details: appId
        ? [{ appID: appId, paths: DEEP_LINK_PATHS }]
        : [],
    },
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
