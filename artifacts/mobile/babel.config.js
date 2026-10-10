const path = require('path');

// The app's own source compiles JSX against lib/jsx/jsx-runtime, which applies
// the account's text size and high-contrast icons to every <Text> and
// vector-icon element (see lib/jsx/displayElements.ts). node_modules keep
// React's stock runtime.
const DISPLAY_JSX_RUNTIME = path.join(__dirname, 'lib', 'jsx');

module.exports = function (api) {
  // Metro passes { platform, isDev } as the babel caller. Stripping console.*
  // only happens for a production (non-dev) NATIVE bundle; dev and the web
  // preview/export keep their logs. warn/error are always kept so Sentry
  // breadcrumbs and real diagnostics survive. See lib/buildFlags.ts.
  const platform = api.caller((c) => (c && c.platform) || null);
  const isDev = api.caller((c) => (c ? c.isDev : undefined));
  const isProdNative =
    platform !== null &&
    platform !== 'web' &&
    (isDev === undefined ? process.env.NODE_ENV === 'production' : !isDev);

  return {
    presets: [['babel-preset-expo', { unstable_transformImportMeta: true }]],
    plugins: isProdNative
      ? [['transform-remove-console', { exclude: ['error', 'warn'] }]]
      : [],
    overrides: [
      {
        test: (filename) => !!filename
          && !filename.includes(`${path.sep}node_modules${path.sep}`)
          && !filename.startsWith(DISPLAY_JSX_RUNTIME),
        presets: [['babel-preset-expo', { unstable_transformImportMeta: true, jsxImportSource: DISPLAY_JSX_RUNTIME }]],
      },
    ],
  };
};
