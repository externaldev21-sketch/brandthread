/**
 * Brandthread Analytics — type system
 * All stable, no random values. Demo data seeded in analyticsService.ts.
 */

// ── Date / comparison ────────────────────────────────────────────────────────

export type DateRangeKey =
  | 'today' | 'yesterday' | '7d' | '30d' | '90d'
  | 'this_month' | 'last_month' | 'this_year' | 'custom';

export type ComparisonKey =
  | 'previous_period' | 'previous_month' | 'previous_year' | 'none';

export interface AnalyticsDateRange {
  key: DateRangeKey;
  label: string;
  startDate: string; // ISO date string
  endDate:   string;
}

export interface AnalyticsComparison {
  key: ComparisonKey;
  label: string;
  startDate: string;
  endDate:   string;
}

// ── Shared primitives ─────────────────────────────────────────────────────────

/** A single chart data point */
export interface AnalyticsPoint {
  date:  string;  // ISO date
  /** Currency series use integer cents; other series use their native unit. */
  value: number;
  label?: string;
}

/** A single KPI card metric */
export interface AnalyticsMetric {
  key:           string;
  label:         string;
  /** Currency metrics are always integer cents; other metrics use their native unit. */
  value:         number;
  formatted:     string;         // "$12,400" | "3.4%" | "48"
  change?:       number;         // available only when the API returns comparison data
  changePct?:    number;
  trend?:        'up' | 'down' | 'flat';
  sparkline?:    AnalyticsPoint[];
  comparedTo?:   string;
  unit:          'currency' | 'percent' | 'number' | 'days';
}

// ── Overview ──────────────────────────────────────────────────────────────────

export interface AnalyticsOverview {
  dateRange:              AnalyticsDateRange;
  comparison:             AnalyticsComparison;
  lastUpdated:            string; // ISO datetime
  grossRevenue:           AnalyticsMetric;
  netRevenue:             AnalyticsMetric;
  profitEstimate:         AnalyticsMetric;
  orders:                 AnalyticsMetric;
  unitsSold:              AnalyticsMetric;
  storeVisitors:          AnalyticsMetric;
  conversionRate:         AnalyticsMetric;
  avgOrderValue:          AnalyticsMetric;
  returningCustomerRate:  AnalyticsMetric;
  refundRate:             AnalyticsMetric;
  productClicks:          AnalyticsMetric;
  contentAttributedRev:   AnalyticsMetric;
  marketingAttributedRev: AnalyticsMetric;
  pendingPayouts:         AnalyticsMetric;
  revenueChart:           AnalyticsPoint[];
  ordersChart:            AnalyticsPoint[];
  visitorsChart:          AnalyticsPoint[];
  insights:               AnalyticsInsight[];
}

// ── Sales ─────────────────────────────────────────────────────────────────────

export type SalesBreakdownKey =
  | 'product' | 'collection' | 'order_source' | 'storefront'
  | 'thread_post' | 'campaign' | 'customer_type' | 'location'
  | 'discount_code' | 'fulfillment_type';

export interface SalesBreakdownRow {
  key:         string;
  label:       string;
  revenue:     number;
  orders:      number;
  units:       number;
  sharePct:    number;
}

export interface SalesAnalytics {
  grossSales:      AnalyticsMetric;
  discounts:       AnalyticsMetric;
  returns:         AnalyticsMetric;
  refunds:         AnalyticsMetric;
  shippingRevenue: AnalyticsMetric;
  taxes:           AnalyticsMetric;
  netSales:        AnalyticsMetric;
  cogs:            AnalyticsMetric;
  estimatedFees:   AnalyticsMetric;
  estimatedProfit: AnalyticsMetric;
  profitMargin:    AnalyticsMetric;
  salesChart:      AnalyticsPoint[];
  ordersChart:     AnalyticsPoint[];
  unitsChart:      AnalyticsPoint[];
  aovChart:        AnalyticsPoint[];
  refundsChart:    AnalyticsPoint[];
  breakdownBy:     SalesBreakdownKey;
  breakdown:       SalesBreakdownRow[];
}

// ── Products ──────────────────────────────────────────────────────────────────

export interface ProductAnalyticsRow {
  productId:      string;
  name:           string;
  imageUrl?:      string;
  revenueCents:   number;
  unitsSold:      number;
  profit:         number;
  conversionRate: number;
  refundRate:     number;
  views:          number;
  inventoryStatus: 'in_stock' | 'low' | 'out_of_stock';
}

export interface ProductVariantAnalytics {
  variantId:   string;
  name:        string;
  units:       number;
  revenue:     number;
  refundRate:  number;
}

export interface ProductDetailAnalytics {
  productId:            string;
  name:                 string;
  pageViews:            AnalyticsMetric;
  uniqueVisitors:       AnalyticsMetric;
  addToCartRate:        AnalyticsMetric;
  checkoutStartRate:    AnalyticsMetric;
  purchaseConversion:   AnalyticsMetric;
  unitsSold:            AnalyticsMetric;
  revenue:              AnalyticsMetric;
  profitEstimate:       AnalyticsMetric;
  avgSellingPrice:      AnalyticsMetric;
  discountUsageRate:    AnalyticsMetric;
  refundRate:           AnalyticsMetric;
  returnRate:           AnalyticsMetric;
  bestSize:             string;
  bestColor:            string;
  bestVariant:          string;
  inventorySellThrough: AnalyticsMetric;
  daysOfStockLeft:      AnalyticsMetric;
  contentAttributedSales: number;
  campaignAttributedSales: number;
  topVariants:          ProductVariantAnalytics[];
}

export interface ProductAnalytics {
  topByRevenue:     ProductAnalyticsRow[];
  topByUnits:       ProductAnalyticsRow[];
  topByProfit:      ProductAnalyticsRow[];
  mostViewed:       ProductAnalyticsRow[];
  highestConversion: ProductAnalyticsRow[];
  lowestConversion: ProductAnalyticsRow[];
  mostReturned:     ProductAnalyticsRow[];
  lowPerforming:    ProductAnalyticsRow[];
}

// ── Customers ─────────────────────────────────────────────────────────────────

export interface CustomerCohort {
  cohortLabel:     string;  // e.g. "Jan 2026"
  customers:       number;
  month1RetentionPct: number;
  month2RetentionPct: number;
  month3RetentionPct: number;
  avgLtvCents:     number;
}

export interface CustomerLocationRow {
  location:    string;
  customers:   number;
  sharePct:    number;
}

export interface CustomerAnalytics {
  totalCustomers:       AnalyticsMetric;
  newCustomers:         AnalyticsMetric;
  returningCustomers:   AnalyticsMetric;
  repeatRate:           AnalyticsMetric;
  avgCustomerValue:     AnalyticsMetric;
  clv:                  AnalyticsMetric;
  purchaseFrequency:    AnalyticsMetric;
  avgDaysBetweenOrders: AnalyticsMetric;
  churnRisk:            AnalyticsMetric;
  vipCount:             AnalyticsMetric;
  atRiskCount:          AnalyticsMetric;
  cohorts:              CustomerCohort[];
  topLocations:         CustomerLocationRow[];
  newVsReturningChart:  AnalyticsPoint[];
}

// ── Content ───────────────────────────────────────────────────────────────────

export interface VideoRetentionPoint {
  positionPct:  number;  // 0–100
  retentionPct: number;  // 0–100
}

export interface ContentPostRow {
  postId:          string;
  type:            'video' | 'slideshow' | 'image';
  thumbnailUrl?:   string;
  caption:         string;
  views:           number;
  likes:           number;
  comments:        number;
  saves:           number;
  shares:          number;
  productClicks:   number;
  revenue:         number;
  completionRate:  number;
  publishedAt:     string;
}

export interface ContentAnalytics {
  views:             AnalyticsMetric;
  uniqueViewers:     AnalyticsMetric;
  likes:             AnalyticsMetric;
  comments:          AnalyticsMetric;
  saves:             AnalyticsMetric;
  shares:            AnalyticsMetric;
  profileVisits:     AnalyticsMetric;
  productClicks:     AnalyticsMetric;
  addToCarts:        AnalyticsMetric;
  purchases:         AnalyticsMetric;
  revenueAttributed: AnalyticsMetric;
  avgWatchTime:      AnalyticsMetric;
  completionRate:    AnalyticsMetric;
  followerGrowth:    AnalyticsMetric;
  topVideos:         ContentPostRow[];
  topSlideshows:     ContentPostRow[];
  highestRevenuePosts: ContentPostRow[];
  retention:         VideoRetentionPoint[];
}

// ── Store ─────────────────────────────────────────────────────────────────────

export interface StoreFunnelStep {
  label:         string;
  count:         number;
  conversionPct: number;  // from previous step
  dropOffPct:    number;
}

export interface StoreSectionAnalytics {
  sectionKey:    string;
  label:         string;
  views:         number;
  clicks:        number;
  ctr:           number;
  purchasesInfluenced: number;
}

export interface StoreAnalytics {
  visitors:         AnalyticsMetric;
  uniqueVisitors:   AnalyticsMetric;
  sessions:         AnalyticsMetric;
  productPageViews: AnalyticsMetric;
  addToCartRate:    AnalyticsMetric;
  checkoutStartRate: AnalyticsMetric;
  purchaseConversion: AnalyticsMetric;
  avgSessionDuration: AnalyticsMetric;
  returningVisitors: AnalyticsMetric;
  mobileTrafficPct: AnalyticsMetric;
  funnel:           StoreFunnelStep[];
  sections:         StoreSectionAnalytics[];
  visitorsChart:    AnalyticsPoint[];
}

// ── Marketing ─────────────────────────────────────────────────────────────────

export interface CampaignAnalytics {
  campaignId:       string;
  name:             string;
  type:             'email' | 'sms' | 'push' | 'automation';
  recipients:       number;
  delivered:        number;
  opens:            number;
  clicks:           number;
  orders:           number;
  revenueCents:     number;
  conversionRate:   number;
  unsubscribes:     number;
  revenuePerRecipientCents: number;
  sentAt:           string;
}

export interface InfluencerAnalytics {
  influencerId:  string;
  name:          string;
  views:         number;
  clicks:        number;
  orders:        number;
  revenueCents:  number;
  commissionCents: number;
  returnOnCost:  number;
  discountUsage: number;
}

export interface ReferralAnalytics {
  shares:           number;
  clicks:           number;
  referredCustomers: number;
  orders:           number;
  revenueCents:     number;
  rewardsIssuedCents: number;
  topAdvocates:     Array<{ name: string; referrals: number; revenueCents: number }>;
}

export interface MarketingAnalytics {
  marketingRevenue:       AnalyticsMetric;
  emailRevenue:           AnalyticsMetric;
  smsRevenue:             AnalyticsMetric;
  discountRevenue:        AnalyticsMetric;
  automationRevenue:      AnalyticsMetric;
  influencerRevenue:      AnalyticsMetric;
  referralRevenue:        AnalyticsMetric;
  abandonedCheckoutRecovered: AnalyticsMetric;
  campaigns:              CampaignAnalytics[];
  influencers:            InfluencerAnalytics[];
  referral:               ReferralAnalytics;
}

// ── Inventory ─────────────────────────────────────────────────────────────────

export interface InventoryProductRow {
  productId:       string;
  name:            string;
  unitsOnHand:     number;
  daysOfStockLeft: number;
  sellThroughRate: number;
  status:          'healthy' | 'low' | 'out' | 'overstock';
}

export interface InventoryAnalytics {
  inventoryValue:    AnalyticsMetric;
  unitsOnHand:       AnalyticsMetric;
  unitsAvailable:    AnalyticsMetric;
  unitsReserved:     AnalyticsMetric;
  unitsIncoming:     AnalyticsMetric;
  lowStockCount:     AnalyticsMetric;
  outOfStockCount:   AnalyticsMetric;
  deadStockEstimate: AnalyticsMetric;
  sellThroughRate:   AnalyticsMetric;
  inventoryTurnover: AnalyticsMetric;
  avgDaysOfStock:    AnalyticsMetric;
  fastestSelling:    InventoryProductRow[];
  slowestSelling:    InventoryProductRow[];
  mostOverstocked:   InventoryProductRow[];
  likelyRunOut:      InventoryProductRow[];
}

// ── Production ────────────────────────────────────────────────────────────────

export interface ManufacturerAnalyticsRow {
  manufacturerId:     string;
  name:               string;
  productsProduced:   number;
  totalUnits:         number;
  totalSpend:         number;
  avgUnitCost:        number;
  avgLeadTimeDays:    number;
  delayRate:          number;
  qualityIssueRate:   number;
  sampleApprovalRate: number;
}

export interface ProductionAnalytics {
  activeJobs:             AnalyticsMetric;
  unitsInProduction:      AnalyticsMetric;
  productionValue:        AnalyticsMetric;
  avgLeadTimeDays:        AnalyticsMetric;
  avgSampleTimeDays:      AnalyticsMetric;
  onTimeCompletionRate:   AnalyticsMetric;
  delayedJobs:            AnalyticsMetric;
  qcFailureRate:          AnalyticsMetric;
  avgManufacturerResponse: AnalyticsMetric;
  avgUnitCost:            AnalyticsMetric;
  manufacturers:          ManufacturerAnalyticsRow[];
}

// ── Profit ────────────────────────────────────────────────────────────────────

export interface ProfitLineItem {
  label:      string;
  amount:     number;
  isEstimate: boolean;
  isDeduction: boolean;
}

export interface ProfitAnalytics {
  grossRevenue:      AnalyticsMetric;
  netRevenue:        AnalyticsMetric;
  productCost:       AnalyticsMetric;
  manufacturerCost:  AnalyticsMetric;
  packagingCost:     AnalyticsMetric;
  shippingCost:      AnalyticsMetric;
  platformFees:      AnalyticsMetric;
  paymentFees:       AnalyticsMetric;
  refunds:           AnalyticsMetric;
  marketingCost:     AnalyticsMetric;
  influencerCost:    AnalyticsMetric;
  estimatedProfit:   AnalyticsMetric;
  profitMargin:      AnalyticsMetric;
  lineItems:         ProfitLineItem[];
  profitChart:       AnalyticsPoint[];
  marginChart:       AnalyticsPoint[];
}

// ── Payout ────────────────────────────────────────────────────────────────────

export interface PayoutAnalytics {
  availableBalance:       AnalyticsMetric;
  pendingBalance:         AnalyticsMetric;
  heldFunds:              AnalyticsMetric;
  nextPayoutAmount:       AnalyticsMetric;
  nextPayoutDate:         string;
  totalPaidOut:           AnalyticsMetric;
  manufacturerAllocation: AnalyticsMetric;
  shippingAllocation:     AnalyticsMetric;
  disputeHolds:           AnalyticsMetric;
  refundImpact:           AnalyticsMetric;
}

// ── Attribution ───────────────────────────────────────────────────────────────

export type AttributionSource =
  | 'seller_post' | 'campaign' | 'discount' | 'influencer' | 'referral' | 'store_section' | 'direct';

export type AttributionWindowKey = 'same_session' | '1d' | '7d' | '30d';

export interface AttributionRecord {
  source:       AttributionSource;
  label:        string;
  primaryOrders:   number;
  primaryRevenue:  number;
  assistedOrders:  number;
  assistedRevenue: number;
  window:       AttributionWindowKey;
}

// ── Insights ──────────────────────────────────────────────────────────────────

export type InsightType =
  | 'opportunity' | 'warning' | 'info' | 'action_needed';

export interface AnalyticsInsight {
  id:           string;
  type:         InsightType;
  title:        string;
  what:         string;   // what happened
  why:          string;   // why it matters
  action:       string;   // recommended action
  route?:       string;   // open relevant screen
  dismissed:    boolean;
  completed:    boolean;
  createdAt:    string;
}

// ── Export ────────────────────────────────────────────────────────────────────

export type ExportSection =
  | 'overview' | 'sales' | 'products' | 'customers' | 'content'
  | 'store' | 'marketing' | 'inventory' | 'production' | 'profit';

export interface AnalyticsExport {
  section:    ExportSection;
  format:     'csv' | 'summary';
  dateRange:  AnalyticsDateRange;
  generatedAt: string;
  url?:       string;
}

// ── Filter state (shared across screens) ─────────────────────────────────────

export interface AnalyticsFilterState {
  dateRange:   AnalyticsDateRange;
  comparison:  AnalyticsComparison;
  groupBy:     'daily' | 'weekly' | 'monthly';
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const DATE_RANGE_OPTIONS: AnalyticsDateRange[] = [
  { key: 'today',       label: 'Today',        startDate: '', endDate: '' },
  { key: 'yesterday',   label: 'Yesterday',    startDate: '', endDate: '' },
  { key: '7d',          label: 'Last 7 days',  startDate: '', endDate: '' },
  { key: '30d',         label: 'Last 30 days', startDate: '', endDate: '' },
  { key: '90d',         label: 'Last 90 days', startDate: '', endDate: '' },
  { key: 'this_month',  label: 'This month',   startDate: '', endDate: '' },
  { key: 'last_month',  label: 'Last month',   startDate: '', endDate: '' },
  { key: 'this_year',   label: 'This year',    startDate: '', endDate: '' },
];

export const COMPARISON_OPTIONS: AnalyticsComparison[] = [
  { key: 'previous_period', label: 'Previous period', startDate: '', endDate: '' },
  { key: 'previous_month',  label: 'Previous month',  startDate: '', endDate: '' },
  { key: 'previous_year',   label: 'Previous year',   startDate: '', endDate: '' },
  { key: 'none',            label: 'No comparison',   startDate: '', endDate: '' },
];

export const ANALYTICS_SECTIONS = [
  { key: 'overview',    label: 'Overview',    icon: 'home'         as const },
  { key: 'sales',       label: 'Sales',       icon: 'dollar-sign'  as const },
  { key: 'products',    label: 'Products',    icon: 'package'      as const },
  { key: 'customers',   label: 'Customers',   icon: 'users'        as const },
  { key: 'content',     label: 'Content',     icon: 'video'        as const },
  { key: 'store',       label: 'Store',       icon: 'layout'       as const },
  { key: 'marketing',   label: 'Marketing',   icon: 'mail'         as const },
  { key: 'inventory',   label: 'Inventory',   icon: 'archive'      as const },
  { key: 'production',  label: 'Production',  icon: 'tool'         as const },
  { key: 'profit',      label: 'Profit',      icon: 'trending-up'  as const },
] as const;
