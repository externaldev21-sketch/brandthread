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
export type ContentStatus     = 'draft' | 'scheduled' | 'published';
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
  price:          number;
  compareAtPrice?: number;
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
  price:            number;
  compareAtPrice?:  number;
  cost:             number;
  variants:         Variant[];
  totalInventory:   number;
  lowStockThreshold: number;
  totalSales:       number;
  revenue:          number;
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
  price:       number;
  total:       number;
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
  subtotal:          number;
  discount:          number;
  shipping:          number;
  tax:               number;
  total:             number;
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
