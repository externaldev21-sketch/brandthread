/**
 * @stripe/stripe-terminal-react-native shim.
 * Metro resolves this file on web, and on native when the Stripe Terminal SDK
 * isn't installed (see metro.config.js). lib/tapToPay.ts treats null as
 * "Tap to Pay isn't in this build" and Pop-up mode shows its unavailable state.
 */
module.exports = null;
