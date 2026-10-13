const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const path = require('path');

// Expo's default Metro config plus Sentry's serializer, which stamps each
// bundle and its source map with a matching Debug ID so crash stack traces
// can be symbolicated. It has no runtime effect when Sentry is not configured.
const config = getSentryExpoConfig(__dirname);

// Block Metro from watching ephemeral _tmp_ dirs that @clerk/shared
// creates during installation — they get removed immediately and cause
// a fatal ENOENT crash in Metro's FallbackWatcher.
config.resolver.blockList = [
  /node_modules\/.*_tmp_.*/,
  /.*\.test\.[jt]sx?$/,
];

// Alias react-native-agora → a no-op shim on web.
// The native SDK uses CodeGen native components that cannot bundle for web.
// The seller-live and buyer-live screens degrade gracefully when the module is null.
const agoraShim = path.resolve(__dirname, 'shims/react-native-agora.js');
const _orig = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react-native-agora' && platform === 'web') {
    return { filePath: agoraShim, type: 'sourceFile' };
  }
  if (_orig) return _orig(context, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

// Inline requires (speed polish #3): a module's code runs the first time it is
// actually used instead of all at startup, so the first tab paints without
// evaluating every other screen's imports. Release builds already run on
// Hermes (Expo's default engine; jsEngine is not overridden in app.json).
const _origTransformOptions = config.transformer.getTransformOptions;
config.transformer.getTransformOptions = async (...args) => {
  const base = _origTransformOptions ? await _origTransformOptions(...args) : {};
  return {
    ...base,
    transform: { ...(base && base.transform), inlineRequires: true },
  };
};

module.exports = config;
