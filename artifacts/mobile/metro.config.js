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
// Pop-up mode's Tap to Pay (lib/tapToPay.ts) lazily requires the optional
// Stripe Terminal SDK. It is not a dependency until Tap to Pay is enabled
// (Apple entitlement + EAS build), so resolve it to a null shim on web and
// whenever the package isn't installed — Metro then bundles either way.
const STRIPE_TERMINAL = '@stripe/stripe-terminal-react-native';
const stripeTerminalShim = path.resolve(__dirname, 'shims/stripe-terminal-react-native.js');
let stripeTerminalInstalled = false;
try {
  require.resolve(STRIPE_TERMINAL, { paths: [__dirname] });
  stripeTerminalInstalled = true;
} catch {
  stripeTerminalInstalled = false;
}

const _orig = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react-native-agora' && platform === 'web') {
    return { filePath: agoraShim, type: 'sourceFile' };
  }
  if (moduleName === STRIPE_TERMINAL && (platform === 'web' || !stripeTerminalInstalled)) {
    return { filePath: stripeTerminalShim, type: 'sourceFile' };
  }
  if (_orig) return _orig(context, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
