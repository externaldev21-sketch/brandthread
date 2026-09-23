/**
 * Dynamic layer over app.json. Everything static lives in app.json; this file
 * only derives values from it, never from environment variables, so the
 * runtime fingerprint (which decides which builds an OTA update reaches) is
 * the same on every machine.
 *
 * - updates.url: EAS Update endpoint, derived from the project ID that
 *   `eas init` writes to app.json (extra.eas.projectId).
 */
module.exports = ({ config }) => {
  const projectId = config.extra?.eas?.projectId;
  if (!projectId || config.updates?.url) return config;
  return {
    ...config,
    updates: { ...config.updates, url: `https://u.expo.dev/${projectId}` },
  };
};
