// ─── Brandthread AI Store Builder — Type System ─────────────────────────────

export type StorePublishStatus =
  | 'not_started'
  | 'draft'
  | 'ready'
  | 'published'
  | 'password_protected'
  | 'maintenance'
  | 'unpublished';

export type StoreSectionType =
  | 'hero_image'
  | 'hero_video'
  | 'hero_slideshow'
  | 'featured_collection'
  | 'product_grid'
  | 'featured_product'
  | 'image_with_text'
  | 'video_with_text'
  | 'brand_story'
  | 'lookbook'
  | 'customer_reviews'
  | 'seller_posts'
  | 'drop_countdown'
  | 'announcement'
  | 'newsletter'
  | 'faq'
  | 'social_feed'
  | 'logo_list'
  | 'before_after'
  | 'text_banner'
  | 'spacer'
  | 'custom_block';

export type CountdownStyle = 'minimal' | 'bold' | 'flip' | 'digital';
export type TextAlignment = 'left' | 'center' | 'right';
export type ButtonStyle = 'filled' | 'outline' | 'ghost' | 'underline';
export type ImageFit = 'cover' | 'contain' | 'fill';
export type PaginationType = 'paginated' | 'infinite';
export type GridColumns = 1 | 2 | 3 | 4;
export type LocationType = 'warehouse' | 'home' | 'manufacturer' | 'third_party' | 'retail' | 'popup' | 'returns' | 'other';

export interface StoreSectionSettings {
  heading?: string;
  description?: string;
  imageUri?: string;
  videoUri?: string;
  posterUri?: string;
  buttonLabel?: string;
  buttonDestination?: string;
  textAlignment?: TextAlignment;
  contentPosition?: 'left' | 'right' | 'center' | 'top' | 'bottom';
  backgroundColor?: string;
  textColor?: string;
  spacing?: 'compact' | 'normal' | 'spacious';
  fullWidth?: boolean;
  sectionHeight?: 'auto' | 'short' | 'medium' | 'tall' | 'full';
  overlayStrength?: number; // 0–100
  mobileLayout?: 'stack' | 'side_by_side' | 'hidden';
  visible?: boolean;
  scheduleStart?: string;
  scheduleEnd?: string;
  // slideshow
  slides?: Array<{ imageUri?: string; videoUri?: string; heading?: string; description?: string; buttonLabel?: string; buttonDestination?: string }>;
  slideDuration?: number;
  transition?: 'fade' | 'slide' | 'zoom';
  // countdown
  dropDate?: string;
  dropEndDate?: string;
  countdownStyle?: CountdownStyle;
  productId?: string;
  collectionId?: string;
  expiredMessage?: string;
  // video
  muted?: boolean;
  autoplay?: boolean;
  loop?: boolean;
  // grid / collection
  columns?: GridColumns;
  productIds?: string[];
  collectionRef?: 'featured' | 'best_sellers' | 'new_arrivals' | 'pre_orders' | string;
  quickAdd?: boolean;
  // story
  storyText?: string;
  // faq
  faqs?: Array<{ q: string; a: string }>;
  // reviews
  reviews?: Array<{ author: string; text: string; rating: number; date: string }>;
  // announcement
  link?: string;
  dismissible?: boolean;
  sticky?: boolean;
  // seller posts
  postCount?: number;
  postLayout?: 'grid' | 'list' | 'carousel';
}

export interface StoreSection {
  id: string;
  type: StoreSectionType;
  label: string;
  enabled: boolean;
  order: number;
  settings: StoreSectionSettings;
  createdAt: string;
  updatedAt: string;
}

export interface StoreColorPalette {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
  buttonText: string;
}

export type TypographyStyle = 'modern' | 'luxury' | 'minimal' | 'bold' | 'editorial' | 'technical' | 'classic' | 'experimental';
export type FontWeight = '300' | '400' | '500' | '600' | '700' | '800' | '900';
export type TextCase = 'none' | 'uppercase' | 'lowercase' | 'capitalize';

export interface StoreTypography {
  style: TypographyStyle;
  headingFont: string;
  bodyFont: string;
  buttonFont: string;
  fontWeight: FontWeight;
  letterSpacing: number;
  textCase: TextCase;
}

export interface StoreBranding {
  logoUri?: string;
  faviconUri?: string;
  colors: StoreColorPalette;
  typography: StoreTypography;
  buttonStyle: ButtonStyle;
  cornerRadius: 'sharp' | 'subtle' | 'rounded' | 'pill';
  iconStyle: 'outline' | 'filled' | 'duotone';
  animationLevel: 'none' | 'subtle' | 'standard' | 'expressive';
}

export type BrandStyle =
  | 'luxury' | 'streetwear' | 'minimal' | 'vintage' | 'y2k'
  | 'techwear' | 'outdoor' | 'sportswear' | 'high_fashion'
  | 'basics' | 'contemporary' | 'custom';

export type BrandMood =
  | 'premium' | 'clean' | 'bold' | 'futuristic' | 'cozy'
  | 'dark' | 'colorful' | 'editorial' | 'exclusive'
  | 'playful' | 'raw' | 'artistic';

export type HomepagePriority =
  | 'hero_video' | 'hero_slideshow' | 'hero_image'
  | 'featured_collection' | 'product_grid' | 'brand_story'
  | 'new_collection' | 'drop_countdown' | 'best_sellers' | 'lookbook';

export type TargetCustomer =
  | 'men' | 'women' | 'unisex' | 'kids'
  | 'luxury_shoppers' | 'streetwear_buyers' | 'athletes'
  | 'creatives' | 'fashion_enthusiasts' | 'everyday_basics' | 'custom';

export type StoreFeature =
  | 'product_reviews' | 'size_guide' | 'wishlist' | 'drop_countdown'
  | 'email_signup' | 'sms_signup' | 'social_feed' | 'seller_posts'
  | 'product_recommendations' | 'recently_viewed' | 'quick_add'
  | 'sticky_add_to_cart' | 'pre_order_display' | 'low_stock_notice'
  | 'announcement_bar' | 'faq' | 'contact_form';

export type StoreContent =
  | 'logo' | 'product_photos' | 'product_videos' | 'campaign_images'
  | 'brand_story' | 'customer_reviews' | 'social_posts' | 'lookbook' | 'none';

export interface StoreGenerationAnswers {
  primaryStyle: BrandStyle | null;
  secondaryStyles: BrandStyle[];
  moods: BrandMood[];
  colors: StoreColorPalette;
  typography: TypographyStyle;
  homepagePriority: HomepagePriority | null;
  additionalSections: HomepagePriority[];
  brandStory: string;
  targetCustomers: TargetCustomer[];
  ageRange: { min: number; max: number } | null;
  audienceDescription: string;
  existingContent: StoreContent[];
  features: StoreFeature[];
  logoUri?: string;
  moodBoardUris: string[];
}

export interface StoreGenerationResult {
  sections: StoreSection[];
  branding: StoreBranding;
  suggestedThemeId: string;
  generatedAt: string;
  fromAnswers: StoreGenerationAnswers;
  /** AI-generated store name — applied to settings.storeName locally and the DB title column */
  storeTitle?: string;
  /** AI-generated subtitle persisted to the DB subtitle column */
  storeSubtitle?: string;
  /** AI-generated description persisted to the DB description column */
  storeDescription?: string;
  /** SEO metadata extracted from the AI response */
  storeSeo?: { homepageTitle?: string; homepageDescription?: string; keywords?: string[] };
  /** DB-only branding fields (tagline, mission, targetAudience) not in the local StoreBranding struct */
  apiBranding?: { tagline?: string; mission?: string; targetAudience?: string };
}

export type MenuItemTarget = 'product' | 'collection' | 'page' | 'seller_profile' | 'external' | 'none';

export interface StoreMenuItem {
  id: string;
  label: string;
  target: MenuItemTarget;
  targetId?: string;
  url?: string;
  visible: boolean;
  order: number;
  children: StoreMenuItem[];
}

export type MenuType = 'main' | 'mobile' | 'footer';

export interface StoreMenu {
  id: string;
  type: MenuType;
  name: string;
  items: StoreMenuItem[];
  updatedAt: string;
}

export type PageType =
  | 'about' | 'contact' | 'faq' | 'size_guide'
  | 'shipping_policy' | 'return_policy' | 'privacy_policy'
  | 'terms' | 'custom';

export type PageStatus = 'draft' | 'published' | 'scheduled' | 'hidden';

export interface StorePage {
  id: string;
  type: PageType;
  title: string;
  slug: string;
  content: string;
  seoTitle?: string;
  seoDescription?: string;
  status: PageStatus;
  scheduledAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type PolicyType = 'shipping' | 'return' | 'refund' | 'privacy' | 'terms' | 'pre_order';

export interface StorePolicy {
  id: string;
  type: PolicyType;
  title: string;
  content: string;
  aiGenerated: boolean;
  reviewedBySeller: boolean;
  updatedAt: string;
}

export type CollectionType = 'manual' | 'automated';
export type CollectionStatus = 'active' | 'draft' | 'scheduled' | 'hidden';
export type CollectionConditionField = 'tag' | 'category' | 'price' | 'inventory' | 'product_type' | 'pre_order' | 'vendor' | 'new_products';
export type CollectionConditionOperator = 'equals' | 'contains' | 'greater_than' | 'less_than' | 'is_set';

export interface CollectionCondition {
  field: CollectionConditionField;
  operator: CollectionConditionOperator;
  value: string;
}

export interface StoreCollection {
  id: string;
  type: CollectionType;
  name: string;
  description: string;
  coverImageUri?: string;
  productIds: string[];
  productOrder: 'manual' | 'title_asc' | 'title_desc' | 'price_asc' | 'price_desc' | 'newest' | 'best_selling';
  conditions: CollectionCondition[];
  conditionMatch: 'all' | 'any';
  seoTitle?: string;
  seoDescription?: string;
  handle: string;
  status: CollectionStatus;
  scheduledAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoreDomain {
  id: string;
  type: 'brandthread' | 'custom';
  subdomain?: string;
  customDomain?: string;
  verificationStatus: 'pending' | 'verified' | 'failed' | 'not_started';
  sslStatus: 'active' | 'pending' | 'error' | 'not_issued';
  isPrimary: boolean;
  redirectsTo?: string;
  connectedAt?: string;
}

export interface StoreSEO {
  homepageTitle: string;
  homepageDescription: string;
  socialImageUri?: string;
  sitemapEnabled: boolean;
  searchVisible: boolean;
  productSeoDefaults: { titleTemplate: string; descriptionTemplate: string };
  collectionSeoDefaults: { titleTemplate: string; descriptionTemplate: string };
}

export type ThemeCategory = 'streetwear' | 'luxury' | 'minimal' | 'editorial' | 'modern' | 'experimental';
export type ThemeMode = 'light' | 'dark' | 'auto';

export interface StoreThemePreset {
  paletteId: string;
  label: string;
  colors: StoreColorPalette;
}

export interface StoreTheme {
  id: string;
  name: string;
  category: ThemeCategory;
  description: string;
  bestFor: string;
  supportedModes: ThemeMode[];
  previewColor: string;
  accentColor: string;
  defaultTypography: TypographyStyle;
  supportedSections: StoreSectionType[];
  presets: StoreThemePreset[];
  tags: string[];
}

export interface StoreThemeSettings {
  themeId: string;
  activePresetId: string;
  overrides: Partial<StoreBranding>;
  headerLogoPosition: 'left' | 'center' | 'right';
  headerMenuStyle: 'inline' | 'hamburger' | 'mega';
  headerSearch: boolean;
  headerCart: boolean;
  headerAccount: boolean;
  stickyHeader: boolean;
  transparentHeader: boolean;
  announcementBar: {
    enabled: boolean;
    text: string;
    link?: string;
    backgroundColor: string;
    textColor: string;
    dismissible: boolean;
    sticky: boolean;
    startDate?: string;
    endDate?: string;
    hasCountdown: boolean;
    countdownDate?: string;
  };
  footerNewsletter: boolean;
  footerSocialLinks: Record<string, string>;
  footerPolicies: boolean;
  footerContactInfo: string;
  footerCopyright: string;
  footerPaymentIcons: boolean;
  productPage: {
    mediaLayout: 'stacked' | 'side_by_side' | 'full_width';
    imageSize: 'small' | 'medium' | 'large';
    infoPosition: 'right' | 'below';
    variantStyle: 'buttons' | 'dropdown' | 'swatches';
    sizeGuide: boolean;
    reviews: boolean;
    stickyCart: boolean;
    relatedProducts: boolean;
    sellerLink: boolean;
    sellerContent: boolean;
  };
  collectionPage: {
    columns: GridColumns;
    cardStyle: 'standard' | 'minimal' | 'overlay';
    filters: boolean;
    sorting: boolean;
    quickAdd: boolean;
    pagination: PaginationType;
  };
}

export interface StoreAISuggestion {
  id: string;
  category: 'layout' | 'branding' | 'conversion' | 'mobile' | 'product' | 'copy' | 'navigation' | 'accessibility' | 'performance';
  title: string;
  problem: string;
  recommendation: string;
  previewChange?: string;
  dismissed: boolean;
  applied: boolean;
  createdAt: string;
}

export interface StoreVersion {
  id: string;
  label: string;
  trigger: 'theme_change' | 'section_change' | 'publish' | 'ai_change' | 'manual';
  snapshot: Partial<Storefront>;
  createdAt: string;
}

export interface StoreUndoEntry {
  action: string;
  before: unknown;
  after: unknown;
  timestamp: string;
}

export interface StoreSettings {
  storeName: string;
  storeUrl: string;
  contactEmail: string;
  supportEmail: string;
  currency: string;
  language: string;
  timezone: string;
  measurementUnit: 'imperial' | 'metric';
  storeStatus: StorePublishStatus;
  passwordProtected: boolean;
  storePassword?: string;
  checkoutRequireAccount: boolean;
  checkoutGuestAllowed: boolean;
  orderNotifications: boolean;
  analyticsEnabled: boolean;
}

export interface Storefront {
  id: string;
  sellerId: string;
  settings: StoreSettings;
  branding: StoreBranding;
  themeSettings: StoreThemeSettings;
  sections: StoreSection[];
  collections: StoreCollection[];
  pages: StorePage[];
  policies: StorePolicy[];
  menus: StoreMenu[];
  seo: StoreSEO;
  domains: StoreDomain[];
  publishStatus: StorePublishStatus;
  publishedAt?: string;
  sharePreviewRevokedAt?: string | null;
  generatedFrom?: StoreGenerationAnswers;
  aiSuggestions: StoreAISuggestion[];
  versions: StoreVersion[];
  undoStack: StoreUndoEntry[];
  redoStack: StoreUndoEntry[];
  autosaveAt?: string;
  lastEditedAt: string;
  createdAt: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const BRAND_STYLES: { value: BrandStyle; label: string }[] = [
  { value: 'luxury', label: 'Luxury' },
  { value: 'streetwear', label: 'Streetwear' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'vintage', label: 'Vintage' },
  { value: 'y2k', label: 'Y2K' },
  { value: 'techwear', label: 'Techwear' },
  { value: 'outdoor', label: 'Outdoor' },
  { value: 'sportswear', label: 'Sportswear' },
  { value: 'high_fashion', label: 'High Fashion' },
  { value: 'basics', label: 'Basics' },
  { value: 'contemporary', label: 'Contemporary' },
  { value: 'custom', label: 'Custom' },
];

export const BRAND_MOODS: { value: BrandMood; label: string }[] = [
  { value: 'premium', label: 'Premium' },
  { value: 'clean', label: 'Clean' },
  { value: 'bold', label: 'Bold' },
  { value: 'futuristic', label: 'Futuristic' },
  { value: 'cozy', label: 'Cozy' },
  { value: 'dark', label: 'Dark' },
  { value: 'colorful', label: 'Colorful' },
  { value: 'editorial', label: 'Editorial' },
  { value: 'exclusive', label: 'Exclusive' },
  { value: 'playful', label: 'Playful' },
  { value: 'raw', label: 'Raw' },
  { value: 'artistic', label: 'Artistic' },
];

export const HOMEPAGE_PRIORITIES: { value: HomepagePriority; label: string; icon: string }[] = [
  { value: 'hero_video', label: 'Hero Video', icon: 'play-circle' },
  { value: 'hero_slideshow', label: 'Hero Slideshow', icon: 'image' },
  { value: 'hero_image', label: 'Single Hero Image', icon: 'maximize' },
  { value: 'featured_collection', label: 'Featured Collection', icon: 'grid' },
  { value: 'product_grid', label: 'Product Grid', icon: 'layout' },
  { value: 'brand_story', label: 'Brand Story', icon: 'book-open' },
  { value: 'new_collection', label: 'New Collection', icon: 'star' },
  { value: 'drop_countdown', label: 'Drop Countdown', icon: 'clock' },
  { value: 'best_sellers', label: 'Best Sellers', icon: 'trending-up' },
  { value: 'lookbook', label: 'Lookbook', icon: 'camera' },
];

export const TARGET_CUSTOMERS: { value: TargetCustomer; label: string }[] = [
  { value: 'men', label: 'Men' },
  { value: 'women', label: 'Women' },
  { value: 'unisex', label: 'Unisex' },
  { value: 'kids', label: 'Kids' },
  { value: 'luxury_shoppers', label: 'Luxury Shoppers' },
  { value: 'streetwear_buyers', label: 'Streetwear Buyers' },
  { value: 'athletes', label: 'Athletes' },
  { value: 'creatives', label: 'Creatives' },
  { value: 'fashion_enthusiasts', label: 'Fashion Enthusiasts' },
  { value: 'everyday_basics', label: 'Everyday Basics Customers' },
  { value: 'custom', label: 'Custom Audience' },
];

export const STORE_FEATURES: { value: StoreFeature; label: string; icon: string }[] = [
  { value: 'product_reviews', label: 'Product Reviews', icon: 'star' },
  { value: 'size_guide', label: 'Size Guide', icon: 'ruler' },
  { value: 'wishlist', label: 'Wishlist', icon: 'heart' },
  { value: 'drop_countdown', label: 'Drop Countdown', icon: 'clock' },
  { value: 'email_signup', label: 'Email Signup', icon: 'mail' },
  { value: 'sms_signup', label: 'SMS Signup', icon: 'message-circle' },
  { value: 'social_feed', label: 'Social Feed', icon: 'rss' },
  { value: 'seller_posts', label: 'Seller Posts', icon: 'video' },
  { value: 'product_recommendations', label: 'Product Recommendations', icon: 'shuffle' },
  { value: 'recently_viewed', label: 'Recently Viewed', icon: 'eye' },
  { value: 'quick_add', label: 'Quick Add', icon: 'plus-circle' },
  { value: 'sticky_add_to_cart', label: 'Sticky Add to Cart', icon: 'shopping-bag' },
  { value: 'pre_order_display', label: 'Pre-order Display', icon: 'calendar' },
  { value: 'low_stock_notice', label: 'Low-stock Notice', icon: 'alert-triangle' },
  { value: 'announcement_bar', label: 'Announcement Bar', icon: 'bell' },
  { value: 'faq', label: 'FAQ', icon: 'help-circle' },
  { value: 'contact_form', label: 'Contact Form', icon: 'send' },
];

export const STORE_CONTENT_OPTIONS: { value: StoreContent; label: string; icon: string }[] = [
  { value: 'logo', label: 'Logo', icon: 'image' },
  { value: 'product_photos', label: 'Product Photos', icon: 'camera' },
  { value: 'product_videos', label: 'Product Videos', icon: 'video' },
  { value: 'campaign_images', label: 'Campaign Images', icon: 'aperture' },
  { value: 'brand_story', label: 'Brand Story', icon: 'book-open' },
  { value: 'customer_reviews', label: 'Customer Reviews', icon: 'star' },
  { value: 'social_posts', label: 'Social Posts', icon: 'share-2' },
  { value: 'lookbook', label: 'Lookbook', icon: 'grid' },
  { value: 'none', label: 'None yet', icon: 'plus' },
];

export const TYPOGRAPHY_STYLES: { value: TypographyStyle; label: string; heading: string; body: string; sample: string }[] = [
  { value: 'modern', label: 'Modern', heading: 'Inter', body: 'Inter', sample: 'Clean lines, contemporary feel.' },
  { value: 'luxury', label: 'Luxury', heading: 'Playfair Display', body: 'Lato', sample: 'Refined elegance, timeless presence.' },
  { value: 'minimal', label: 'Minimal', heading: 'Helvetica Neue', body: 'Helvetica Neue', sample: 'Nothing extra. Only what matters.' },
  { value: 'bold', label: 'Bold', heading: 'Oswald', body: 'Source Sans Pro', sample: 'MAKE YOUR STATEMENT.' },
  { value: 'editorial', label: 'Editorial', heading: 'Cormorant Garamond', body: 'Raleway', sample: 'Curated. Considered. Compelling.' },
  { value: 'technical', label: 'Technical', heading: 'Space Grotesk', body: 'Space Mono', sample: 'Precision built into every detail.' },
  { value: 'classic', label: 'Classic', heading: 'Georgia', body: 'Garamond', sample: 'Built to endure every season.' },
  { value: 'experimental', label: 'Experimental', heading: 'Syne', body: 'DM Sans', sample: 'Break the expected. Define your own.' },
];

export const COLOR_PRESETS: { label: string; colors: StoreColorPalette }[] = [
  { label: 'Midnight', colors: { primary: '#1a1a2e', secondary: '#16213e', accent: '#e94560', background: '#0f0f0f', text: '#f4f4f4', buttonText: '#ffffff' } },
  { label: 'Alabaster', colors: { primary: '#f0ede6', secondary: '#d9d3c6', accent: '#2d2d2d', background: '#faf8f4', text: '#1a1a1a', buttonText: '#f0ede6' } },
  { label: 'Chrome', colors: { primary: '#c0c0c0', secondary: '#808080', accent: '#7c3aed', background: '#121212', text: '#f4f4f4', buttonText: '#121212' } },
  { label: 'Tokyo', colors: { primary: '#ff0054', secondary: '#ff5400', accent: '#ffbd00', background: '#0d0d0d', text: '#ffffff', buttonText: '#0d0d0d' } },
  { label: 'Linen', colors: { primary: '#e8dcc8', secondary: '#c4a882', accent: '#2c1810', background: '#f9f4ec', text: '#2c1810', buttonText: '#f9f4ec' } },
  { label: 'Cobalt', colors: { primary: '#003f8a', secondary: '#0066cc', accent: '#ffd700', background: '#001a3a', text: '#f0f4ff', buttonText: '#001a3a' } },
  { label: 'Sage', colors: { primary: '#7c9070', secondary: '#a8b89e', accent: '#3d2b1f', background: '#f4f0e8', text: '#2d2d2d', buttonText: '#f4f0e8' } },
  { label: 'Obsidian', colors: { primary: '#2d2d2d', secondary: '#1a1a1a', accent: '#c9a96e', background: '#080808', text: '#f4f4f4', buttonText: '#080808' } },
];

export const BUILTIN_THEMES: StoreTheme[] = [
  {
    id: 'street', name: 'Street', category: 'streetwear',
    description: 'Raw energy meets polished execution. Built for brands that live on the block.',
    bestFor: 'Streetwear, urban, hype', supportedModes: ['dark', 'light'],
    previewColor: '#1a1a1a', accentColor: '#ff0054', defaultTypography: 'bold',
    supportedSections: ['hero_video', 'hero_image', 'product_grid', 'drop_countdown', 'seller_posts', 'featured_collection', 'customer_reviews', 'announcement', 'newsletter'],
    tags: ['streetwear', 'urban', 'hype', 'bold'],
    presets: [
      { paletteId: 'dark', label: 'Dark', colors: { primary: '#1a1a1a', secondary: '#2d2d2d', accent: '#ff0054', background: '#080808', text: '#f4f4f4', buttonText: '#ffffff' } },
      { paletteId: 'light', label: 'Light', colors: { primary: '#f4f4f4', secondary: '#e0e0e0', accent: '#ff0054', background: '#ffffff', text: '#1a1a1a', buttonText: '#ffffff' } },
    ],
  },
  {
    id: 'noir', name: 'Noir', category: 'luxury',
    description: 'Absolute darkness. Maximum drama. For brands that demand attention.',
    bestFor: 'High fashion, exclusive drops, editorial', supportedModes: ['dark'],
    previewColor: '#0a0a0a', accentColor: '#c9a96e', defaultTypography: 'luxury',
    supportedSections: ['hero_image', 'hero_video', 'featured_product', 'brand_story', 'lookbook', 'drop_countdown', 'seller_posts', 'customer_reviews'],
    tags: ['luxury', 'dark', 'editorial', 'exclusive'],
    presets: [
      { paletteId: 'noir', label: 'Noir', colors: { primary: '#c9a96e', secondary: '#8b7355', accent: '#f0e6d0', background: '#050505', text: '#f0e6d0', buttonText: '#050505' } },
    ],
  },
  {
    id: 'canvas', name: 'Canvas', category: 'minimal',
    description: 'Let your product speak. Nothing between your work and the customer.',
    bestFor: 'Minimal, basics, clean aesthetics', supportedModes: ['light', 'dark'],
    previewColor: '#f9f4ec', accentColor: '#2c1810', defaultTypography: 'minimal',
    supportedSections: ['hero_image', 'product_grid', 'featured_collection', 'image_with_text', 'brand_story', 'newsletter', 'customer_reviews'],
    tags: ['minimal', 'clean', 'basics', 'neutral'],
    presets: [
      { paletteId: 'linen', label: 'Linen', colors: { primary: '#e8dcc8', secondary: '#c4a882', accent: '#2c1810', background: '#f9f4ec', text: '#2c1810', buttonText: '#f9f4ec' } },
      { paletteId: 'white', label: 'White', colors: { primary: '#1a1a1a', secondary: '#4a4a4a', accent: '#c9a96e', background: '#ffffff', text: '#1a1a1a', buttonText: '#ffffff' } },
    ],
  },
  {
    id: 'muse', name: 'Muse', category: 'editorial',
    description: 'Fashion meets art. For brands that inspire as much as they sell.',
    bestFor: 'Editorial, artistic, lookbook-driven', supportedModes: ['light', 'dark', 'auto'],
    previewColor: '#f5f0eb', accentColor: '#8b4513', defaultTypography: 'editorial',
    supportedSections: ['hero_image', 'lookbook', 'brand_story', 'featured_product', 'image_with_text', 'seller_posts', 'customer_reviews', 'newsletter'],
    tags: ['editorial', 'artistic', 'lookbook', 'premium'],
    presets: [
      { paletteId: 'cream', label: 'Cream', colors: { primary: '#2c2c2c', secondary: '#5a4a3a', accent: '#c4956a', background: '#f5f0eb', text: '#1a1a1a', buttonText: '#f5f0eb' } },
      { paletteId: 'ink', label: 'Ink', colors: { primary: '#e8e0d0', secondary: '#a0927c', accent: '#d4a96e', background: '#0e0a06', text: '#e8e0d0', buttonText: '#0e0a06' } },
    ],
  },
  {
    id: 'tokyo', name: 'Tokyo', category: 'experimental',
    description: 'High-voltage style from the future. Neon energy, razor precision.',
    bestFor: 'Y2K, techwear, futuristic, loud', supportedModes: ['dark'],
    previewColor: '#0d0d0d', accentColor: '#ff0054', defaultTypography: 'technical',
    supportedSections: ['hero_video', 'hero_slideshow', 'drop_countdown', 'product_grid', 'featured_collection', 'seller_posts', 'announcement', 'newsletter'],
    tags: ['y2k', 'futuristic', 'neon', 'techwear'],
    presets: [
      { paletteId: 'neon', label: 'Neon', colors: { primary: '#ff0054', secondary: '#ff5400', accent: '#00f5ff', background: '#0d0d0d', text: '#ffffff', buttonText: '#0d0d0d' } },
    ],
  },
  {
    id: 'gallery', name: 'Gallery', category: 'editorial',
    description: 'White space is the design. Product photography takes center stage.',
    bestFor: 'Contemporary, high-end photography, lookbooks', supportedModes: ['light'],
    previewColor: '#ffffff', accentColor: '#1a1a1a', defaultTypography: 'minimal',
    supportedSections: ['hero_image', 'lookbook', 'product_grid', 'image_with_text', 'featured_product', 'brand_story', 'customer_reviews'],
    tags: ['gallery', 'white', 'photography', 'contemporary'],
    presets: [
      { paletteId: 'white', label: 'White', colors: { primary: '#1a1a1a', secondary: '#666666', accent: '#1a1a1a', background: '#ffffff', text: '#1a1a1a', buttonText: '#ffffff' } },
    ],
  },
  {
    id: 'motion', name: 'Motion', category: 'modern',
    description: 'Built for brands that move. Dynamic layouts that flow with the scroll.',
    bestFor: 'Sportswear, activewear, outdoor brands', supportedModes: ['dark', 'light'],
    previewColor: '#001a3a', accentColor: '#ffd700', defaultTypography: 'bold',
    supportedSections: ['hero_video', 'hero_slideshow', 'product_grid', 'featured_collection', 'drop_countdown', 'customer_reviews', 'seller_posts', 'newsletter'],
    tags: ['sportswear', 'active', 'outdoor', 'dynamic'],
    presets: [
      { paletteId: 'cobalt', label: 'Cobalt', colors: { primary: '#003f8a', secondary: '#0066cc', accent: '#ffd700', background: '#001a3a', text: '#f0f4ff', buttonText: '#001a3a' } },
      { paletteId: 'onyx', label: 'Onyx', colors: { primary: '#2d2d2d', secondary: '#4a4a4a', accent: '#00e5ff', background: '#0a0a0a', text: '#f4f4f4', buttonText: '#0a0a0a' } },
    ],
  },
  {
    id: 'archive', name: 'Archive', category: 'streetwear',
    description: 'The archive aesthetic. Reference culture lives here.',
    bestFor: 'Vintage, archive, reference-heavy streetwear', supportedModes: ['dark', 'light'],
    previewColor: '#1a1a0e', accentColor: '#c8b560', defaultTypography: 'classic',
    supportedSections: ['hero_image', 'product_grid', 'featured_collection', 'brand_story', 'lookbook', 'customer_reviews', 'newsletter'],
    tags: ['vintage', 'archive', 'classic', 'reference'],
    presets: [
      { paletteId: 'olive', label: 'Olive', colors: { primary: '#4a4a1e', secondary: '#6b6b30', accent: '#c8b560', background: '#0e0e06', text: '#f0ecd4', buttonText: '#0e0e06' } },
      { paletteId: 'natural', label: 'Natural', colors: { primary: '#3d2b1f', secondary: '#6b4c35', accent: '#c4956a', background: '#f5ece0', text: '#1a0f0a', buttonText: '#f5ece0' } },
    ],
  },
  {
    id: 'vertex', name: 'Vertex', category: 'modern',
    description: 'Sharp angles, modern grid, technical precision. The brand architect\'s choice.',
    bestFor: 'Contemporary, techwear, brand-focused', supportedModes: ['dark', 'light'],
    previewColor: '#0f0f1a', accentColor: '#7c3aed', defaultTypography: 'technical',
    supportedSections: ['hero_image', 'hero_video', 'product_grid', 'featured_collection', 'drop_countdown', 'brand_story', 'announcement', 'newsletter'],
    tags: ['technical', 'modern', 'grid', 'sharp'],
    presets: [
      { paletteId: 'violet', label: 'Violet', colors: { primary: '#7c3aed', secondary: '#5b21b6', accent: '#a78bfa', background: '#0f0f1a', text: '#f4f4ff', buttonText: '#0f0f1a' } },
      { paletteId: 'chrome', label: 'Chrome', colors: { primary: '#c0c0c0', secondary: '#808080', accent: '#ffffff', background: '#0a0a0a', text: '#f4f4f4', buttonText: '#0a0a0a' } },
    ],
  },
  {
    id: 'luxe', name: 'Luxe', category: 'luxury',
    description: 'For the rare few. Materials, tailoring, legacy — communicated before a word is read.',
    bestFor: 'Ultra-premium, luxury ready-to-wear, couture-adjacent', supportedModes: ['dark', 'light'],
    previewColor: '#0a0806', accentColor: '#c9a96e', defaultTypography: 'luxury',
    supportedSections: ['hero_image', 'featured_product', 'lookbook', 'brand_story', 'image_with_text', 'customer_reviews', 'newsletter'],
    tags: ['luxury', 'premium', 'couture', 'gold'],
    presets: [
      { paletteId: 'gold', label: 'Gold', colors: { primary: '#c9a96e', secondary: '#8b7355', accent: '#f0ddb0', background: '#050302', text: '#f0e6d0', buttonText: '#050302' } },
      { paletteId: 'ivory', label: 'Ivory', colors: { primary: '#1a1610', secondary: '#3d3326', accent: '#c9a96e', background: '#faf6ee', text: '#1a1610', buttonText: '#faf6ee' } },
    ],
  },
  {
    id: 'mono', name: 'Mono', category: 'minimal',
    description: 'Black. White. Nothing else matters.',
    bestFor: 'Minimalist, basics, monochrome brands', supportedModes: ['light', 'dark', 'auto'],
    previewColor: '#ffffff', accentColor: '#000000', defaultTypography: 'minimal',
    supportedSections: ['hero_image', 'product_grid', 'featured_collection', 'brand_story', 'image_with_text', 'newsletter'],
    tags: ['monochrome', 'minimal', 'clean', 'basics'],
    presets: [
      { paletteId: 'white', label: 'White', colors: { primary: '#000000', secondary: '#333333', accent: '#000000', background: '#ffffff', text: '#000000', buttonText: '#ffffff' } },
      { paletteId: 'black', label: 'Black', colors: { primary: '#ffffff', secondary: '#cccccc', accent: '#ffffff', background: '#000000', text: '#ffffff', buttonText: '#000000' } },
    ],
  },
  {
    id: 'district', name: 'District', category: 'streetwear',
    description: 'Community-first. The neighborhood store in your pocket.',
    bestFor: 'Local brands, community-driven, authentic streetwear', supportedModes: ['dark', 'light'],
    previewColor: '#1a1212', accentColor: '#ff3d00', defaultTypography: 'bold',
    supportedSections: ['hero_image', 'product_grid', 'seller_posts', 'drop_countdown', 'brand_story', 'customer_reviews', 'newsletter', 'announcement'],
    tags: ['community', 'local', 'authentic', 'bold'],
    presets: [
      { paletteId: 'fire', label: 'Fire', colors: { primary: '#ff3d00', secondary: '#ff6d00', accent: '#ffd600', background: '#0a0505', text: '#f5f5f5', buttonText: '#0a0505' } },
      { paletteId: 'cement', label: 'Cement', colors: { primary: '#757575', secondary: '#424242', accent: '#ff3d00', background: '#1a1a1a', text: '#f5f5f5', buttonText: '#1a1a1a' } },
    ],
  },
  {
    id: 'pulse', name: 'Pulse', category: 'modern',
    description: 'Drop culture lives here. Hype, anticipation, urgency — built in.',
    bestFor: 'Limited drops, hype brands, collectors', supportedModes: ['dark'],
    previewColor: '#050510', accentColor: '#00f5ff', defaultTypography: 'technical',
    supportedSections: ['hero_video', 'drop_countdown', 'product_grid', 'featured_product', 'announcement', 'newsletter', 'seller_posts'],
    tags: ['drops', 'hype', 'limited', 'countdown'],
    presets: [
      { paletteId: 'cyber', label: 'Cyber', colors: { primary: '#00f5ff', secondary: '#7c3aed', accent: '#ff0054', background: '#050510', text: '#f4f4ff', buttonText: '#050510' } },
    ],
  },
  {
    id: 'studio', name: 'Studio', category: 'modern',
    description: 'The working studio aesthetic. Behind-the-scenes energy, production-forward.',
    bestFor: 'Ateliers, small-batch, artisan clothing brands', supportedModes: ['light', 'dark'],
    previewColor: '#f0ece4', accentColor: '#2d4a3e', defaultTypography: 'classic',
    supportedSections: ['hero_image', 'brand_story', 'lookbook', 'product_grid', 'image_with_text', 'seller_posts', 'customer_reviews', 'newsletter'],
    tags: ['studio', 'artisan', 'handmade', 'process'],
    presets: [
      { paletteId: 'sage', label: 'Sage', colors: { primary: '#2d4a3e', secondary: '#4a7c6a', accent: '#c8a95e', background: '#f0ece4', text: '#1a2a24', buttonText: '#f0ece4' } },
    ],
  },
  {
    id: 'horizon', name: 'Horizon', category: 'modern',
    description: 'Expansive, aspirational, category-defining. Apparel for the open road.',
    bestFor: 'Outdoor, adventure, lifestyle brands', supportedModes: ['light', 'dark', 'auto'],
    previewColor: '#0a1628', accentColor: '#ff6b35', defaultTypography: 'modern',
    supportedSections: ['hero_video', 'hero_slideshow', 'product_grid', 'featured_collection', 'brand_story', 'customer_reviews', 'newsletter', 'image_with_text'],
    tags: ['outdoor', 'adventure', 'lifestyle', 'aspirational'],
    presets: [
      { paletteId: 'dusk', label: 'Dusk', colors: { primary: '#ff6b35', secondary: '#ff9a5c', accent: '#ffd166', background: '#0a1628', text: '#f0f4ff', buttonText: '#0a1628' } },
      { paletteId: 'earth', label: 'Earth', colors: { primary: '#8b5e3c', secondary: '#c4956a', accent: '#2d4a1e', background: '#f5ece0', text: '#1a0f0a', buttonText: '#f5ece0' } },
    ],
  },
  {
    id: 'atelier', name: 'Atelier', category: 'luxury',
    description: 'The house of craft. Every detail deliberate. Every stitch considered.',
    bestFor: 'Luxury, made-to-order, bespoke, couture', supportedModes: ['light', 'dark'],
    previewColor: '#f8f4ee', accentColor: '#1a1410', defaultTypography: 'editorial',
    supportedSections: ['hero_image', 'lookbook', 'brand_story', 'featured_product', 'image_with_text', 'customer_reviews', 'newsletter'],
    tags: ['atelier', 'bespoke', 'luxury', 'craftsmanship'],
    presets: [
      { paletteId: 'ecru', label: 'Ecru', colors: { primary: '#1a1410', secondary: '#3d3028', accent: '#8b7355', background: '#f8f4ee', text: '#1a1410', buttonText: '#f8f4ee' } },
      { paletteId: 'slate', label: 'Slate', colors: { primary: '#c8bfb0', secondary: '#8a8278', accent: '#c9a96e', background: '#12100e', text: '#c8bfb0', buttonText: '#12100e' } },
    ],
  },
  {
    id: 'concrete', name: 'Concrete', category: 'experimental',
    description: 'Industrial texture. Brutalist grid. Nothing soft, nothing compromising.',
    bestFor: 'Experimental, brutalist, deconstructed fashion', supportedModes: ['dark'],
    previewColor: '#0e0e0e', accentColor: '#ffffff', defaultTypography: 'experimental',
    supportedSections: ['hero_image', 'product_grid', 'drop_countdown', 'brand_story', 'seller_posts', 'announcement', 'newsletter', 'image_with_text'],
    tags: ['brutalist', 'experimental', 'raw', 'industrial'],
    presets: [
      { paletteId: 'raw', label: 'Raw', colors: { primary: '#f0f0f0', secondary: '#a0a0a0', accent: '#ff0000', background: '#0e0e0e', text: '#f0f0f0', buttonText: '#0e0e0e' } },
    ],
  },
  {
    id: 'prestige', name: 'Prestige', category: 'luxury',
    description: 'Worn by those who don\'t need to prove anything. Status without noise.',
    bestFor: 'Ultra-premium, legacy brands, collector-grade fashion', supportedModes: ['dark'],
    previewColor: '#080608', accentColor: '#d4af37', defaultTypography: 'luxury',
    supportedSections: ['hero_image', 'featured_product', 'lookbook', 'brand_story', 'customer_reviews', 'newsletter'],
    tags: ['prestige', 'legacy', 'premium', 'collector'],
    presets: [
      { paletteId: 'gold', label: 'Gold', colors: { primary: '#d4af37', secondary: '#9e7f28', accent: '#f0d060', background: '#080608', text: '#f0e8d0', buttonText: '#080608' } },
    ],
  },
];

export const SECTION_TYPE_LABELS: Record<StoreSectionType, string> = {
  hero_image: 'Hero Image',
  hero_video: 'Hero Video',
  hero_slideshow: 'Hero Slideshow',
  featured_collection: 'Featured Collection',
  product_grid: 'Product Grid',
  featured_product: 'Featured Product',
  image_with_text: 'Image with Text',
  video_with_text: 'Video with Text',
  brand_story: 'Brand Story',
  lookbook: 'Lookbook',
  customer_reviews: 'Customer Reviews',
  seller_posts: 'Seller Posts',
  drop_countdown: 'Drop Countdown',
  announcement: 'Announcement',
  newsletter: 'Newsletter',
  faq: 'FAQ',
  social_feed: 'Social Feed',
  logo_list: 'Logo List',
  before_after: 'Before & After',
  text_banner: 'Text Banner',
  spacer: 'Spacer',
  custom_block: 'Custom Content',
};

export const AI_SUGGESTION_POOL: Omit<StoreAISuggestion, 'id' | 'dismissed' | 'applied' | 'createdAt'>[] = [
  { category: 'conversion', title: 'Hero button is hard to spot', problem: 'Your hero CTA button blends into the background.', recommendation: 'Increase button contrast or switch to a filled button style with a high-contrast color.', previewChange: 'Button switches to accent color fill.' },
  { category: 'layout', title: 'Move Best Sellers higher', problem: 'Best sellers are too far down the page.', recommendation: 'Move your best-selling products into the second or third homepage section.', previewChange: 'Best sellers section moves up.' },
  { category: 'accessibility', title: 'Low text contrast detected', problem: 'Some text colors are difficult to read on the current background.', recommendation: 'Increase contrast ratio to at least 4.5:1 for body text.', previewChange: 'Text color lightened for readability.' },
  { category: 'product', title: 'Add a size guide', problem: 'No size guide is linked on any product page.', recommendation: 'Enable the size guide feature and create a page. Customers abandon more without sizing clarity.', previewChange: 'Size guide link appears on product pages.' },
  { category: 'product', title: 'Explain pre-order items', problem: 'Pre-order products don\'t include an explanation of the timeline.', recommendation: 'Add a pre-order policy notice and estimated delivery date to pre-order product pages.', previewChange: 'Pre-order explanation badge appears.' },
  { category: 'copy', title: 'Shorten homepage copy', problem: 'Long text blocks in your hero reduce conversion.', recommendation: 'Trim hero copy to 1 headline + 1 short sentence. Lead with emotion, follow with product.', previewChange: 'Hero text shortened to essential message.' },
  { category: 'navigation', title: 'Simplify navigation', problem: 'Too many top-level menu items can overwhelm new visitors.', recommendation: 'Group secondary links into a dropdown or move to footer.', previewChange: 'Menu reduced to 4 primary items.' },
  { category: 'mobile', title: 'Images are too small on mobile', problem: 'Product images appear small on narrow screens.', recommendation: 'Switch collection page to a 2-column grid on mobile.', previewChange: 'Mobile grid updates to 2 columns.' },
  { category: 'branding', title: 'Feature a brand video', problem: 'You have great Seller content but no video on the homepage.', recommendation: 'Add a hero video or Seller posts section to put your content front and center.', previewChange: 'Seller posts section added to homepage.' },
  { category: 'performance', title: 'Reduce homepage sections', problem: 'More than 8 active homepage sections can slow load times.', recommendation: 'Hide or delete sections that are not driving customer action.', previewChange: 'Low-priority sections are hidden.' },
];
