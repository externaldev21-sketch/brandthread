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
const webHitSlopShims = {
  Pressable: path.resolve(__dirname, 'shims/react-native-web-pressable.js'),
  TouchableOpacity: path.resolve(__dirname, 'shims/react-native-web-touchable-opacity.js'),
};
const shimsDir = path.resolve(__dirname, 'shims');
// `./exports/X` from react-native-web's own index, or the direct
// `react-native-web/dist/exports/X` path babel-preset-expo rewrites
// `import { X } from 'react-native'` to on web.
function webHitSlopShimFor(context, moduleName) {
  const m = /^(?:\.\/|react-native-web\/dist\/)exports\/(Pressable|TouchableOpacity)$/.exec(moduleName);
  if (!m) return null;
  const origin = context.originModulePath || '';
  if (origin.startsWith(shimsDir)) return null;
  if (moduleName.startsWith('./') && !/react-native-web[\\/]dist[\\/]index\.js$/.test(origin)) return null;
  return webHitSlopShims[m[1]];
}
const _orig = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react-native-agora' && platform === 'web') {
    return { filePath: agoraShim, type: 'sourceFile' };
  }
  // react-native-web's Pressable/TouchableOpacity ignore `hitSlop`; on web,
  // swap in thin wrappers that honor it so 44pt touch areas exist in the web
  // preview too. The shims import the originals themselves, so imports from
  // inside shims/ are left alone.
  const hitSlopShim = platform === 'web' ? webHitSlopShimFor(context, moduleName) : null;
  if (hitSlopShim) return { filePath: hitSlopShim, type: 'sourceFile' };
  if (_orig) return _orig(context, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
