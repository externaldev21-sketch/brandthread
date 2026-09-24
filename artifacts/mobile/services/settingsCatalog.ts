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
}

export interface SettingsCatalogGroup {
  title: string;
  items: SettingsCatalogItem[];
}

/**
 * One searchable catalog for both account types. Descriptions and aliases are
 * intentionally part of the data so search can find a destination by the
 * words a person uses, not only by its navigation label.
 */
export const SETTINGS_CATALOG: SettingsCatalogGroup[] = [
  {
    title: 'Profile and account',
    items: [
      { label: 'Edit buyer profile', description: 'Update your name, photo, bio, and public profile', aliases: ['profile', 'personal details', 'buyer profile'], icon: 'user', route: '/(buyer)/edit-profile', audience: 'buyer' },
      { label: 'Edit seller profile', description: 'Update your brand name, photo, bio, and public profile', aliases: ['profile', 'brand details', 'seller profile'], icon: 'user', route: '/edit-profile', audience: 'seller' },
      { label: 'Store details', description: 'Manage your brand setup and general preferences', aliases: ['general', 'brand setup', 'business details'], icon: 'briefcase', route: '/general-settings', audience: 'seller' },
      { label: 'Account type', description: 'Switch between buyer and seller account experiences', aliases: ['role', 'buyer seller', 'account role'], icon: 'layers', route: '/account-type-settings', audience: 'shared' },
      { label: 'Login methods', description: 'Password, connected accounts, and two-factor authentication', aliases: ['security', 'password', '2fa', 'two factor'], icon: 'key', route: '/login-methods', audience: 'shared' },
      { label: 'Login activity', description: 'Review devices signed into your account', aliases: ['sessions', 'devices', 'signed in'], icon: 'monitor', route: '/login-activity', audience: 'shared' },
    ],
  },
  {
    title: 'Buyer settings',
    items: [
      { label: 'Shopping preferences', description: 'Sizes, fit, favorite categories, and recommendations', aliases: ['shopping', 'sizes', 'fit', 'recommendations'], icon: 'shopping-bag', route: '/shopping-preferences', audience: 'buyer' },
      { label: 'Orders and returns', description: 'View purchases, returns, and order support', aliases: ['orders', 'purchases', 'refunds'], icon: 'package', route: '/(buyer)/orders', audience: 'buyer' },
      { label: 'Shipping addresses', description: 'Manage saved addresses for faster checkout', aliases: ['address', 'delivery', 'shipping'], icon: 'map-pin', route: '/buyer-addresses', audience: 'buyer' },
      { label: 'Payment methods', description: 'Manage payment methods saved with your account', aliases: ['cards', 'billing', 'checkout payment'], icon: 'credit-card', route: '/buyer-payment-methods', audience: 'buyer' },
      { label: 'Buyer privacy and activity', description: 'Control account privacy and who can see your content', aliases: ['privacy', 'activity', 'blocked', 'content'], icon: 'lock', route: '/buyer-privacy-settings', audience: 'buyer' },
      { label: 'Following brands', description: 'See the brands and creators you follow', aliases: ['following', 'brands'], icon: 'users', route: '/(buyer)/following', audience: 'buyer' },
    ],
  },
  {
    title: 'Seller settings',
    items: [
      { label: 'Store settings', description: 'Manage storefront presentation, checkout, and store policies', aliases: ['store', 'storefront', 'shop', 'website'], icon: 'home', route: '/store-settings', audience: 'seller' },
      { label: 'Account reach', description: 'Choose a global account or limit it to the United States', aliases: ['global', 'united states', 'country', 'region', 'market'], icon: 'globe', action: 'account-scope', audience: 'seller' },
      { label: 'Brand Assets', description: 'Manage your logos, colors, fonts, and saved brand assets', aliases: ['brand kit', 'logos', 'fonts', 'colors'], icon: 'layers', route: '/design-brand-assets', audience: 'seller', requiresGrowth: true },
      { label: 'Vacation mode', description: 'Pause your store and tell buyers when you will return', aliases: ['away', 'pause store', 'holiday'], icon: 'sun', route: '/vacation-mode', audience: 'seller' },
      { label: 'Payouts', description: 'Manage your bank account and payout history', aliases: ['money', 'bank', 'withdrawals'], icon: 'dollar-sign', route: '/payouts', audience: 'seller' },
      { label: 'Subscription', description: 'Manage your Brandthread seller plan', aliases: ['plan', 'billing', 'membership'], icon: 'star', route: '/subscription', audience: 'seller' },
      { label: 'Notifications', description: 'Choose push and email alerts for orders and store activity', aliases: ['alerts', 'push', 'email', 'orders'], icon: 'bell', route: '/notifications-settings', audience: 'seller' },
      { label: 'Team and permissions', description: 'Invite collaborators and manage roles', aliases: ['team', 'users', 'roles', 'permissions'], icon: 'users', route: '/team', audience: 'seller' },
      { label: 'Shipping and delivery', description: 'Configure rates, zones, and carriers', aliases: ['shipping', 'delivery', 'rates', 'carriers'], icon: 'truck', route: '/shipping-delivery', audience: 'seller' },
    ],
  },
  {
    title: 'Safety and privacy',
    items: [
      { label: 'Blocked accounts', description: 'See and unblock people you have blocked', aliases: ['block', 'unblock', 'blocked', 'muted accounts', 'mute'], icon: 'slash', route: '/buyer-blocked', audience: 'shared' },
      { label: 'Muted words', description: 'Hide comments and posts that contain words you choose', aliases: ['mute words', 'filter', 'hide words', 'keywords'], icon: 'volume-x', route: '/muted-words', audience: 'shared' },
      { label: 'Review reports', description: 'Moderate reported content and filter holds', aliases: ['moderation', 'reports', 'admin', 'queue'], icon: 'flag', route: '/admin-reports', audience: 'shared', requiresModerator: true },
    ],
  },
  {
    title: 'App and notifications',
    items: [
      { label: 'App theme', description: 'Choose your Brandthread color finish', aliases: ['theme', 'color', 'appearance', 'dark mode'], icon: 'droplet', route: '/app-theme', audience: 'shared' },
      { label: 'Notifications', description: 'Manage push and email notification preferences', aliases: ['alerts', 'push', 'email'], icon: 'bell', route: '/notifications-settings', audience: 'shared' },
      { label: 'App Lock', description: 'Require Face ID, Touch ID or fingerprint to open Brandthread', aliases: ['face id', 'fingerprint', 'touch id', 'biometric', 'passcode', 'lock'], icon: 'lock', route: '/biometric-unlock', audience: 'shared' },
      { label: 'App icon', description: 'Choose the icon used on your device', aliases: ['home screen icon'], icon: 'smartphone', route: '/app-icon', audience: 'shared' },
    ],
  },
  {
    title: 'Help and data',
    items: [
      { label: 'Help and support', description: 'Find guides, FAQs, and contact support', aliases: ['help', 'support', 'faq'], icon: 'help-circle', route: '/help', audience: 'shared' },
      { label: 'Download my data', description: 'Export your profile, orders, and messages', aliases: ['export', 'data', 'privacy'], icon: 'download', route: '/buyer-download-data', audience: 'shared' },
      { label: 'Community Guidelines', description: 'What is and isn’t allowed on Brandthread', aliases: ['rules', 'guidelines', 'community', 'policy'], icon: 'book-open', route: '/community-guidelines', audience: 'shared' },
      { label: 'Terms of Service', description: 'The agreement for buying and selling on Brandthread', aliases: ['terms', 'tos', 'legal', 'agreement', 'eula'], icon: 'file-text', route: '/terms', audience: 'shared' },
      { label: 'Privacy Policy', description: 'How we collect, use and protect your data', aliases: ['privacy', 'data', 'legal', 'gdpr', 'ccpa'], icon: 'lock', route: '/privacy', audience: 'shared' },
      { label: 'Delete account', description: 'Permanently erase your account and private data', aliases: ['remove account', 'close account'], icon: 'trash-2', action: 'delete-account', destructive: true, audience: 'shared' },
      { label: 'Sign out', description: 'Sign out of this Brandthread account', aliases: ['log out', 'logout'], icon: 'log-out', action: 'sign-out', destructive: true, audience: 'shared' },
    ],
  },
];