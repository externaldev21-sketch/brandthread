import { Feather } from '@expo/vector-icons';

export type SettingsAudience = 'buyer' | 'seller' | 'shared';

export interface SettingsCatalogItem {
  label: string;
  description: string;
  aliases: string[];
  icon: keyof typeof Feather.glyphMap;
  route?: string;
  action?: 'sign-out' | 'delete-account' | 'account-scope';
  destructive?: boolean;
  requiresGrowth?: boolean;
  /** Only shown to platform moderators (checked against the server). */
  requiresModerator?: boolean;
  audience: SettingsAudience;
  /** Row is shown but not yet interactive (e.g. an upcoming feature slot). */
  soon?: boolean;
}

export interface SettingsCatalogGroup {
  title: string;
  items: SettingsCatalogItem[];
}

/**
 * Buyer settings hub — its own screen (app/buyer-settings.tsx), organized as
 * a compact, grouped iOS-Settings-style list. Every destination here is an
 * existing screen; nothing that used to be reachable from Settings was
 * dropped, it was regrouped under one of these sections.
 */
export const BUYER_SETTINGS_CATALOG: SettingsCatalogGroup[] = [
  {
    title: 'Account',
    items: [
      { label: 'Edit profile', description: 'Name, photo, bio, and public profile', aliases: ['profile', 'personal details', 'name', 'photo', 'bio'], icon: 'user', route: '/(buyer)/edit-profile', audience: 'buyer' },
      { label: 'Accounts Center', description: 'Password, email, phone, and sign-in methods', aliases: ['password', 'email', 'phone', 'sign in', 'security', 'account ownership'], icon: 'key', route: '/buyer-account-center', audience: 'buyer' },
      { label: 'Login activity', description: 'Review devices signed into your account', aliases: ['sessions', 'devices', 'signed in'], icon: 'monitor', route: '/buyer-login-activity', audience: 'buyer' },
      { label: 'Account type', description: 'Switch between buyer and seller account experiences', aliases: ['role', 'buyer seller', 'account role'], icon: 'layers', route: '/account-type-settings', audience: 'buyer' },
      { label: 'Your activity', description: 'Likes, comments, searches, and time spent', aliases: ['activity', 'history'], icon: 'activity', route: '/buyer-your-activity', audience: 'buyer' },
      { label: 'Archive', description: 'Archived posts and stories', aliases: ['archived'], icon: 'archive', route: '/buyer-archive', audience: 'buyer' },
      { label: 'Saved', description: 'Posts, products, and collections you saved', aliases: ['bookmarks'], icon: 'bookmark', route: '/buyer-saved', audience: 'buyer' },
      { label: 'QR code', description: 'Share your Brandthread profile', aliases: ['qr', 'scan'], icon: 'grid', route: '/buyer-qr-code', audience: 'buyer' },
      { label: 'Invite friends', description: 'Share your invite code and earn rewards', aliases: ['invite', 'referral'], icon: 'gift', route: '/buyer-invite', audience: 'buyer' },
      { label: 'Following brands', description: 'Brands and creators you follow', aliases: ['following', 'brands'], icon: 'users', route: '/(buyer)/following', audience: 'buyer' },
    ],
  },
  {
    title: 'Orders & returns',
    items: [
      { label: 'Orders and returns', description: 'View purchases, returns, and order support', aliases: ['orders', 'purchases', 'refunds', 'returns'], icon: 'package', route: '/(buyer)/orders', audience: 'buyer' },
      { label: 'Shopping preferences', description: 'Sizes, fit, favorite categories, and recommendations', aliases: ['shopping', 'sizes', 'fit', 'recommendations'], icon: 'shopping-bag', route: '/shopping-preferences', audience: 'buyer' },
    ],
  },
  {
    title: 'Addresses',
    items: [
      { label: 'Shipping addresses', description: 'Manage saved addresses for faster checkout', aliases: ['address', 'delivery', 'shipping'], icon: 'map-pin', route: '/buyer-addresses', audience: 'buyer' },
    ],
  },
  {
    title: 'Payment methods',
    items: [
      { label: 'Payment methods', description: 'Cards and payment methods saved with your account', aliases: ['cards', 'billing', 'checkout payment'], icon: 'credit-card', route: '/buyer-payment-methods', audience: 'buyer' },
    ],
  },
  {
    title: 'Thread Cash',
    items: [
      { label: 'Thread Cash', description: 'Your Brandthread wallet and store credit — coming soon', aliases: ['wallet', 'credit', 'balance'], icon: 'dollar-sign', audience: 'buyer', soon: true },
    ],
  },
  {
    title: 'Notifications',
    items: [
      { label: 'Notifications', description: 'Manage push notification preferences', aliases: ['alerts', 'push'], icon: 'bell', route: '/push-notifications', audience: 'buyer' },
    ],
  },
  {
    title: 'Privacy & safety',
    items: [
      { label: 'Privacy & activity', description: 'Account privacy and who can see your content', aliases: ['privacy', 'activity', 'visibility'], icon: 'lock', route: '/buyer-privacy-settings', audience: 'buyer' },
      { label: 'Blocked accounts', description: 'See and unblock people you have blocked', aliases: ['block', 'unblock', 'blocked'], icon: 'slash', route: '/buyer-blocked', audience: 'shared' },
      { label: 'Muted accounts', description: 'Accounts whose posts and comments are muted', aliases: ['mute', 'muted'], icon: 'volume-x', route: '/buyer-muted', audience: 'buyer' },
      { label: 'Restricted accounts', description: 'Accounts with limited interaction with you', aliases: ['restrict', 'restricted'], icon: 'user-x', route: '/buyer-restricted', audience: 'buyer' },
      { label: 'Close Friends', description: 'The people who see your close friends posts', aliases: ['close friends'], icon: 'star', route: '/buyer-close-friends', audience: 'buyer' },
      { label: 'Muted words', description: 'Hide comments and posts that contain words you choose', aliases: ['mute words', 'filter', 'hide words', 'keywords'], icon: 'shield', route: '/muted-words', audience: 'shared' },
      { label: 'Who can message and see me', description: 'Messages, story replies, tags, mentions, comments, and sharing', aliases: ['messages', 'tags', 'mentions', 'comments', 'sharing', 'who can'], icon: 'message-circle', route: '/buyer-settings-detail?section=messages', audience: 'buyer' },
      { label: 'Content you see', description: 'Favorites, content preferences, and suggested content', aliases: ['favorites', 'content preferences', 'suggested', 'sensitive content'], icon: 'sliders', route: '/buyer-settings-detail?section=content', audience: 'buyer' },
    ],
  },
  {
    title: 'Appearance',
    items: [
      { label: 'App theme', description: 'Choose your Brandthread color finish', aliases: ['theme', 'color', 'dark mode', 'appearance'], icon: 'droplet', route: '/app-theme', audience: 'shared' },
      { label: 'App icon', description: 'Choose the icon used on your device', aliases: ['home screen icon'], icon: 'smartphone', route: '/app-icon', audience: 'shared' },
      { label: 'App Lock', description: 'Require Face ID, Touch ID, or fingerprint to open Brandthread', aliases: ['face id', 'fingerprint', 'touch id', 'biometric', 'passcode', 'lock'], icon: 'unlock', route: '/biometric-unlock', audience: 'shared' },
      { label: 'Language', description: 'Choose your preferred app language', aliases: ['language', 'locale'], icon: 'globe', route: '/languages', audience: 'shared' },
      { label: 'Accessibility & data usage', description: 'Media quality, data usage, and accessibility options', aliases: ['accessibility', 'media quality', 'data usage', 'wifi'], icon: 'eye', route: '/buyer-settings-detail?section=accessibility', audience: 'buyer' },
    ],
  },
  {
    title: 'Help & support',
    items: [
      { label: 'Help and support', description: 'Find guides, FAQs, and contact support', aliases: ['help', 'support', 'faq'], icon: 'help-circle', route: '/help', audience: 'shared' },
      { label: 'Report a problem', description: 'Tell us about a bug or an issue', aliases: ['bug', 'issue', 'feedback'], icon: 'alert-triangle', route: '/buyer-problem-report', audience: 'buyer' },
      { label: 'Download my data', description: 'Export your profile, orders, and messages', aliases: ['export', 'data', 'download'], icon: 'download', route: '/buyer-download-data', audience: 'shared' },
      { label: 'About Brandthread', description: 'App version, licenses, and more', aliases: ['about', 'version', 'licenses'], icon: 'info', route: '/buyer-settings-detail?section=about', audience: 'buyer' },
    ],
  },
  {
    title: 'Legal',
    items: [
      { label: 'Community Guidelines', description: 'What is and isn’t allowed on Brandthread', aliases: ['rules', 'guidelines', 'community', 'policy'], icon: 'book-open', route: '/community-guidelines', audience: 'shared' },
      { label: 'Terms of Service', description: 'The agreement for buying and selling on Brandthread', aliases: ['terms', 'tos', 'legal', 'agreement', 'eula'], icon: 'file-text', route: '/terms', audience: 'shared' },
      { label: 'Privacy Policy', description: 'How we collect, use, and protect your data', aliases: ['privacy', 'data', 'legal', 'gdpr', 'ccpa'], icon: 'file-text', route: '/privacy', audience: 'shared' },
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
      { label: 'Delete account', description: 'Permanently erase your account and private data', aliases: ['remove account', 'close account'], icon: 'trash-2', action: 'delete-account', destructive: true, audience: 'shared' },
    ],
  },
];

/**
 * Seller settings hub — its own screen (app/seller-settings.tsx). Store
 * feature shortcuts that already live on the seller tabs/dashboard (Design
 * Studio, Inventory, Marketing, Analytics, etc.) are intentionally not
 * duplicated here — this catalog covers settings and preferences only.
 */
export const SELLER_SETTINGS_CATALOG: SettingsCatalogGroup[] = [
  {
    title: 'Account & security',
    items: [
      { label: 'Edit seller profile', description: 'Update your brand name, photo, bio, and public profile', aliases: ['profile', 'brand details', 'seller profile'], icon: 'user', route: '/edit-profile', audience: 'seller' },
      { label: 'Login methods', description: 'Password, connected accounts, and two-factor authentication', aliases: ['security', 'password', '2fa', 'two factor'], icon: 'key', route: '/login-methods', audience: 'seller' },
      { label: 'Login activity', description: 'Review devices signed into your account', aliases: ['sessions', 'devices', 'signed in'], icon: 'monitor', route: '/login-activity', audience: 'seller' },
      { label: 'Security', description: 'Account protection and verification', aliases: ['security', 'protection', 'verification'], icon: 'shield', route: '/security', audience: 'seller' },
      { label: 'AI assistant', description: 'Assistant, data sources, and confirmations', aliases: ['ai', 'assistant', 'copilot'], icon: 'zap', route: '/ai-settings', audience: 'seller' },
    ],
  },
  {
    title: 'Store profile & branding',
    items: [
      { label: 'Store details', description: 'Manage your brand setup and general preferences', aliases: ['general', 'brand setup', 'business details'], icon: 'briefcase', route: '/general-settings', audience: 'seller' },
      { label: 'Store settings', description: 'Storefront identity, localization, and checkout', aliases: ['store', 'storefront', 'shop', 'checkout'], icon: 'home', route: '/store-settings', audience: 'seller' },
      { label: 'Store Builder', description: 'Customize your storefront layout', aliases: ['builder', 'layout', 'storefront'], icon: 'layout', route: '/store-builder', audience: 'seller' },
      { label: 'Storefront theme', description: 'Colors and presentation of your public store', aliases: ['storefront theme', 'colors'], icon: 'droplet', route: '/store-theme-picker', audience: 'seller' },
      { label: 'Brand Assets', description: 'Manage your logos, colors, fonts, and saved brand assets', aliases: ['brand kit', 'logos', 'fonts', 'colors'], icon: 'layers', route: '/design-brand-assets', audience: 'seller', requiresGrowth: true },
      { label: 'Collections', description: 'Group products into collections', aliases: ['collections', 'group products'], icon: 'grid', route: '/store-collections', audience: 'seller' },
      { label: 'Domains', description: 'Custom domain settings', aliases: ['domain', 'custom url'], icon: 'globe', route: '/store-domain', audience: 'seller' },
      { label: 'Discounts', description: 'Coupon codes and offers', aliases: ['coupons', 'offers', 'promo'], icon: 'tag', route: '/discounts', audience: 'seller' },
      { label: 'Locations', description: 'Manage pickup and business locations', aliases: ['locations', 'pickup'], icon: 'map-pin', route: '/locations', audience: 'seller' },
      { label: 'Account reach', description: 'Choose a global account or limit it to the United States', aliases: ['global', 'united states', 'country', 'region', 'market'], icon: 'flag', action: 'account-scope', audience: 'seller' },
      { label: 'Vacation mode', description: 'Pause your store and tell buyers when you will return', aliases: ['away', 'pause store', 'holiday'], icon: 'sun', route: '/vacation-mode', audience: 'seller' },
    ],
  },
  {
    title: 'Payouts & bank',
    items: [
      { label: 'Payouts', description: 'Manage your bank account and payout history', aliases: ['money', 'bank', 'withdrawals', 'stripe'], icon: 'dollar-sign', route: '/payouts', audience: 'seller' },
      { label: 'Billing history', description: 'Past invoices and charges', aliases: ['invoices', 'charges', 'receipts'], icon: 'clipboard', route: '/billing', audience: 'seller' },
      { label: 'Payment settings', description: 'Accepted payment methods for your store', aliases: ['payments', 'checkout payments'], icon: 'credit-card', route: '/payments', audience: 'seller' },
    ],
  },
  {
    title: 'Shipping & returns policies',
    items: [
      { label: 'Shipping and delivery', description: 'Configure rates, zones, and carriers', aliases: ['shipping', 'delivery', 'rates', 'carriers'], icon: 'truck', route: '/shipping-delivery', audience: 'seller' },
      { label: 'Shipping methods', description: 'Fulfillment and shipping method settings', aliases: ['fulfillment', 'methods'], icon: 'send', route: '/shipping', audience: 'seller' },
    ],
  },
  {
    title: 'Taxes',
    items: [
      { label: 'Taxes and duties', description: 'Tax rules and collection', aliases: ['tax', 'duties', 'vat'], icon: 'percent', route: '/taxes-duties', audience: 'seller' },
    ],
  },
  {
    title: 'Team/staff',
    items: [
      { label: 'Team and permissions', description: 'Invite collaborators and manage roles', aliases: ['team', 'collaborators', 'staff'], icon: 'users', route: '/team', audience: 'seller' },
      { label: 'Users', description: 'People with access to your store', aliases: ['users', 'staff'], icon: 'user', route: '/users', audience: 'seller' },
      { label: 'Roles', description: 'Define what each teammate can do', aliases: ['roles', 'permissions'], icon: 'shield', route: '/roles', audience: 'seller' },
    ],
  },
  {
    title: 'Plan/subscription',
    items: [
      { label: 'Subscription', description: 'Manage your Brandthread seller plan', aliases: ['plan', 'billing', 'membership'], icon: 'star', route: '/subscription', audience: 'seller' },
      { label: 'Compare plans', description: 'See all available Brandthread plans', aliases: ['plans', 'upgrade', 'compare'], icon: 'trending-up', route: '/plans', audience: 'seller' },
    ],
  },
  {
    title: 'Integrations',
    items: [
      { label: 'Integrations', description: 'Connect Shopify, email marketing, and other tools', aliases: ['shopify', 'import', 'connect', 'apps'], icon: 'link', route: '/integrations', audience: 'seller' },
      { label: 'Email marketing', description: 'Klaviyo and other marketing connections', aliases: ['klaviyo', 'email', 'marketing'], icon: 'mail', route: '/integrations/klaviyo', audience: 'seller' },
    ],
  },
  {
    title: 'Notifications',
    items: [
      { label: 'Notifications', description: 'Choose push and email alerts for orders and store activity', aliases: ['alerts', 'push', 'email', 'orders'], icon: 'bell', route: '/notifications-settings', audience: 'seller' },
    ],
  },
  {
    title: 'Privacy & safety',
    items: [
      { label: 'Customer privacy', description: 'How customer data is collected and used', aliases: ['gdpr', 'ccpa', 'customer data'], icon: 'lock', route: '/customer-privacy', audience: 'seller' },
      { label: 'Blocked accounts', description: 'See and unblock people you have blocked', aliases: ['block', 'unblock', 'blocked'], icon: 'slash', route: '/buyer-blocked', audience: 'shared' },
      { label: 'Muted words', description: 'Hide comments and posts that contain words you choose', aliases: ['mute words', 'filter', 'hide words', 'keywords'], icon: 'shield', route: '/muted-words', audience: 'shared' },
      { label: 'Review reports', description: 'Moderate reported content and filter holds', aliases: ['moderation', 'reports', 'admin', 'queue'], icon: 'flag', route: '/admin-reports', audience: 'seller', requiresModerator: true },
    ],
  },
  {
    title: 'Appearance',
    items: [
      { label: 'App theme', description: 'Choose your Brandthread color finish', aliases: ['theme', 'color', 'dark mode', 'appearance'], icon: 'droplet', route: '/app-theme', audience: 'shared' },
      { label: 'App icon', description: 'Choose the icon used on your device', aliases: ['home screen icon'], icon: 'smartphone', route: '/app-icon', audience: 'shared' },
      { label: 'App Lock', description: 'Require Face ID, Touch ID, or fingerprint to open Brandthread', aliases: ['face id', 'fingerprint', 'touch id', 'biometric', 'passcode', 'lock'], icon: 'unlock', route: '/biometric-unlock', audience: 'shared' },
      { label: 'Language', description: 'Choose your preferred app language', aliases: ['language', 'locale'], icon: 'globe', route: '/languages', audience: 'shared' },
    ],
  },
  {
    title: 'Help & support',
    items: [
      { label: 'Help and support', description: 'Find guides, FAQs, and contact support', aliases: ['help', 'support', 'faq'], icon: 'help-circle', route: '/help', audience: 'shared' },
      { label: 'Download my data', description: 'Export your products, orders, and customers', aliases: ['export', 'data', 'download'], icon: 'download', route: '/seller-data-export', audience: 'seller' },
      { label: 'Invite friends', description: 'Share your referral code and see rewards', aliases: ['invite', 'referral'], icon: 'gift', route: '/buyer-invite', audience: 'seller' },
    ],
  },
  {
    title: 'Legal',
    items: [
      { label: 'Community Guidelines', description: 'What is and isn’t allowed on Brandthread', aliases: ['rules', 'guidelines', 'community', 'policy'], icon: 'book-open', route: '/community-guidelines', audience: 'shared' },
      { label: 'Terms of Service', description: 'The agreement for buying and selling on Brandthread', aliases: ['terms', 'tos', 'legal', 'agreement', 'eula'], icon: 'file-text', route: '/terms', audience: 'shared' },
      { label: 'Privacy Policy', description: 'How we collect, use, and protect your data', aliases: ['privacy', 'data', 'legal', 'gdpr', 'ccpa'], icon: 'file-text', route: '/privacy', audience: 'shared' },
    ],
  },
  {
    title: 'Switch mode',
    items: [
      { label: 'Switch to buyer', description: 'Browse and shop as a buyer with this account', aliases: ['switch', 'buyer mode', 'account type'], icon: 'refresh-cw', route: '/account-type-settings', audience: 'seller' },
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
