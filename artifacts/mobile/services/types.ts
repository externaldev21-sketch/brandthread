// ─── Brandthread Seller Service Types ─────────────────────────────────────────
// Strongly-typed models for all seller entities.
// UI components import from here; real API calls will slot in later.

export type ProductStatus     = 'active' | 'draft' | 'archived' | 'pre-order';
export type ProductSalesModel = 'pre-order' | 'pre-made' | 'both';
export type OrderStatus       = 'new' | 'processing' | 'ready_to_ship' | 'shipped' | 'delivered' | 'refunded' | 'disputed' | 'cancelled';
export type PaymentStatus     = 'paid' | 'pending' | 'refunded' | 'partially_refunded';
export type FulfillmentStatus = 'unfulfilled' | 'partially_fulfilled' | 'fulfilled' | 'returned';
export type ManufacturerVerification = 'verified' | 'pending' | 'none';
export type ProductionStage   = 'quote' | 'sample' | 'approved' | 'production' | 'quality_check' | 'shipping' | 'delivered';
export type SampleStage       = 'requested' | 'paid' | 'in_development' | 'shipped' | 'delivered' | 'review_needed' | 'approved' | 'revisions';
export type ContentType       = 'video' | 'image' | 'slideshow' | 'story' | 'announcement' | 'countdown' | 'behind_scenes' | 'poll';
export type ContentStatus     = 'draft' | 'scheduled' | 'published' | 'archived';
export type CustomerSegment   = 'new' | 'returning' | 'vip' | 'at_risk' | 'high_spender';
export type PayoutStatus      = 'available' | 'pending' | 'paid' | 'held';
export type DesignProjectType = 'design' | 'mockup' | 'photoshoot' | 'draft';
export type QuoteStatus       = 'pending' | 'accepted' | 'declined' | 'countered' | 'expired';

// ─── Address ──────────────────────────────────────────────────────────────────
export interface Address {
  name:    string;
  line1:   string;
  line2?:  string;
  city:    string;
  state:   string;
  zip:     string;
  country: string;
}

// ─── Product ──────────────────────────────────────────────────────────────────
export interface Variant {
  id:             string;
  size:           string;
  color:          string;
  sku:            string;
  barcode?:       string;
  inventory:      number;
  priceCents:     number;
  compareAtPriceCents?: number;
  weight?:        number;
}

export interface Product {
  id:               string;
  name:             string;
  description:      string;
  category:         string;
  productType:      string;
  vendor:           string;
  status:           ProductStatus;
  salesModel:       ProductSalesModel;
  priceCents:       number;
  compareAtPriceCents?: number;
  costCents:         number;
  variants:         Variant[];
  totalInventory:   number;
  lowStockThreshold: number;
  totalSales:       number;
  revenueCents:     number;
  tags:             string[];
  collections:      string[];
  weight:           number;
  seoTitle?:        string;
  seoDescription?:  string;
  preOrderOpenDate?:  string;
  preOrderCloseDate?: string;
  preOrderMOQ?:       number;
  expectedShipDate?:  string;
  createdAt:        string;
  updatedAt:        string;
}

// ─── Order ────────────────────────────────────────────────────────────────────
export interface OrderItem {
  productId:   string;
  productName: string;
  variant:     string;
  quantity:    number;
  priceCents:  number;
  totalCents:  number;
}

export interface OrderTimeline {
  date:   string;
  event:  string;
  type:   'info' | 'success' | 'warning';
}

export interface Order {
  id:                string;
  orderNumber:       string;
  customer:          {
    id:          string;
    name:        string;
    email:       string;
    initials:    string;
    totalOrders: number;
  };
  items:             OrderItem[];
  status:            OrderStatus;
  paymentStatus:     PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  subtotalCents:     number;
  discountCents:     number;
  shippingCents:     number;
  taxCents:          number;
  totalCents:        number;
  shippingAddress:   Address;
  billingAddress:    Address;
  deliveryMethod:    string;
  trackingNumber?:   string;
  carrier?:          string;
  estimatedDelivery?: string;
  notes?:            string;
  internalNotes?:    string;
  timeline:          OrderTimeline[];
  date:              string;
  isPreOrder:        boolean;
  isHighRisk:        boolean;
}

// ─── Manufacturer ─────────────────────────────────────────────────────────────
export interface Manufacturer {
  id:            string;
  name:          string;
  country:       string;
  city:          string;
  initials:      string;
  rating:        number;
  reviewCount:   number;
  verification:  ManufacturerVerification;
  specialties:   string[];
  moq:           number;
  priceRange:    string;
  leadTime:      string;
  responseTime:  string;
  capabilities:  string[];
  certifications: string[];
  description:   string;
  activeOrders:  number;
  completedOrders: number;
  joined:        string;
}

// ─── Production ───────────────────────────────────────────────────────────────
export interface ProductionJob {
  id:                  string;
  product:             string;
  manufacturer:        string;
  manufacturerId:      string;
  stage:               ProductionStage;
  quantity:            number;
  unitCost:            number;
  totalCost:           number;
  deposit:             number;
  remainingBalance:    number;
  startDate:           string;
  estimatedCompletion: string;
  progress:            number;
  photos:              string[];
  notes?:              string;
}

// ─── Samples ──────────────────────────────────────────────────────────────────
export interface Sample {
  id:             string;
  product:        string;
  manufacturer:   string;
  manufacturerId: string;
  stage:          SampleStage;
  requestedDate:  string;
  expectedDate:   string;
  receivedDate?:  string;
  cost:           number;
  notes?:         string;
}

// ─── Quotes ───────────────────────────────────────────────────────────────────
export interface Quote {
  id:               string;
  product:          string;
  manufacturer:     string;
  manufacturerId:   string;
  unitPrice:        number;
  sampleCost:       number;
  toolingCost:      number;
  shippingEstimate: number;
  moq:              number;
  productionTime:   string;
  paymentTerms:     string;
  expiresAt:        string;
  status:           QuoteStatus;
  requestedAt:      string;
}

// ─── Inventory ────────────────────────────────────────────────────────────────
export interface InventoryItem {
  id:                string;
  productId:         string;
  productName:       string;
  variant:           string;
  sku:               string;
  quantity:          number;
  lowStockThreshold: number;
  location:          string;
  lastUpdated:       string;
}

// ─── Customer ─────────────────────────────────────────────────────────────────
export interface Customer {
  id:               string;
  name:             string;
  email:            string;
  phone?:           string;
  initials:         string;
  segment:          CustomerSegment;
  totalOrders:      number;
  totalSpent:       number;
  averageOrderValue: number;
  lastOrderDate?:   string;
  tags:             string[];
  marketingConsent: boolean;
  notes?:           string;
  address?:         Address;
  joinedDate:       string;
}

// ─── Content ──────────────────────────────────────────────────────────────────
export interface ContentPost {
  id:            string;
  type:          ContentType;
  status:        ContentStatus;
  caption:       string;
  hashtags:      string[];
  scheduledFor?: string;
  publishedAt?:  string;
  views:         number;
  likes:         number;
  comments:      number;
  saves:         number;
  shares:        number;
  productTags:   string[];
}

// ─── Design projects ──────────────────────────────────────────────────────────
export interface DesignProject {
  id:          string;
  name:        string;
  type:        DesignProjectType;
  lastEdited:  string;
  status:      'draft' | 'in_progress' | 'complete';
  thumbnail?:  string;
}

// ─── Payouts ──────────────────────────────────────────────────────────────────
export interface Payout {
  id:          string;
  amount:      number;
  status:      PayoutStatus;
  date:        string;
  description: string;
  orderIds:    string[];
}

// ─── Analytics ────────────────────────────────────────────────────────────────
export interface AnalyticsPoint {
  date:      string;
  revenue:   number;
  orders:    number;
  visitors:  number;
  conversion: number;
}

// ─── Seller profile & content extended types ─────────────────────────────────

export type PostStatus       = 'draft' | 'processing' | 'scheduled' | 'published' | 'failed' | 'archived';
export type AspectRatio      = '9:16' | '3:4' | '1:1';
export type MaxVideoDuration = 10 | 15 | 30 | 60;
export type OverlayType      = 'text' | 'sticker' | 'product' | 'price' | 'countdown' | 'logo' | 'image';
export type TransitionStyle  = 'cut' | 'fade' | 'slide' | 'zoom' | 'flash' | 'blur';
export type SoundCategory    = 'trending' | 'saved' | 'recent' | 'original' | 'royalty_free';

export interface SellerProfile {
  id:            string;
  sellerId:      string;
  brandName:     string;
  username:      string;
  bio:           string;
  website?:      string;
  location?:     string;
  category?:     string;
  contactEmail?: string;
  avatarColor:   string;
  initials:      string;
  verified:      boolean;
  isPublic:      boolean;
  followers:     number;
  following:     number;
  totalLikes:    number;
  productCount:  number;
  postCount:     number;
  createdAt:     string;
}

export interface PostMedia {
  id:            string;
  uri:           string;
  type:          'video' | 'image';
  width:         number;
  height:        number;
  duration?:     number;
  thumbnailUri?: string;
}

export interface VideoClip {
  id:            string;
  media:         PostMedia;
  trimStart:     number;
  trimEnd:       number;
  volume:        number;
  playbackSpeed: number;
  rotation:      number;
  cropX:         number;
  cropY:         number;
  cropScale:     number;
  order:         number;
}

export interface BeatMarker {
  time:     number;
  strength: number;
}

export interface Sound {
  id:           string;
  title:        string;
  artist:       string;
  duration:     number;
  genre?:       string;
  category:     SoundCategory;
  uri:          string;
  isOriginal:   boolean;
  isTrending:   boolean;
  useCount:     number;
  attribution?: string;
}

export interface SoundSelection {
  soundId:    string;
  soundTitle: string;
  artist:     string;
  startTime:  number;
  duration:   number;
  volume:     number;
  uri?:       string;
}

export interface PostOverlay {
  id:          string;
  type:        OverlayType;
  text?:       string;
  fontFamily?: string;
  fontSize?:   number;
  textColor?:  string;
  bgColor?:    string;
  textAlign?:  'left' | 'center' | 'right';
  startTime?:  number;
  endTime?:    number;
  x:           number;
  y:           number;
  width:       number;
  height:      number;
  rotation:    number;
  scale:       number;
  productId?:  string;
}

export interface PostProductTag {
  productId:   string;
  productName: string;
  priceCents:  number;
  imageUri?:   string;
  timestamp?:  number;
  slideIndex?: number;
}

export interface PostHashtag {
  tag:       string;
  trending?: boolean;
  postCount?: number;
}

export interface PostVisibility {
  isPublic:      boolean;
  allowComments: boolean;
  allowReposts:  boolean;
  showLikeCount: boolean;
}

export interface PostSchedule {
  scheduledAt: string;
  timezone:    string;
}

export interface VideoEdit {
  clips:               VideoClip[];
  maxDuration:         MaxVideoDuration;
  originalAudioVolume: number;
  sound?:              SoundSelection;
  beatSyncEnabled:     boolean;
  beatMarkers:         BeatMarker[];
  overlays:            PostOverlay[];
  aspectRatio:         '9:16';
}

export interface SlideshowEdit {
  slides:          PostMedia[];
  slideOrder:      string[];
  slideDuration:   number;
  transition:      TransitionStyle;
  transitionSpeed: 'slow' | 'normal' | 'fast';
  sound?:          SoundSelection;
  overlays:        PostOverlay[];
  aspectRatio:     AspectRatio;
}

export interface PostAnalytics {
  postId:             string;
  views:              number;
  uniqueViewers:      number;
  likes:              number;
  comments:           number;
  reposts:            number;
  saves:              number;
  shares:             number;
  profileVisits:      number;
  productClicks:      number;
  addToCartActions:   number;
  purchases:          number;
  revenue:            number;
  avgWatchTime:       number;
  completionRate:     number;
  retentionData:      { second: number; viewerPct: number }[];
  slideshowSwipeRate?: number;
  topCountries:       { country: string; pct: number }[];
  peakHour:           number;
}

export interface SellerPost {
  id:              string;
  sellerId:        string;
  brandId:         string;
  type:            ContentType;
  status:          PostStatus;
  caption:         string;
  hashtags:        PostHashtag[];
  thumbnailUri?:   string;
  aspectRatio:     AspectRatio;
  videoDuration?:  number;
  maxDuration?:    MaxVideoDuration;
  mediaUrls:       string[];
  sound?:          SoundSelection;
  videoEdit?:      VideoEdit;
  slideshowEdit?:  SlideshowEdit;
  overlays:        PostOverlay[];
  productTags:     PostProductTag[];
  visibility:      PostVisibility;
  schedule?:       PostSchedule;
  isPinned:        boolean;
  isSellerContent: true;
  analytics:       PostAnalytics;
  createdAt:       string;
  scheduledAt?:    string;
  publishedAt?:    string;
}

// ─── Subscription plans ───────────────────────────────────────────────────────
export interface PlanFeature {
  name:      string;
  included:  boolean;
  limit?:    string;
}

export interface SubscriptionPlan {
  id:       string;
  name:     string;
  price:    number;
  interval: 'month' | 'year';
  badge?:   string;
  features: PlanFeature[];
  highlight: boolean;
}
