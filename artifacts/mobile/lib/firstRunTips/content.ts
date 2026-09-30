/**
 * Copy + variant registry for PR 1's first 15 screens. Kept as one file so
 * the PR's coverage table and the actual shipped copy can never drift apart,
 * and so PR 2 (the remaining-screens follow-up) has one obvious place to add
 * to rather than inventing a second pattern.
 *
 * Each screen still renders its own <FirstRunTip id={...} variant={...} />
 * with its own measured targets/refs — this file only owns the *copy* and
 * *variant choice*, not the per-screen wiring.
 */
import type { FirstRunTipStep, GestureKind } from '@/components/first-run-tips/types';
import type { FullScreenGuideRow } from '@/components/first-run-tips/FullScreenGuideTip';

export const SELLER_DASHBOARD_STEPS: FirstRunTipStep[] = [
  { title: 'This is your dashboard', body: 'Sales, orders, and store health at a glance — updates in real time.' },
  { title: 'Traffic sources', body: 'See exactly where your buyers are finding you: feed, search, profile, or off-app.' },
  { title: 'Studio and Products', body: 'Use the side circles to jump straight into Studio or manage what you sell.' },
];

export const MOCKUP_TO_MODEL_STEPS: FirstRunTipStep[] = [
  { title: 'Upload a flat mockup', body: 'A product photo or sketch — front-facing works best.' },
  { title: 'We put it on a model', body: 'Choose a pose and body type; the design wraps onto real fabric automatically.' },
];

export const DESIGN_STUDIO_ROWS: FullScreenGuideRow[] = [
  { gesture: 'tap', title: 'Tap a tool', body: 'Switch between draw, text, and layers' },
  { gesture: 'pinch', title: 'Pinch to zoom', body: 'Get close on the details' },
  { gesture: 'drag', title: 'Drag to move', body: 'Reposition any layer on the canvas' },
  { gesture: 'hold', title: 'Hold a layer', body: 'Reorder it in the stack' },
];

export const STUDIO_MENU_SCRUB_ROWS: FullScreenGuideRow[] = [
  { gesture: 'drag', title: 'Drag across the menu', body: 'Scrub between tools without lifting your finger' },
  { gesture: 'tap', title: 'Tap a tool', body: 'Jump straight in' },
  { gesture: 'hold', title: 'Hold the center', body: 'Open the full Studio menu' },
];

export const ADD_PRODUCT_STEPS: FirstRunTipStep[] = [
  { title: 'Start with photos', body: 'Your first photo becomes the cover — buyers see it everywhere first.' },
  { title: 'Price and variants', body: 'Set sizes, colors, and stock here. You can always add more later.' },
];

export const SELLER_ORDERS_GESTURE: { gesture: GestureKind; title: string; body: string } = {
  gesture: 'swipe-left', title: 'Swipe an order', body: 'Fulfill or message the buyer without opening it',
};

export const SELLER_INBOX_GESTURE: { gesture: GestureKind; title: string; body: string } = {
  gesture: 'swipe-left', title: 'Swipe a conversation', body: 'Mark it read or archive it',
};

export const SELLER_ANALYTICS_SPOTLIGHT = {
  title: 'Your revenue at a glance',
  body: 'This updates in real time as orders come in — tap it for the full breakdown.',
};

export const SELLER_PRODUCTS_GESTURE: { gesture: GestureKind; title: string; body: string } = {
  gesture: 'hold', title: 'Hold a product', body: 'Drag to reorder how it appears on your store',
};

export const BUYER_DISCOVER_GESTURE: { gesture: GestureKind; title: string; body: string } = {
  gesture: 'swipe-up', title: 'Swipe up', body: 'Keep exploring new brands and products',
};

export const BUYER_PRODUCT_DETAIL_SPOTLIGHT = {
  title: 'Add to cart or buy now',
  body: 'Buy now skips your cart and goes straight to checkout.',
};

export const BUYER_CHECKOUT_STEPS: FirstRunTipStep[] = [
  { title: 'One page, one total', body: 'Shipping, payment, and review all happen right here.' },
  { title: 'Save it for next time', body: 'Your address and card are saved securely for a faster checkout later.' },
];

export const BUYER_INBOX_GESTURE: { gesture: GestureKind; title: string; body: string } = {
  gesture: 'swipe-left', title: 'Swipe a chat', body: 'Mute or delete it',
};

export const BUYER_CART_STEPS: FirstRunTipStep[] = [
  { title: 'Everything you’ve added', body: 'Grouped by seller — each ships separately.' },
  { title: 'Ready when you are', body: 'Checkout totals update live as you adjust quantities.' },
];

export const LIVE_VIEWER_GESTURE: { gesture: GestureKind; title: string; body: string } = {
  gesture: 'tap', title: 'Tap a product', body: 'Buy it without leaving the live stream',
};
