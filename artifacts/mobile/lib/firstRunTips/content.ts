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
import type { ExplainerStep } from '@/components/first-run-tips/ExplainerSheet';

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

export const SELLER_INBOX_GESTURE: { gesture: GestureKind; title: string; body: string } = {
  gesture: 'swipe-left', title: 'Swipe a conversation', body: 'Mark it read or archive it',
};

export const BUYER_PRODUCT_DETAIL_SPOTLIGHT = {
  title: 'Add to bag or buy now',
  body: 'Buy now skips your bag and goes straight to checkout.',
};

export const BUYER_INBOX_GESTURE: { gesture: GestureKind; title: string; body: string } = {
  gesture: 'swipe-left', title: 'Swipe a chat', body: 'Mute or delete it',
};

export const LIVE_VIEWER_GESTURE: { gesture: GestureKind; title: string; body: string } = {
  gesture: 'tap', title: 'Tap a product', body: 'Buy it without leaving the live stream',
};

/**
 * One-time "what is this screen" explainers (the `explainer` variant),
 * keyed by tip id. Each screen mounts <ScreenExplainer id="..." />, which
 * reads its copy from here: the screen's name and 2–3 swipeable mini-cards,
 * ONE idea each (icon, a few-word title, one line). Plain words, no emoji.
 *
 * MAJOR screens only (Dev): a screen that is self-evident, or a sub-step of
 * one already explained (sale, share, stories, small settings, sub-flows),
 * gets no pop-up. The Dashboard's explainer is its 3-step tour and the
 * buyer Feed's is its "Watching Threads" guide, so neither is listed here.
 *
 * Analytics and Discover keep the tip ids their old gesture/spotlight tips
 * used, so an account that saw the old tip never gets a second pop-up.
 */
export interface ScreenExplainerCopy {
  title: string;
  steps: ExplainerStep[];
}

export const SCREEN_EXPLAINERS = {
  // ─── Seller ────────────────────────────────────────────────────────────
  'explain-design-gallery': {
    title: 'Design Studio',
    steps: [
      { icon: 'grid', title: 'Your designs', body: 'Everything you design for your brand is saved here.' },
      { icon: 'plus', title: 'Start one', body: 'Tap + for a blank canvas, or Import a photo or artwork you already have.' },
      { icon: 'edit-2', title: 'Draw on the canvas', body: 'Brush, Eraser and Layers along the top. Tap Modify for text, photos and export.' },
    ],
  },
  'explain-manufacturer-hub': {
    title: 'Manufacturer Hub',
    steps: [
      { icon: 'search', title: 'Find a factory', body: 'Browse manufacturers by category, or invite the one you already use.' },
      { icon: 'file-text', title: 'Quotes and samples', body: 'Ask what they’d charge, then order a sample before you commit.' },
      { icon: 'package', title: 'Track production', body: 'Orders and Messages follow each job until your stock is done.' },
    ],
  },
  'seller-analytics': {
    title: 'Analytics',
    steps: [
      { icon: 'bar-chart-2', title: 'How your store is doing', body: 'Revenue, visits and what sells, updated as orders come in.' },
      { icon: 'calendar', title: 'Compare periods', body: 'Switch between Today, Week and Month at the top.' },
      { icon: 'pie-chart', title: 'Dig in', body: 'Tap the Revenue tile for the full breakdown.' },
    ],
  },
  'explain-popup-mode': {
    title: 'Pop-up mode',
    steps: [
      { icon: 'map-pin', title: 'Sell in person', body: 'At markets and pop-ups. Buyers tap their card on your iPhone.' },
      { icon: 'shopping-cart', title: 'Ring it up', body: 'Add the products, set quantities, then charge.' },
      { icon: 'check-circle', title: 'A normal order', body: 'Each sale shows in Orders and comes out of your stock.' },
    ],
  },
  'explain-payouts': {
    title: 'Payouts',
    steps: [
      { icon: 'shield', title: 'Get verified first', body: 'Verify your identity and add your bank. Nothing pays out until then.' },
      { icon: 'clock', title: 'Track your money', body: 'See what’s pending, in transit and paid, and set how often you’re paid.' },
      { icon: 'dollar-sign', title: 'Thread Cash', body: 'Thread Cash buyers paid you has its own card. Cash out sends it to your bank.' },
    ],
  },
  'explain-create-ad': {
    title: 'Create ad',
    steps: [
      { icon: 'eye', title: 'See it as buyers will', body: 'The preview at the top is exactly how the ad shows in the feed.' },
      { icon: 'image', title: 'Build the ad', body: 'Add a video or photos, a headline and a button.' },
      { icon: 'users', title: 'Budget and launch', body: 'Set a daily budget and days, check who it will reach, then Launch.' },
    ],
  },
  'explain-boost': {
    title: 'Boost a post',
    steps: [
      { icon: 'trending-up', title: 'Reach more buyers', body: 'Pay to show one of your posts to more people in the feed.' },
      { icon: 'sliders', title: 'Set it up', body: 'Pick a post, then your budget and how many days it runs.' },
      { icon: 'credit-card', title: 'Pay and go', body: 'It starts running as soon as the payment clears.' },
    ],
  },

  // ─── Buyer ─────────────────────────────────────────────────────────────
  'buyer-discover': {
    title: 'Discover',
    steps: [
      { icon: 'compass', title: 'New to you', body: 'Brands, people and pieces you don’t follow yet.' },
      { icon: 'sliders', title: 'Pick a lane', body: 'For You, Fits, Brands, People or Drops, or search at the top.' },
      { icon: 'chevrons-up', title: 'Keep going', body: 'Swipe up for more. Tap anything to open it.' },
    ],
  },
  'explain-thread-cash': {
    title: 'Thread Cash',
    steps: [
      { icon: 'gift', title: 'Credit to spend', body: 'Thread Cash comes off your next order on Brandthread.' },
      { icon: 'zap', title: 'Earn more', body: 'Keep your streak going. How it works has the rules.' },
      { icon: 'shopping-bag', title: 'Use it at checkout', body: 'Apply it before you pay. It can’t be cashed out.' },
    ],
  },
} satisfies Record<string, ScreenExplainerCopy>;

export type ScreenExplainerId = keyof typeof SCREEN_EXPLAINERS;
