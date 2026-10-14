const { withPlugins } = require('expo/config-plugins');

/**
 * Native extras are opt-in at build time, not just behind a server flag.
 * Keep their source/assets for a later provisioned build, but don't generate
 * extension targets or alternate icons for the first Expo Launch build.
 * Re-enabling also requires removing the two autolinking exclusions in
 * package.json and provisioning the extension/App Group in Launch.
 */
module.exports = function withNativeSurfaces(config, options = {}) {
  const enabled = options.enabled === true;
  config = {
    ...config,
    extra: { ...config.extra, nativeSurfacesBuildEnabled: enabled },
  };
  if (!enabled) return config;

  const { APP_GROUP, EXTENSION_NAME } = require('./with-upload-live-activity');
  const extension = {
    targetName: EXTENSION_NAME,
    bundleIdentifier: `${config.ios.bundleIdentifier}.${EXTENSION_NAME}`,
    entitlements: { 'com.apple.security.application-groups': [APP_GROUP] },
  };
  const eas = config.extra.eas || {};
  const build = eas.build || {};
  const experimental = build.experimental || {};
  const ios = experimental.ios || {};
  const ownTargets = new Set([EXTENSION_NAME, 'RichPushService']);
  const extensions = (ios.appExtensions || []).filter((entry) => !ownTargets.has(entry.targetName));
  extensions.push(extension);
  const richPush = process.env.BT_IOS_RICH_PUSH === '1';
  if (richPush) {
    extensions.push({
      ...extension,
      targetName: 'RichPushService',
      bundleIdentifier: `${config.ios.bundleIdentifier}.RichPushService`,
    });
  }
  config.extra.eas = {
    ...eas,
    build: {
      ...build,
      experimental: { ...experimental, ios: { ...ios, appExtensions: extensions } },
    },
  };
  return withPlugins(config, [
    ['expo-runtime-app-icon', { icons: options.icons }],
    './plugins/with-upload-live-activity',
    './plugins/with-siri-shortcuts',
    ...(richPush ? ['./plugins/with-rich-push-service'] : []),
  ]);
};
