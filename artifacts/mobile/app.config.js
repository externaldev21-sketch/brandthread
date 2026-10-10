/**
 * Dynamic layer over app.json. Everything static lives in app.json; this file
 * only derives values from it. The single environment variable it reads is
 * EAS_PROJECT_ID, and only as a fallback for the EAS project ID.
 *
 * - updates.url: EAS Update endpoint, derived from the project ID that
 *   `eas init` writes to app.json (extra.eas.projectId). When app.json has no
 *   project ID yet, EAS_PROJECT_ID (set in the shell and as an EAS environment
 *   variable) supplies it, and extra.eas.projectId is filled in too so eas-cli
 *   sees the same ID. Prefer running `eas init` once and committing app.json.
 *
 *   Fingerprint: the runtime version policy is "fingerprint" (app.json), and
 *   by default @expo/fingerprint DOES hash the whole app config, including
 *   updates.url and extra.eas. fingerprint.config.js therefore skips the EAS
 *   project fields (SourceSkips.ExpoConfigEASProject: owner, extra.eas,
 *   updates.url), so whether the ID comes from app.json or EAS_PROJECT_ID, and
 *   whether it was added before or after a build, never changes which
 *   binaries an OTA update reaches. The URL itself is baked into each binary
 *   at build time, so it must resolve before the first store build;
 *   scripts/verify-launch-config.js fails production/testflight builds when
 *   it does not.
 * - extra.router.asyncRoutes (web export only): while scripts/build-web.js is
 *   exporting the static web build it creates `.web-async-routes` next to this
 *   file and removes it afterwards. With that marker present every route
 *   becomes its own web chunk, so the first load ships the shell and the
 *   landing route instead of every screen. EAS and native builds never see the
 *   marker, so the native config, fingerprint and OTA compatibility are
 *   unchanged. The marker is a file rather than an environment variable on
 *   purpose: it cannot differ between machines building the same binary.
 */
const fs = require('fs');
const path = require('path');

const WEB_ASYNC_ROUTES_MARKER = path.join(__dirname, '.web-async-routes');

module.exports = ({ config }) => {
  const base = fs.existsSync(WEB_ASYNC_ROUTES_MARKER)
    ? {
        ...config,
        extra: { ...config.extra, router: { ...config.extra?.router, asyncRoutes: { web: true, default: false } } },
      }
    : config;
  const staticProjectId = base.extra?.eas?.projectId;
  const projectId = staticProjectId || process.env.EAS_PROJECT_ID?.trim() || null;
  if (!projectId) return base;
  const withProject = staticProjectId
    ? base
    : { ...base, extra: { ...base.extra, eas: { ...base.extra?.eas, projectId } } };
  if (withProject.updates?.url) return withProject;
  return {
    ...withProject,
    updates: { ...withProject.updates, url: `https://u.expo.dev/${projectId}` },
  };
};
