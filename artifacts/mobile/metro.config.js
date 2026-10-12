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
// System font (BRANDTHREAD_DESIGN.md): every `react-native` import resolves
// to shims/react-native.js, which re-exports react-native with Text/TextInput
// mapping weight-token font families (FONT.bold, 'Inter_700Bold', …) to the
// platform system font. The shim and lib/systemFont.ts themselves get the
// real module.
const systemFontShim = path.resolve(__dirname, 'shims/react-native.js');
const systemFontResolver = path.resolve(__dirname, 'lib/systemFont.ts');
const systemFontComponent = path.resolve(__dirname, 'shims/systemFontComponent.js');
// On web, babel-preset-expo rewrites `react-native` imports to
// react-native-web's per-component modules, so the resolved Text/TextInput
// files are swapped too (this also covers react-native-web's own Animated.Text).
const webTextShims = {
  Text: path.resolve(__dirname, 'shims/react-native-web-text.js'),
  TextInput: path.resolve(__dirname, 'shims/react-native-web-text-input.js'),
};
const WEB_TEXT_MODULE = /react-native-web[\\/]dist[\\/](?:cjs[\\/])?exports[\\/](Text|TextInput)[\\/]index\.js$/;
const _orig = config.resolver.resolveRequest;
const resolveDefault = (context, moduleName, platform) =>
  _orig ? _orig(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && /(^|[\\/])(Text|TextInput)([\\/]index(\.js)?)?$/.test(moduleName)) {
    const resolved = resolveDefault(context, moduleName, platform);
    const match = resolved && resolved.type === 'sourceFile' && WEB_TEXT_MODULE.exec(resolved.filePath);
    if (match && context.originModulePath !== webTextShims[match[1]]) {
      return { filePath: webTextShims[match[1]], type: 'sourceFile' };
    }
    return resolved;
  }
  if (moduleName === 'react-native-agora' && platform === 'web') {
    return { filePath: agoraShim, type: 'sourceFile' };
  }
  if (
    moduleName === 'react-native' &&
    context.originModulePath !== systemFontShim &&
    context.originModulePath !== systemFontResolver &&
    context.originModulePath !== systemFontComponent
  ) {
    return { filePath: systemFontShim, type: 'sourceFile' };
  }
  return resolveDefault(context, moduleName, platform);
};

module.exports = config;
