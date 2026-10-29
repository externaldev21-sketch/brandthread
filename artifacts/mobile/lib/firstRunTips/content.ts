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
 * reads its copy from here. First line says what the screen is; the rest
 * say what to do there. 2–4 lines, plain words, no emoji.
 *
 * Screens that already had a gesture/spotlight tip (seller orders, products,
 * analytics, buyer discover) keep their old tip id so an account that saw
 * the old tip never gets a second pop-up on the same screen; the old tip's
 * gesture now lives in one of the lines.
 */
export interface ScreenExplainerCopy {
  title: string;
  lines: string[];
}

export const SCREEN_EXPLAINERS = {
  // ─── Seller ────────────────────────────────────────────────────────────
  'explain-design-gallery': {
    title: 'Design Studio',
    lines: [
      'Every design you make for your brand is saved here.',
      'Tap + to start a new canvas, or Import / Photo to bring in artwork you already have.',
      'Tap a design to keep working on it. Tap Select to delete several at once.',
    ],
  },
  'explain-design-canvas': {
    title: 'Your canvas',
    lines: [
      'Draw and lay out a design here. It saves as you go.',
      'Brush, Smudge and Eraser paint. Layers keeps each part of the design separate. The circle picks a color.',
      'The wrench adds photos and text and exports. The lightning bolt adjusts color. The arrow moves and resizes.',
      'Pinch to zoom in on details.',
    ],
  },
  'explain-manufacturer-hub': {
    title: 'Manufacturer Hub',
    lines: [
      'Find a factory to make your clothes, and track every job you send them.',
      'Find a manufacturer browses factories by category. Already have one? Invite your factory.',
      'Quotes, Samples, Orders and Messages follow each job from first price to finished stock.',
    ],
  },
  'seller-analytics': {
    title: 'Analytics',
    lines: [
      'How your store is doing: revenue, visits and what sells.',
      'Switch between Today, Week and Month at the top to compare.',
      'Tap the Revenue tile for the full breakdown.',
    ],
  },
  'seller-products': {
    title: 'Products',
    lines: [
      'Everything you sell. Buyers see these on your store and in the feed.',
      'Tap + to add a product. Tap one to change its photos, price, sizes or stock.',
      'Hold a product and drag it to change the order it shows on your store.',
    ],
  },
  'seller-orders': {
    title: 'Orders',
    lines: [
      'Every order buyers place with you, newest first.',
      'Open an order to ship it, refund it or message the buyer.',
      'Swipe an order left to fulfill it without opening it. Hold one to select several.',
    ],
  },
  'explain-store-builder': {
    title: 'Store Builder',
    lines: [
      'Your brand’s own storefront, outside the feed.',
      'Open Store Editor to change the theme, pages and sections.',
      'Moving from Shopify? Paste your store URL and your products come over.',
    ],
  },
  'explain-boost': {
    title: 'Boost a post',
    lines: [
      'Pay to show one of your posts to more buyers in the feed.',
      'Pick a post, set your budget and how many days it runs, then pay.',
      'It starts running as soon as the payment clears.',
    ],
  },
  'explain-meta-ads': {
    title: 'Meta ads',
    lines: [
      'Ads for your brand on Instagram and Facebook, run from here.',
      'Connect your Meta account once, then advertise a product, your store or a video.',
      'Pause, resume, change the budget or duplicate any campaign from its row.',
    ],
  },
  'explain-popup-mode': {
    title: 'Pop-up mode',
    lines: [
      'Sell in person at markets and pop-ups. Buyers tap their card on your iPhone.',
      'Add the products they’re buying, set quantities, then charge.',
      'Each sale becomes a normal order and comes out of your stock.',
    ],
  },
  'explain-payouts': {
    title: 'Payouts',
    lines: [
      'Where the money from your sales gets sent to your bank.',
      'Finish verification and add your bank first. Nothing pays out until then.',
      'Thread Cash buyers paid you sits in its own card. Cash out moves it to your bank.',
      'See what’s pending, in transit and paid, and set how often you get paid.',
    ],
  },
  'explain-plans': {
    title: 'Plans',
    lines: [
      'The monthly plan your brand runs on. It sets your features and what we take per sale.',
      'Starter covers your store. Growth adds Design Studio, Manufacturer Hub and Live. Pro adds your team and deeper analytics.',
      'Every plan starts with a free trial. Paying yearly gets you two months free.',
    ],
  },
  'explain-go-live': {
    title: 'Go live',
    lines: [
      'Run a live shopping show. Buyers watch, chat and buy while you’re on air.',
      'Name the show, add a cover photo and pin the products you’ll sell.',
      'Then check your camera and mic, and tap Start show.',
    ],
  },
  'explain-marketing': {
    title: 'Marketing',
    lines: [
      'Every way to get buyers to your store, in one place.',
      'Discount codes, email, follower push and giveaways reach people who already know you.',
      'Links, link in bio, catalogs and pixels grow and track traffic from Instagram, TikTok and Meta.',
    ],
  },
  'explain-email-campaigns': {
    title: 'Email campaigns',
    lines: [
      'Email the buyers and fans who signed up to hear from you.',
      'Audience shows who’s on your list. Sender details sets the name they see.',
      'Tap New campaign to write one and send it.',
    ],
  },
  'explain-seller-drops': {
    title: 'Drops',
    lines: [
      'Release a product at a set time so fans line up for it.',
      'Tap New drop, pick the product and choose when it goes live.',
      'Waitlist shows who asked to be notified before it drops.',
    ],
  },
  'explain-seller-giveaways': {
    title: 'Giveaways',
    lines: [
      'Give away a product to grow your following.',
      'Tap New giveaway, pick the prize, how people enter and how long it runs.',
      'Winners are picked when it ends.',
    ],
  },
  'explain-discounts': {
    title: 'Discount codes',
    lines: [
      'Codes buyers enter at checkout for money off.',
      'Type a code or generate one, then set the amount and when it ends.',
      'Tap a code to edit, copy, pause or delete it.',
    ],
  },
  'explain-growth-links': {
    title: 'Links',
    lines: [
      'Trackable links to your store for anywhere you post.',
      'Make one for each place: your Instagram bio, a TikTok, an email.',
      'Each link counts its own clicks, orders and revenue, so you know what works.',
    ],
  },
  'explain-link-in-bio': {
    title: 'Link in bio',
    lines: [
      'One page of links for your Instagram or TikTok bio.',
      'Add links, switch them on or off and drag to reorder. The preview updates as you go.',
    ],
  },
  'explain-follower-push': {
    title: 'Follower push',
    lines: [
      'Send a notification straight to your followers’ phones.',
      'Write a title and message, add a link if you want, and check the preview.',
      'You get one push a day to followers, and one a week to past buyers.',
    ],
  },
  'explain-creator-program': {
    title: 'Creator program',
    lines: [
      'Creators sell your products and earn a cut of each sale.',
      'Turn the program on, then invite creators by username.',
      'Tap a creator to see their clicks and sales, or pause them.',
    ],
  },
  'explain-membership-levels': {
    title: 'Membership levels',
    lines: [
      'Reward your best buyers. They move from Member to Insider to Inner Circle as they spend.',
      'Set how much it takes to reach each level.',
      'Give Inner Circle early access to your drops.',
    ],
  },
  'explain-rfq-list': {
    title: 'Requests for quote',
    lines: [
      'Requests you’ve sent factories asking what they’d charge.',
      'Each row shows how many quotes came back.',
      'Tap one to compare quotes side by side and pick a factory.',
    ],
  },

  // ─── Buyer ─────────────────────────────────────────────────────────────
  'buyer-discover': {
    title: 'Discover',
    lines: [
      'Find brands, people and pieces you don’t follow yet.',
      'Search at the top, or switch between For You, Fits, Brands, People and Drops.',
      'Swipe up to keep exploring. Tap anything to open it.',
    ],
  },
  'explain-thread-cash': {
    title: 'Thread Cash',
    lines: [
      'Credit you earn on Brandthread to spend on your next order.',
      'Keep your streak going to earn more. How it works has the rules.',
      'Use it at checkout. It can’t be cashed out.',
    ],
  },
  'explain-bag': {
    title: 'Your bag',
    lines: [
      'Everything you’ve added, ready to buy.',
      'Change size or quantity right here. Shipping shows each seller’s real rate.',
      'Go to checkout pays for everything at once. Each seller ships their own items.',
    ],
  },
  'explain-checkout': {
    title: 'Checkout',
    lines: [
      'One page to pay: contact, shipping, payment, then your order summary.',
      'Apple Pay or Google Pay at the top fills it all in for you.',
      'Add a promo code or Thread Cash before you tap Pay.',
    ],
  },
  'explain-buyer-orders': {
    title: 'My orders',
    lines: [
      'Everything you’ve bought, newest first.',
      'Tap an order to track it, message the seller or start a return.',
      'Search finds any past order.',
    ],
  },
  'explain-live-feed': {
    title: 'LIVE',
    lines: [
      'Brands streaming right now.',
      'Tap a show to join. Watch, chat and buy what they’re showing before it sells out.',
    ],
  },
  'explain-buyer-drops': {
    title: 'Drops',
    lines: [
      'Limited releases from brands, at a set time.',
      'Live now is buyable. Upcoming lets you get notified the moment it drops.',
    ],
  },
  'explain-community': {
    title: 'Community',
    lines: [
      'Group chats about the things you’re into.',
      'Join an official Brandthread group or a popular one. Yours stay at the top.',
    ],
  },
} satisfies Record<string, ScreenExplainerCopy>;

export type ScreenExplainerId = keyof typeof SCREEN_EXPLAINERS;
