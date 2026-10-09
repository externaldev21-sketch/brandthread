/**
 * react-native-web's TextInput, with the system-font style mapping
 * (see shims/systemFontComponent.js). metro.config.js resolves every web
 * import of react-native-web/dist/exports/TextInput here, except this file's own.
 */
const { withFontStyle } = require('./systemFontComponent');
const TextInput = require('react-native-web/dist/exports/TextInput').default;

module.exports = { __esModule: true, default: withFontStyle(TextInput, 'TextInput') };
