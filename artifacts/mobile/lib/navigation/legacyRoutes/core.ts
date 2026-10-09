import type { LegacyRoute } from './types';

/**
 * Old redirect-only screens, placeholders and removed features.
 * Each one used to be a file in app/; its feature now lives at `to`.
 */
export const CORE_LEGACY_ROUTES: LegacyRoute[] = [
  // Redirect-only files: the redirect now lives here instead of in its own screen.
  { from: '/ai-assistant', to: '/ai-brain', note: 'Was a redirect stub to the AI chat.' },
  { from: '/bg-removal', to: '/design-bg-removal', note: 'Was a redirect stub to Remove Background.' },
  { from: '/buyer-account-control', to: '/delete-account', note: 'Was a re-export of Delete account.' },
  { from: '/app-icon', to: '/appearance', note: 'App icon lives in Appearance.' },
  { from: '/app-theme', to: '/appearance', note: 'App theme lives in Appearance.' },
  {
    from: '/shipping-label',
    to: (p) => (p.orderId ? `/fulfill-order?orderId=${encodeURIComponent(p.orderId)}&step=3` : '/(tabs)/orders'),
    note: 'Buying a label is step 3 of Fulfill order.',
  },
  { from: '/buyer-refund-request', to: (p) => (p.orderId ? `/buyer-return-request?orderId=${encodeURIComponent(p.orderId)}` : '/(buyer)/orders'), note: 'Unlinked duplicate of the Return / refund request.' },
  { from: '/drafts', to: '/(tabs)/products?filter=draft', note: 'Drafts is a filter on the Products tab.' },

  // Placeholders nothing linked to.
  { from: '/automation', to: '/(tabs)/marketing', note: 'Unlinked "coming" placeholder; Marketing holds the real tools.' },
  { from: '/mobile-app-builder', to: '/store-builder', note: 'Unlinked marketing placeholder with a dead CTA.' },
  { from: '/metafields', to: '/store-settings', note: 'Unlinked placeholder; rows were no-ops.' },

  // Removed features: data and API stay, the screens go.
  { from: '/ai-brand-memory', to: '/ai-settings', note: 'Brand Memory removed from the app (server + data kept).' },
  { from: '/seller-drops', to: '/(tabs)/products', note: 'Drops removed from the seller app (server + data kept).' },
  { from: '/seller-drop-create', to: '/(tabs)/products', note: 'Drops removed from the seller app (server + data kept).' },
  { from: '/seller-drop-preview', to: '/(tabs)/products', note: 'Drops removed from the seller app (server + data kept).' },
  { from: '/buyer-drops', to: '/(buyer)/discover', note: 'Unlinked drops browse list; drop cards in Discover/feed still open a drop.' },

  // Paths the AI assistant's help answers link to (api-server lib/aiHelpDocs.ts)
  // that were never screens of their own.
  { from: '/inventory', to: '/(tabs)/products?filter=low-stock', note: 'AI help link; stock lives on the Products tab.' },
  { from: '/shipping-rates', to: '/shipping', note: 'AI help link; rates live in Shipping & Fulfillment.' },
  { from: '/discount-codes', to: '/discounts', note: 'AI help link; codes live in Discounts.' },
];
