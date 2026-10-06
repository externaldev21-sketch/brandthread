/**
 * Seller-side alias for the cart. Route groups add no path segment, so
 * "/cart" resolves to (buyer)/cart, and AuthGate's role-mismatch correction
 * then moves a seller account to "/(tabs)/cart" — which used to be "Not
 * found". Same screen (and its shared ScreenHeader) as the buyer cart.
 */
export { default } from '../(buyer)/cart';
