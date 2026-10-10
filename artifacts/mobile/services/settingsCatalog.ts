import { Feather } from '@expo/vector-icons';

export type SettingsAudience = 'buyer' | 'seller' | 'shared';

export interface SettingsCatalogItem {
  label: string;
  description: string;
  aliases: string[];
  icon: keyof typeof Feather.glyphMap;
  route?: string;
  action?: 'sign-out' | 'delete-account' | 'account-scope' | 'share-profile';
  destructive?: boolean;
  requiresGrowth?: boolean;
  /** Only shown to platform moderators (checked against the server). */
  requiresModerator?: boolean;
  audience: SettingsAudience;
  /** Row is shown but not yet interactive (e.g. an upcoming feature slot). */
  soon?: boolean;
  /**
   * Lives one level down (Accounts Center, About, Team, …): not a row of the
   * hub, but search still finds it, like Instagram's and Shopify's settings
   * search.
   */
  searchOnly?: boolean;
  /** Show `description` under the label (Instagram does this for Accounts Center only). */
  showDescription?: boolean;
}

export interface SettingsCatalogGroup {
  title: string;
  items: SettingsCatalogItem[];
}

/** Rows a hub draws: everything except search-only rows, unless the user is searching. */
export function settingsGroupsFor(catalog: SettingsCatalogGroup[], query: string, keep: (item: SettingsCatalogItem) => boolean = () => true): SettingsCatalogGroup[] {
  const q = query.trim().toLowerCase();
  return catalog
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (!keep(item)) return false;
        if (!q) return !item.searchOnly;
        return `${item.label} ${item.description} ${item.aliases.join(' ')}`.toLowerCase().includes(q);
      }),
    }))
    .filter((group) => group.items.length > 0);
}

const LEGAL_ITEMS: SettingsCatalogItem[] = [
  { label: 'Community Guidelines', description: 'What is and isn’t allowed on Brandthread', aliases: ['rules', 'guidelines', 'community', 'policy'], icon: 'book-open', route: '/community-guidelines', audience: 'shared', searchOnly: true },
  { label: 'Terms of Service', description: 'The agreement for buying and selling on Brandthread', aliases: ['terms', 'tos', 'legal', 'agreement', 'eula'], icon: 'file-text', route: '/terms', audience: 'shared', searchOnly: true },
  { label: 'Privacy Policy', description: 'How we collect, use, and protect your data', aliases: ['privacy', 'data', 'legal', 'gdpr', 'ccpa'], icon: 'file-text', route: '/privacy', audience: 'shared', searchOnly: true },
  { label: 'Refund Policy', description: 'Cancellations, returns, and refunds', aliases: ['refund', 'refunds', 'returns', 'cancellation', 'buyer protection', 'legal'], icon: 'file-text', route: '/refund-policy', audience: 'shared', searchOnly: true },
  { label: 'Seller Agreement', description: 'Fees, payouts, and rules for selling on Brandthread', aliases: ['seller terms', 'selling', 'fees', 'payouts', 'legal'], icon: 'file-text', route: '/seller-agreement', audience: 'shared', searchOnly: true },
];

/**
 * Buyer "Settings and activity" — app/buyer-settings.tsx. One scrolling list
 * in Instagram's own sections and order (Mobbin:
 * https://mobbin.com/screens/f08baa0d-fca5-4c2c-bbd1-a1e10c367714). It holds
 * every row of the old profile Menu and the old Settings hub; rows Instagram
 * keeps one level down (inside Accounts Center or About) are `searchOnly`.
 */
export const BUYER_SETTINGS_CATALOG: SettingsCatalogGroup[] = [
  {
    title: 'Your account',
    items: [
      { label: 'Accounts Center', description: 'Password, security, personal details', aliases: ['password', 'email', 'phone', 'sign in', 'security', 'account ownership', 'personal details'], icon: 'user', route: '/buyer-account-center', audience: 'buyer', showDescription: true },
      { label: 'Edit profile', description: 'Name, photo, bio, and public profile', aliases: ['profile', 'name', 'photo', 'bio'], icon: 'edit-3', route: '/(buyer)/edit-profile', audience: 'buyer' },
      { label: 'Share profile', description: 'Send your profile link or card', aliases: ['share', 'link', 'profile link'], icon: 'share-2', action: 'share-profile', audience: 'buyer' },
      { label: 'QR code', description: 'Share your Brandthread profile', aliases: ['qr', 'scan'], icon: 'grid', route: '/buyer-qr-code', audience: 'buyer' },
      { label: 'Login activity', description: 'Review devices signed into your account', aliases: ['sessions', 'devices', 'signed in'], icon: 'monitor', route: '/login-activity', audience: 'buyer', searchOnly: true },
      { label: 'Download my data', description: 'Export your profile, orders, and messages', aliases: ['export', 'data', 'download'], icon: 'download', route: '/buyer-download-data', audience: 'shared', searchOnly: true },
      { label: 'Delete account', description: 'Permanently erase your account and private data', aliases: ['remove account', 'close account'], icon: 'trash-2', action: 'delete-account', destructive: true, audience: 'shared', searchOnly: true },
    ],
  },
  {
    title: 'How you use Brandthread',
    items: [
      { label: 'Saved', description: 'Posts, products, and collections you saved', aliases: ['bookmarks'], icon: 'bookmark', route: '/buyer-saved', audience: 'buyer' },
      { label: 'Drafts', description: 'Posts you started and haven’t shared', aliases: ['draft', 'unfinished'], icon: 'file-text', route: '/buyer-drafts', audience: 'buyer' },
      { label: 'Archive', description: 'Archived posts and stories', aliases: ['archived'], icon: 'archive', route: '/buyer-archive', audience: 'buyer' },
      { label: 'Your activity', description: 'Likes, comments, searches, and time spent', aliases: ['activity', 'history'], icon: 'activity', route: '/buyer-your-activity', audience: 'buyer' },
      { label: 'Notifications', description: 'Manage push notification preferences', aliases: ['alerts', 'push'], icon: 'bell', route: '/push-notifications', audience: 'buyer' },
      { label: 'Highlights', description: 'Story highlights on your profile', aliases: ['highlight', 'stories'], icon: 'image', route: '/buyer-highlights-manager', audience: 'buyer' },
      { label: 'Following', description: 'Brands and creators you follow', aliases: ['following', 'brands'], icon: 'users', route: '/(buyer)/following', audience: 'buyer' },
      { label: 'Friends', description: 'Your friends on Brandthread', aliases: ['friend', 'people'], icon: 'user-check', route: '/(buyer)/friends', audience: 'buyer' },
      { label: 'Groups', description: 'Community group chats you joined', aliases: ['community', 'group chats', 'groups'], icon: 'message-square', route: '/community', audience: 'buyer' },
      { label: 'Invite friends', description: 'Give $10, get $10 Thread Cash', aliases: ['invite', 'referral'], icon: 'gift', route: '/buyer-invite', audience: 'buyer' },
    ],
  },
  {
    title: 'Who can see your content',
    items: [
      { label: 'Account privacy', description: 'Account privacy and who can see your content', aliases: ['privacy', 'private account', 'visibility', 'public'], icon: 'lock', route: '/buyer-privacy-settings', audience: 'buyer' },
      { label: 'Close Friends', description: 'The people who see your close friends posts', aliases: ['close friends'], icon: 'star', route: '/buyer-close-friends', audience: 'buyer' },
      { label: 'Blocked', description: 'See and unblock people you have blocked', aliases: ['block', 'unblock', 'blocked'], icon: 'slash', route: '/buyer-blocked', audience: 'shared' },
      { label: 'Follow requests', description: 'Confirm or delete requests to follow your private account', aliases: ['requests', 'follow requests', 'private account'], icon: 'user-plus', route: '/buyer-friend-requests', audience: 'buyer' },
    ],
  },
  {
    title: 'How others can interact with you',
    items: [
      { label: 'Messages and story replies', description: 'Messages, story replies, tags, mentions, comments, and sharing', aliases: ['messages', 'tags', 'mentions', 'comments', 'sharing', 'who can', 'story replies'], icon: 'message-circle', route: '/buyer-settings-detail?section=messages', audience: 'buyer' },
      { label: 'Restricted', description: 'Accounts with limited interaction with you', aliases: ['restrict', 'restricted'], icon: 'user-x', route: '/buyer-restricted', audience: 'buyer' },
      { label: 'Muted words', description: 'Hide comments and posts that contain words you choose', aliases: ['mute words', 'filter', 'hide words', 'hidden words', 'keywords'], icon: 'shield', route: '/muted-words', audience: 'shared' },
    ],
  },
  {
    title: 'What you see',
    items: [
      { label: 'Muted accounts', description: 'Accounts whose posts and comments are muted', aliases: ['mute', 'muted'], icon: 'volume-x', route: '/buyer-muted', audience: 'buyer' },
      { label: 'Content preferences', description: 'Favorites, content preferences, and suggested content', aliases: ['favorites', 'content preferences', 'suggested', 'sensitive content', 'content you see'], icon: 'sliders', route: '/buyer-settings-detail?section=content', audience: 'buyer' },
    ],
  },
  {
    title: 'Your app and media',
    items: [
      { label: 'Appearance', description: 'App theme and app icon', aliases: ['theme', 'color', 'dark mode', 'appearance', 'app icon', 'home screen icon'], icon: 'droplet', route: '/appearance', audience: 'shared' },
      { label: 'App Lock', description: 'Require Face ID, Touch ID, or fingerprint to open Brandthread', aliases: ['face id', 'fingerprint', 'touch id', 'biometric', 'passcode', 'lock'], icon: 'unlock', route: '/biometric-unlock', audience: 'shared' },
      { label: 'Language', description: 'Choose your preferred app language', aliases: ['language', 'locale'], icon: 'globe', route: '/languages', audience: 'shared' },
      { label: 'Accessibility and data usage', description: 'Media quality, data usage, and accessibility options', aliases: ['accessibility', 'media quality', 'data usage', 'wifi'], icon: 'eye', route: '/buyer-settings-detail?section=accessibility', audience: 'buyer' },
      { label: 'Tips', description: 'Replay first-run tips, or turn them off', aliases: ['tips', 'tutorial', 'walkthrough', 'replay tips', 'skip tips', 'coach marks', 'gestures'], icon: 'help-circle', route: '/first-run-tips-settings', audience: 'shared' },
    ],
  },
  {
    title: 'Your orders and payments',
    items: [
      { label: 'Orders and returns', description: 'View purchases, returns, and order support', aliases: ['orders', 'purchases', 'refunds', 'returns'], icon: 'package', route: '/(buyer)/orders', audience: 'buyer' },
      { label: 'Payment methods', description: 'Cards and payment methods saved with your account', aliases: ['cards', 'billing', 'checkout payment'], icon: 'credit-card', route: '/buyer-payment-methods', audience: 'buyer' },
      { label: 'Shipping addresses', description: 'Manage saved addresses for faster checkout', aliases: ['address', 'delivery', 'shipping'], icon: 'map-pin', route: '/buyer-addresses', audience: 'buyer' },
      { label: 'Thread Cash', description: 'Your Brandthread wallet, streaks, and store credit', aliases: ['wallet', 'credit', 'balance', 'streak'], icon: 'dollar-sign', route: '/thread-cash', audience: 'buyer' },
      { label: 'Rewards', description: 'Points and perks from the brands you shop', aliases: ['loyalty', 'points', 'rewards', 'perks'], icon: 'award', route: '/loyalty', audience: 'buyer' },
      { label: 'Gift cards', description: 'Gift cards you own and redeem', aliases: ['gift card', 'redeem', 'code'], icon: 'gift', route: '/buyer-gift-cards', audience: 'buyer' },
      { label: 'Shopping preferences', description: 'Sizes, fit, favorite categories, and recommendations', aliases: ['shopping', 'fit', 'recommendations'], icon: 'shopping-bag', route: '/shopping-preferences', audience: 'buyer' },
      { label: 'My sizes', description: 'Sizes and measurements', aliases: ['sizes', 'size', 'measurements', 'fit', 'height'], icon: 'maximize-2', route: '/buyer-my-sizes', audience: 'buyer' },
    ],
  },
  {
    title: 'For professionals',
    items: [
      { label: 'Account type', description: 'Switch between buyer and seller account experiences', aliases: ['role', 'buyer seller', 'account role', 'seller', 'sell', 'switch'], icon: 'layers', route: '/account-type-settings', audience: 'buyer' },
      { label: 'Creator program', description: 'Earn from the brands you share', aliases: ['creator', 'affiliate', 'commission'], icon: 'link', route: '/creator-program', audience: 'buyer' },
      { label: 'Freelancer jobs', description: 'Design and photo jobs from brands', aliases: ['freelance', 'jobs', 'gigs', 'work'], icon: 'briefcase', route: '/freelancer-jobs', audience: 'buyer' },
    ],
  },
  {
    title: 'More info and support',
    items: [
      { label: 'Help', description: 'Find guides, FAQs, and contact support', aliases: ['help', 'support', 'faq'], icon: 'help-circle', route: '/help', audience: 'shared' },
      { label: 'Report a problem', description: 'Tell us about a bug or an issue', aliases: ['bug', 'issue', 'feedback'], icon: 'alert-triangle', route: '/buyer-problem-report', audience: 'buyer' },
      { label: 'About', description: 'App version, terms, policies, and licenses', aliases: ['about', 'version', 'licenses', 'legal'], icon: 'info', route: '/buyer-settings-detail?section=about', audience: 'buyer' },
      ...LEGAL_ITEMS,
    ],
  },
  {
    title: 'Login',
    items: [
      { label: 'Log out', description: 'Sign out of this Brandthread account', aliases: ['log out', 'logout', 'sign out'], icon: 'log-out', action: 'sign-out', destructive: true, audience: 'shared' },
    ],
  },
];

/**
 * Seller settings hub — app/seller-settings.tsx. Shopify's Settings list
 * (Mobbin: https://mobbin.com/screens/7007b793-2530-47a7-945f-9c639a1c010d):
 * App settings, then Store settings in Shopify's order and names, then the
 * Brandthread-only groups. Store feature shortcuts that already live on the
 * seller tabs/dashboard (Design Studio, Marketing, Analytics, etc.) are not
 * duplicated here.
 */
export const SELLER_SETTINGS_CATALOG: SettingsCatalogGroup[] = [
  {
    title: 'App settings',
    items: [
      { label: 'Appearance', description: 'App theme and app icon', aliases: ['theme', 'color', 'dark mode', 'appearance', 'app icon', 'home screen icon'], icon: 'droplet', route: '/appearance', audience: 'shared' },
      { label: 'App Lock', description: 'Require Face ID, Touch ID, or fingerprint to open Brandthread', aliases: ['face id', 'fingerprint', 'touch id', 'biometric', 'biometric unlock', 'passcode', 'lock'], icon: 'unlock', route: '/biometric-unlock', audience: 'shared' },
      { label: 'Language', description: 'Choose your preferred app language', aliases: ['language', 'languages', 'locale'], icon: 'globe', route: '/languages', audience: 'shared' },
      { label: 'Tips', description: 'Replay first-run tips, or turn them off', aliases: ['tips', 'tutorial', 'walkthrough', 'replay tips', 'skip tips', 'coach marks', 'gestures'], icon: 'help-circle', route: '/first-run-tips-settings', audience: 'shared' },
    ],
  },
  {
    title: 'Store settings',
    items: [
      { label: 'Store details', description: 'Manage your brand setup and general preferences', aliases: ['general', 'brand setup', 'business details'], icon: 'briefcase', route: '/general-settings', audience: 'seller' },
      { label: 'Plan', description: 'Manage your Brandthread seller plan', aliases: ['plan', 'subscription', 'membership', 'upgrade'], icon: 'star', route: '/subscription', audience: 'seller' },
      { label: 'Compare plans', description: 'See all available Brandthread plans', aliases: ['plans', 'upgrade', 'compare'], icon: 'trending-up', route: '/plans', audience: 'seller', searchOnly: true },
      { label: 'Billing', description: 'Past invoices and charges', aliases: ['invoices', 'charges', 'receipts', 'billing history'], icon: 'clipboard', route: '/billing', audience: 'seller' },
      { label: 'Users', description: 'Invite collaborators and manage who has access', aliases: ['team', 'collaborators', 'staff', 'users', 'permissions'], icon: 'users', route: '/team', audience: 'seller' },
      { label: 'Team members by role', description: 'People with access to your store', aliases: ['users', 'staff', 'members'], icon: 'user', route: '/users', audience: 'seller', searchOnly: true },
      { label: 'Roles', description: 'Define what each teammate can do', aliases: ['roles', 'permissions'], icon: 'shield', route: '/roles', audience: 'seller' },
      { label: 'Security', description: 'Account protection and verification', aliases: ['security', 'protection', 'verification', 'activity log'], icon: 'lock', route: '/security', audience: 'seller' },
      { label: 'Payments', description: 'Accepted payment methods for your store', aliases: ['payments', 'checkout payments', 'payment settings'], icon: 'credit-card', route: '/payments', audience: 'seller' },
      { label: 'Payouts', description: 'Manage your bank account and payout history', aliases: ['money', 'bank', 'withdrawals', 'stripe'], icon: 'dollar-sign', route: '/payouts', audience: 'seller' },
      { label: 'Checkout', description: 'Storefront identity, localization, and checkout', aliases: ['store', 'storefront', 'shop', 'checkout', 'guest checkout', 'store settings'], icon: 'shopping-cart', route: '/store-settings', audience: 'seller' },
      { label: 'Shipping and delivery', description: 'Configure rates, zones, and carriers', aliases: ['shipping', 'delivery', 'rates', 'carriers'], icon: 'truck', route: '/shipping-delivery', audience: 'seller' },
      { label: 'Shipping and fulfillment', description: 'Fulfillment and shipping method settings', aliases: ['fulfillment', 'methods', 'shipping methods'], icon: 'send', route: '/shipping', audience: 'seller', searchOnly: true },
      { label: 'Taxes and duties', description: 'Tax rules and collection', aliases: ['tax', 'duties', 'vat'], icon: 'percent', route: '/taxes-duties', audience: 'seller' },
      { label: 'Locations', description: 'Manage pickup and business locations', aliases: ['locations', 'pickup'], icon: 'map-pin', route: '/locations', audience: 'seller' },
      { label: 'Apps', description: 'Connect Shopify, email marketing, and other tools', aliases: ['shopify', 'import', 'connect', 'apps', 'integrations'], icon: 'grid', route: '/integrations', audience: 'seller' },
      { label: 'Email marketing', description: 'Klaviyo and other marketing connections', aliases: ['klaviyo', 'email', 'marketing'], icon: 'mail', route: '/integrations/klaviyo', audience: 'seller', searchOnly: true },
      { label: 'Fulfillment connections', description: 'Fulfill orders through Shopify — Tapstitch, Printful, Printify', aliases: ['shopify', 'tapstitch', 'printful', 'printify', 'fulfillment', 'dropship'], icon: 'truck', route: '/integrations/shopify-fulfillment', audience: 'seller', searchOnly: true },
      { label: 'Domains', description: 'Custom domain settings', aliases: ['domain', 'custom url'], icon: 'globe', route: '/store-domain', audience: 'seller' },
      { label: 'Notifications', description: 'Choose push and email alerts for orders and store activity', aliases: ['alerts', 'push', 'email', 'orders', 'push notifications'], icon: 'bell', route: '/notifications-settings', audience: 'seller' },
      { label: 'Customer privacy', description: 'How customer data is collected and used', aliases: ['gdpr', 'ccpa', 'customer data'], icon: 'eye-off', route: '/customer-privacy', audience: 'seller' },
      { label: 'Policies', description: 'Return and cancellation policies buyers see', aliases: ['policy', 'returns', 'cancellation', 'refund policy', 'store policies'], icon: 'file-text', route: '/store-policies', audience: 'seller' },
    ],
  },
  {
    title: 'Online store',
    items: [
      { label: 'Store Builder', description: 'Customize your storefront layout', aliases: ['builder', 'layout', 'storefront'], icon: 'layout', route: '/store-builder', audience: 'seller' },
      { label: 'Storefront theme', description: 'Colors and presentation of your public store', aliases: ['storefront theme', 'colors', 'theme'], icon: 'droplet', route: '/store-theme-picker', audience: 'seller' },
      { label: 'Brand Assets', description: 'Manage your logos, colors, fonts, and saved brand assets', aliases: ['brand kit', 'logos', 'fonts', 'colors'], icon: 'layers', route: '/design-brand-assets', audience: 'seller', requiresGrowth: true },
      // 'Collections' removed here too — collection-style grids (driven by tags) now
      // live inside Store Builder as a section block, not a standalone screen.
      { label: 'Discounts', description: 'Coupon codes and offers', aliases: ['coupons', 'offers', 'promo'], icon: 'tag', route: '/discounts', audience: 'seller' },
      { label: 'Vacation mode', description: 'Pause your store and tell buyers when you will return', aliases: ['away', 'pause store', 'holiday'], icon: 'sun', route: '/vacation-mode', audience: 'seller' },
      { label: 'Account reach', description: 'Choose a global account or limit it to the United States', aliases: ['global', 'united states', 'country', 'region', 'market'], icon: 'flag', action: 'account-scope', audience: 'seller' },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'Edit seller profile', description: 'Update your brand name, photo, bio, and public profile', aliases: ['profile', 'brand details', 'seller profile'], icon: 'user', route: '/edit-profile', audience: 'seller' },
      { label: 'Login methods', description: 'Password, connected accounts, and two-factor authentication', aliases: ['password', '2fa', 'two factor'], icon: 'key', route: '/login-methods', audience: 'seller' },
      { label: 'Login activity', description: 'Review devices signed into your account', aliases: ['sessions', 'devices', 'signed in'], icon: 'monitor', route: '/login-activity', audience: 'seller' },
      { label: 'AI assistant', description: 'Assistant, data sources, and confirmations', aliases: ['ai', 'assistant', 'copilot'], icon: 'zap', route: '/ai-settings', audience: 'seller' },
      { label: 'AI credits', description: 'Balance, credit packs and usage history', aliases: ['credits', 'ai', 'top up', 'usage'], icon: 'cpu', route: '/ai-credits', audience: 'seller' },
      { label: 'Switch to buyer', description: 'Browse and shop as a buyer with this account', aliases: ['switch', 'buyer mode', 'account type'], icon: 'refresh-cw', route: '/account-type-settings', audience: 'seller' },
    ],
  },
  {
    title: 'Privacy and safety',
    items: [
      { label: 'Blocked accounts', description: 'See and unblock people you have blocked', aliases: ['block', 'unblock', 'blocked'], icon: 'slash', route: '/buyer-blocked', audience: 'shared' },
      { label: 'Muted words', description: 'Hide comments and posts that contain words you choose', aliases: ['mute words', 'filter', 'hide words', 'keywords'], icon: 'shield', route: '/muted-words', audience: 'shared' },
      { label: 'Review reports', description: 'Moderate reported content and filter holds', aliases: ['moderation', 'reports', 'admin', 'queue'], icon: 'flag', route: '/admin-reports', audience: 'seller', requiresModerator: true },
      { label: 'Review promotions', description: 'Approve or reject paid boosts and Featured slots', aliases: ['promotions', 'boosts', 'featured', 'approve', 'admin'], icon: 'check-square', route: '/admin-promotions', audience: 'seller', requiresModerator: true },
      { label: 'Invites and waitlist', description: 'Invite-only launch switch, access codes and waitlist', aliases: ['invite', 'invites', 'access code', 'waitlist', 'launch', 'admin'], icon: 'user-plus', route: '/admin-invites', audience: 'seller', requiresModerator: true },
    ],
  },
  {
    title: 'Help',
    items: [
      { label: 'Help and support', description: 'Find guides, FAQs, and contact support', aliases: ['help', 'support', 'faq'], icon: 'help-circle', route: '/help', audience: 'shared' },
      { label: 'Download my data', description: 'Export your products, orders, and customers', aliases: ['export', 'data', 'download'], icon: 'download', route: '/seller-data-export', audience: 'seller' },
      { label: 'Invite friends', description: 'Give $10, get $10 purchase-only Thread Cash; share your referral code and see rewards', aliases: ['invite', 'referral'], icon: 'gift', route: '/buyer-invite', audience: 'seller' },
      { label: 'About Brandthread', description: 'App version, terms, policies, and licenses', aliases: ['about', 'version', 'legal', 'licenses'], icon: 'info', route: '/buyer-settings-detail?section=about', audience: 'seller' },
      ...LEGAL_ITEMS,
    ],
  },
  {
    title: 'Log out',
    items: [
      { label: 'Sign out', description: 'Sign out of this Brandthread account', aliases: ['log out', 'logout'], icon: 'log-out', action: 'sign-out', destructive: true, audience: 'shared' },
    ],
  },
  {
    title: 'Danger zone',
    items: [
      { label: 'Delete account or store', description: 'Permanently erase your store and account data', aliases: ['remove account', 'close store', 'delete store'], icon: 'trash-2', action: 'delete-account', destructive: true, audience: 'seller' },
    ],
  },
];

/** @deprecated Kept for older tests/imports; use the role-specific catalogs above. */
export const SETTINGS_CATALOG: SettingsCatalogGroup[] = [...BUYER_SETTINGS_CATALOG, ...SELLER_SETTINGS_CATALOG];
