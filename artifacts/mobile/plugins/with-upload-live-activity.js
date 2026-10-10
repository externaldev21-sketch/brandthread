const fs = require('fs');
const path = require('path');
const {
  withInfoPlist,
  withEntitlementsPlist,
  withXcodeProject,
  withDangerousMod,
} = require('expo/config-plugins');

/**
 * Adds the `UploadLiveActivity` Widget Extension target (ActivityKit Live
 * Activity: Dynamic Island + Lock Screen) to the generated iOS project.
 *
 * Hand-written with `@expo/config-plugins` mods (`withInfoPlist`,
 * `withEntitlementsPlist`, `withXcodeProject`, `withDangerousMod`) to match
 * this repo's existing plugin style (`with-verify-app-identity.js`,
 * `with-sentry-upload-guard.js`) rather than pulling in a separate
 * plugin-authoring convention.
 *
 * What this does, in order, on every `expo prebuild`:
 *  1. Copies the Swift/Info.plist/entitlements sources from
 *     `ios-extensions/UploadLiveActivity/` into the generated
 *     `ios/UploadLiveActivity/` directory.
 *  2. Adds `NSSupportsLiveActivities: true` to the MAIN APP's Info.plist
 *     (required for the app process to call `Activity.request(...)`).
 *  3. Adds the shared App Group
 *     (`group.com.brandthread.mobile.liveactivity`) to the main app's
 *     entitlements, so `UploadLiveActivityModule.swift` can write the
 *     thumbnail into a container the widget extension can also read.
 *  4. Adds a new `com.apple.product-type.app-extension` target named
 *     "UploadLiveActivity" to the Xcode project (via the `xcode` package
 *     that backs `@expo/config-plugins`'s `withXcodeProject`), with:
 *       - its own Info.plist, entitlements (same App Group) and bundle id
 *         (`<main bundle id>.UploadLiveActivity`)
 *       - `UploadLiveActivityBundle.swift` + `UploadLiveActivityWidget.swift`
 *         in its own Compile Sources
 *       - `UploadLiveActivityAttributes.swift` ALSO added to the main
 *         app target's Compile Sources (it's shared — see that file's own
 *         doc comment) — never move it without updating both build phases
 *         below.
 *       - WidgetKit/SwiftUI/ActivityKit frameworks linked
 *       - iOS 16.1 minimum deployment target (Live Activities' floor)
 *       - embedded into the main app target via a Copy Files ("Embed App
 *         Extensions") build phase, which `xcode`'s `addTarget('app_extension', ...)`
 *         sets up automatically.
 *
 * Local Expo module: the app-side `UploadLiveActivityModule.swift` (under
 * `modules/upload-live-activity/`) is a standard local Expo module,
 * autolinked via `expo.autolinking.searchPaths` in `package.json` — this
 * plugin does not need to wire it in itself, only the widget extension
 * target, which autolinking has no concept of.
 *
 * Requires `withVerifyAppIdentity`/EAS credentials setup to separately
 * provision the extension's bundle id
 * (`com.brandthread.mobile.UploadLiveActivity`) with the "App Groups"
 * capability enabled for `group.com.brandthread.mobile.liveactivity`, and
 * the main app's bundle id to have "App Groups" (for the same group) and
 * "Push Notifications" is NOT required for this v1 (see this repo's
 * upload-live-activity report for why: local-only `Activity.update(...)`
 * calls need no push entitlement).
 */

const APP_GROUP = 'group.com.brandthread.mobile.liveactivity';
const EXTENSION_NAME = 'UploadLiveActivity';
const SOURCE_DIR = path.join(__dirname, '..', 'ios-extensions', 'UploadLiveActivity');
/**
 * ActivityAttributes types shared by the app and the extension. Their one
 * canonical copy lives in the local Expo module
 * (`modules/upload-live-activity/ios/Shared/`), which compiles them into the
 * app (a pod cannot see types compiled into the app target, so the module
 * must own them); this plugin copies the same files into the extension so
 * ActivityKit matches the type on both sides.
 */
const SHARED_DIR = path.join(__dirname, '..', 'modules', 'upload-live-activity', 'ios', 'Shared');
const SHARED_SOURCES = [
  'UploadLiveActivityAttributes.swift',
  'OrderTrackingAttributes.swift',
  'LiveStreamAttributes.swift',
];

const EXTENSION_SOURCES = [
  'UploadLiveActivityBundle.swift',
  'UploadLiveActivityWidget.swift',
  'OrderTrackingWidget.swift',
  'LiveStreamWidget.swift',
  'HomeWidgets.swift',
];

const SWIFT_SOURCES = [...SHARED_SOURCES, ...EXTENSION_SOURCES];

function withUploadLiveActivityInfoPlist(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.NSSupportsLiveActivities = true;
    return cfg;
  });
}

function withUploadLiveActivityEntitlements(config) {
  return withEntitlementsPlist(config, (cfg) => {
    const groups = new Set(cfg.modResults['com.apple.security.application-groups'] || []);
    groups.add(APP_GROUP);
    cfg.modResults['com.apple.security.application-groups'] = Array.from(groups);
    return cfg;
  });
}

/** Copies the extension's source files into the generated ios/ directory. */
function withUploadLiveActivityFiles(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const destDir = path.join(cfg.modRequest.platformProjectRoot, EXTENSION_NAME);
      fs.mkdirSync(destDir, { recursive: true });
      const filesToCopy = [
        ...EXTENSION_SOURCES,
        'Info.plist',
        `${EXTENSION_NAME}.entitlements`,
      ];
      for (const fileName of filesToCopy) {
        fs.copyFileSync(path.join(SOURCE_DIR, fileName), path.join(destDir, fileName));
      }
      for (const fileName of SHARED_SOURCES) {
        fs.copyFileSync(path.join(SHARED_DIR, fileName), path.join(destDir, fileName));
      }
      return cfg;
    },
  ]);
}

function withUploadLiveActivityXcodeTarget(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const mainBundleId =
      cfg.ios?.bundleIdentifier || project.getFirstTarget().firstTarget.productName;
    const extensionBundleId = `${mainBundleId}.${EXTENSION_NAME}`;

    // Idempotent: `expo prebuild` (without --clean) re-runs plugins against
    // an already-generated project. Bail out if the target already exists
    // instead of adding a duplicate.
    const existingTarget = project.pbxTargetByName(EXTENSION_NAME);
    if (existingTarget) {
      return cfg;
    }

    const target = project.addTarget(EXTENSION_NAME, 'app_extension', EXTENSION_NAME, extensionBundleId);

    // Group + file references for the copied sources, and a Sources build
    // phase on the new target.
    project.addPbxGroup(
      [...SWIFT_SOURCES, 'Info.plist', `${EXTENSION_NAME}.entitlements`],
      EXTENSION_NAME,
      EXTENSION_NAME,
    );
    project.addBuildPhase(SWIFT_SOURCES, 'PBXSourcesBuildPhase', 'Sources', target.uuid);
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
    project.addBuildPhase(
      ['WidgetKit.framework', 'SwiftUI.framework', 'ActivityKit.framework'],
      'PBXFrameworksBuildPhase',
      'Frameworks',
      target.uuid,
    );

    // The shared attributes are compiled into the app by the local Expo
    // module's pod (modules/upload-live-activity/ios/Shared/), so the main
    // target needs no extra Compile Sources entry.

    // Per-target build settings: Swift, deployment target, entitlements,
    // Info.plist path, bundle id (already set via addTarget's 4th arg, but
    // PRODUCT_BUNDLE_IDENTIFIER is restated here for clarity/robustness
    // across `xcode` package versions).
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
        entry.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = '16.1';
        entry.buildSettings.TARGETED_DEVICE_FAMILY = '"1,2"';
        entry.buildSettings.CODE_SIGN_ENTITLEMENTS = `"${EXTENSION_NAME}/${EXTENSION_NAME}.entitlements"`;
        entry.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = `"${extensionBundleId}"`;
        entry.buildSettings.INFOPLIST_FILE = `"${EXTENSION_NAME}/Info.plist"`;
        entry.buildSettings.GENERATE_INFOPLIST_FILE = 'NO';
        entry.buildSettings.CURRENT_PROJECT_VERSION = `"${cfg.ios?.buildNumber || '1'}"`;
        entry.buildSettings.MARKETING_VERSION = `"${cfg.version || '1.0.0'}"`;
      }
    }

    return cfg;
  });
}

module.exports = function withUploadLiveActivity(config) {
  config = withUploadLiveActivityInfoPlist(config);
  config = withUploadLiveActivityEntitlements(config);
  config = withUploadLiveActivityFiles(config);
  config = withUploadLiveActivityXcodeTarget(config);
  return config;
};

module.exports.APP_GROUP = APP_GROUP;
module.exports.EXTENSION_NAME = EXTENSION_NAME;
module.exports.SWIFT_SOURCES = SWIFT_SOURCES;
module.exports.SHARED_SOURCES = SHARED_SOURCES;
