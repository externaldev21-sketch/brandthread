/**
 * @expo/fingerprint settings for the "fingerprint" runtime version policy
 * (app.json runtimeVersion). Decides which store binaries an OTA update from
 * `eas update` can reach.
 *
 * Keeps the default skip and adds ExpoConfigEASProject, so the EAS project
 * fields (owner, extra.eas.*, updates.url) are not part of the fingerprint.
 * They identify where updates come from, not what native code the binary
 * contains. Launch links these fields in static app.json; linking alone must
 * not split a binary's runtime from its updates.
 */
const { DEFAULT_SOURCE_SKIPS, SourceSkips } = require('expo/fingerprint');

module.exports = {
  sourceSkips: DEFAULT_SOURCE_SKIPS | SourceSkips.ExpoConfigEASProject,
};
