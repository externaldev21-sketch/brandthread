const path = require('path');

// The app's own source compiles JSX against lib/jsx/jsx-runtime, which applies
// the account's text size and high-contrast icons to every <Text> and
// vector-icon element (see lib/jsx/displayElements.ts). node_modules keep
// React's stock runtime.
const DISPLAY_JSX_RUNTIME = path.join(__dirname, 'lib', 'jsx');

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { unstable_transformImportMeta: true }]],
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
