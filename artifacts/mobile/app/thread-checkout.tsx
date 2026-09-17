/**
 * thread-checkout — compatibility redirect/alias for buyer-checkout.
 *
 * This file is intentionally thin. All UI and logic lives in buyer-checkout.tsx.
 * Preserves source attribution: when buyers arrive via ShopProductSheet "Buy now",
 * thread-checkout carries source=thread so buyer-checkout.tsx logs correct channel.
 *
 * Navigation: ThreadPull transition is detected inside buyer-checkout by checking
 * pathname === '/thread-checkout', so the back() gesture returns to the video feed.
 */
export { default } from './buyer-checkout';
