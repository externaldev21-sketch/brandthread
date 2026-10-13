const fs = require('fs');
const path = require('path');
const { withXcodeProject, withDangerousMod } = require('expo/config-plugins');

/**
 * Adds the `RichPushService` Notification Service Extension target, which
 * downloads a push's product image (Expo `richContent.image`, sent with
 * `mutableContent: true` by api-server lib/push.ts) and attaches it so iOS
 * shows it. Android needs nothing — it renders `richContent.image` natively.
 *
 * Modelled on with-upload-live-activity.js. A no-op unless the build env has
 * BT_IOS_RICH_PUSH=1 (e.g. an EAS build profile's `env`): the extension's
 * bundle id (`<main bundle id>.RichPushService`) needs its own App ID +
 * provisioning profile in EAS before a build that includes it can be signed.
 * The extension joins the App Group `group.com.brandthread.mobile.liveactivity`
 * (RichPushService.entitlements) so a new-order push can update the seller
 * widgets' snapshot; enable "App Groups" for that group on the extension's
 * App ID. The gate lives here, not in
 * app.config.js, which must never read env (fingerprint stability, see
 * scripts/release-tooling.test.ts). The extension has no JS-facing native
 * API, so builds with and without it run the same OTA updates.
 */

const EXTENSION_NAME = 'RichPushService';
const SOURCE_DIR = path.join(__dirname, '..', 'ios-extensions', EXTENSION_NAME);
const SWIFT_SOURCES = ['NotificationService.swift'];

function withRichPushServiceFiles(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const destDir = path.join(cfg.modRequest.platformProjectRoot, EXTENSION_NAME);
      fs.mkdirSync(destDir, { recursive: true });
      for (const fileName of [...SWIFT_SOURCES, 'Info.plist', `${EXTENSION_NAME}.entitlements`]) {
        fs.copyFileSync(path.join(SOURCE_DIR, fileName), path.join(destDir, fileName));
      }
      return cfg;
    },
  ]);
}

function withRichPushServiceTarget(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const mainBundleId =
      cfg.ios?.bundleIdentifier || project.getFirstTarget().firstTarget.productName;
    const extensionBundleId = `${mainBundleId}.${EXTENSION_NAME}`;

    // Idempotent across `expo prebuild` runs without --clean.
    if (project.pbxTargetByName(EXTENSION_NAME)) return cfg;

    const target = project.addTarget(EXTENSION_NAME, 'app_extension', EXTENSION_NAME, extensionBundleId);
    project.addPbxGroup([...SWIFT_SOURCES, 'Info.plist', `${EXTENSION_NAME}.entitlements`], EXTENSION_NAME, EXTENSION_NAME);
    project.addBuildPhase(SWIFT_SOURCES, 'PBXSourcesBuildPhase', 'Sources', target.uuid);
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
    project.addBuildPhase(
      ['UserNotifications.framework', 'WidgetKit.framework', 'ImageIO.framework'],
      'PBXFrameworksBuildPhase',
      'Frameworks',
      target.uuid,
    );

    const configurations = project.pbxXCBuildConfigurationSection();
    for (const key in configurations) {
      const entry = configurations[key];
      if (
        entry &&
        typeof entry === 'object' &&
        entry.buildSettings &&
        entry.buildSettings.PRODUCT_NAME === `"${EXTENSION_NAME}"`
      ) {
        entry.buildSettings.SWIFT_VERSION = '5.9';
        entry.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = '15.1';
        entry.buildSettings.TARGETED_DEVICE_FAMILY = '"1,2"';
        entry.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = `"${extensionBundleId}"`;
        entry.buildSettings.CODE_SIGN_ENTITLEMENTS = `"${EXTENSION_NAME}/${EXTENSION_NAME}.entitlements"`;
        entry.buildSettings.INFOPLIST_FILE = `"${EXTENSION_NAME}/Info.plist"`;
        entry.buildSettings.GENERATE_INFOPLIST_FILE = 'NO';
        entry.buildSettings.CURRENT_PROJECT_VERSION = `"${cfg.ios?.buildNumber || '1'}"`;
        entry.buildSettings.MARKETING_VERSION = `"${cfg.version || '1.0.0'}"`;
      }
    }
    return cfg;
  });
}

function isEnabled() {
  return process.env.BT_IOS_RICH_PUSH === '1';
}

module.exports = function withRichPushService(config) {
  if (!isEnabled()) return config;
  config = withRichPushServiceFiles(config);
  config = withRichPushServiceTarget(config);
  return config;
};

module.exports.EXTENSION_NAME = EXTENSION_NAME;
