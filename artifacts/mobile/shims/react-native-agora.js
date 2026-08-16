/**
 * react-native-agora web shim.
 * react-native-agora uses native CodeGen modules that cannot run on web.
 * Metro resolves this file instead on the web platform so the app
 * continues to work (with degraded live-streaming UX showing a placeholder).
 */
module.exports = null;
