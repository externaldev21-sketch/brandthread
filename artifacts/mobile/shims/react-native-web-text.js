/**
 * react-native-web's Text, with the system-font style mapping
 * (see shims/systemFontComponent.js). metro.config.js resolves every web
 * import of react-native-web/dist/exports/Text here, except this file's own.
 */
const { withFontStyle } = require('./systemFontComponent');
const Text = require('react-native-web/dist/exports/Text').default;

module.exports = { __esModule: true, default: withFontStyle(Text, 'Text') };
