/**
 * Brandthread Analytics Service
 * All demo data is stable (no Math.random()). Values are seeded constants.
 * Replace stub functions with real API calls when backend is ready.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AnalyticsOverview, SalesAnalytics, ProductAnalytics, CustomerAnalytics,
  ContentAnalytics, StoreAnalytics, MarketingAnalytics, InventoryAnalytics,
  ProductionAnalytics, ProfitAnalytics, PayoutAnalytics, AttributionRecord,
  AnalyticsInsight, AnalyticsExport, AnalyticsFilterState, AnalyticsPoint,
  AnalyticsMetric, ExportSection, DATE_RANGE_OPTIONS, COMPARISON_OPTIONS,
  InsightType,
} from './analyticsTypes';

const INSIGHTS_KEY = 'bt:analytics:insights:v1';
const FILTER_KEY   = 'bt:analytics:filter:v1';

// ── Helpers ───────────────────────────────────────────────────────────────────

function metric(
  key: string, label: string, value: number, change: number,
  unit: AnalyticsMetric['unit'], sparkData: number[], comparedTo = 'vs. previous period'
): AnalyticsMetric {
  const changePct = value - change === 0 ? 0 : Math.round((change / Math.abs(value - change)) * 1000) / 10;
  const trend: AnalyticsMetric['trend'] = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  const sparkline: AnalyticsPoint[] = sparkData.map((v, i) => ({
    date: `2026-06-${String(i + 1).padStart(2, '0')}`,
    value: v,
  }));
  let formatted = '';
  if (unit === 'currency') formatted = `$${value.toLocaleString()}`;
  else if (unit === 'percent') formatted = `${value}%`;
  else if (unit === 'days') formatted = `${value}d`;
  else formatted = value.toLocaleString();
  return { key, label, value, formatted, change, changePct, trend, sparkline, comparedTo, unit };
}

function points(values: number[], startDay = 1): AnalyticsPoint[] {
  return values.map((v, i) => ({
    date: `2026-06-${String(startDay + i).padStart(2, '0')}`,
    value: v,
  }));
}

// ── Filter state ──────────────────────────────────────────────────────────────

export async function getFilterState(): Promise<AnalyticsFilterState> {
  try {
    const raw = await AsyncStorage.getItem(FILTER_KEY);
    if (raw) return JSON.parse(raw) as AnalyticsFilterState;
  } catch { /* non-fatal */ }
  return {
    dateRange:  DATE_RANGE_OPTIONS[3], // 30d default
    comparison: COMPARISON_OPTIONS[0],
    groupBy:    'daily',
  };
}

export async function saveFilterState(state: AnalyticsFilterState): Promise<void> {
  await AsyncStorage.setItem(FILTER_KEY, JSON.stringify(state));
}

// ── Overview ──────────────────────────────────────────────────────────────────

export async function getOverview(_filter?: AnalyticsFilterState): Promise<AnalyticsOverview> {
  await delay(420);
  const spark30 = [68,72,65,80,88,75,90,82,78,95,70,85,92,88,76,80,84,91,78,86,90,72,88,94,80,78,84,96,90,100];
  return {
    dateRange:   DATE_RANGE_OPTIONS[3],
    comparison:  COMPARISON_OPTIONS[0],
    lastUpdated: '2026-07-14T08:00:00Z',
    grossRevenue:           metric('gross_revenue',  'Gross Revenue',           94200, 12800, 'currency', spark30),
    netRevenue:             metric('net_revenue',    'Net Revenue',             81600, 10400, 'currency', spark30.map(v => Math.round(v * 0.86))),
    profitEstimate:         metric('profit',         'Profit Estimate',         28560, 4200,  'currency', spark30.map(v => Math.round(v * 0.30))),
    orders:                 metric('orders',         'Orders',                   627,  84,    'number',   spark30.map(v => Math.round(v * 6.27))),
    unitsSold:              metric('units',          'Units Sold',              1840,  220,   'number',   spark30.map(v => Math.round(v * 18.4))),
    storeVisitors:          metric('visitors',       'Store Visitors',         18400, 2100,  'number',   spark30.map(v => Math.round(v * 184))),
    conversionRate:         metric('conversion',     'Conversion Rate',          3.4,  0.6,   'percent',  spark30.map(v => parseFloat((v * 0.034).toFixed(2)))),
    avgOrderValue:          metric('aov',            'Avg Order Value',          128,  12,    'currency', spark30.map(v => Math.round(v * 1.2))),
    returningCustomerRate:  metric('returning',      'Returning Customers',       42,  4,     'percent',  spark30.map(v => Math.round(v * 0.42))),
    refundRate:             metric('refunds',        'Refund Rate',              2.1, -0.3,   'percent',  spark30.map(v => parseFloat((v * 0.021).toFixed(2)))),
    productClicks:          metric('prod_clicks',    'Product Clicks',          9200,  840,   'number',   spark30.map(v => Math.round(v * 92))),
    contentAttributedRev:   metric('content_rev',   'Content Revenue',         14200, 2800,  'currency', spark30.map(v => Math.round(v * 142))),
    marketingAttributedRev: metric('mktg_rev',      'Marketing Revenue',       18600, 3100,  'currency', spark30.map(v => Math.round(v * 186))),
    pendingPayouts:         metric('pending',        'Pending Payouts',          6840,  0,    'currency', [6840,6840,6840,6840,6840,6840,6840,6840,6840,6840,6840,6840,6840,6840,6840,6840,6840,6840,6840,6840,6840,6840,6840,6840,6840,6840,6840,6840,6840,6840]),
    revenueChart: points([620,680,590,820,880,740,920,840,780,960,700,860,930,890,760,800,840,920,790,870,910,720,890,950,810,780,850,970,910,1020]),
    ordersChart:  points([4,5,3,6,7,5,8,6,5,8,4,6,7,6,5,5,6,7,5,6,7,4,6,8,5,5,6,8,7,9]),
    visitorsChart: points([580,620,540,740,810,680,860,780,710,890,640,790,850,830,710,750,790,870,740,820,860,670,840,900,770,740,800,920,860,960]),
    insights: await getInsights(),
  };
}

// ── Sales ─────────────────────────────────────────────────────────────────────

export async function getSalesAnalytics(_filter?: AnalyticsFilterState): Promise<SalesAnalytics> {
  await delay(380);
  const sp = [620,680,590,820,880,740,920,840,780,960,700,860,930,890,760,800,840,920,790,870,910,720,890,950,810,780,850,970,910,1020];
  return {
    grossSales:      metric('gross_sales',   'Gross Sales',     94200, 12800, 'currency', sp),
    discounts:       metric('discounts',     'Discounts',        3800,  400,  'currency', sp.map(v => Math.round(v * 0.04))),
    returns:         metric('returns',       'Returns',          1200, -200,  'currency', sp.map(v => Math.round(v * 0.012))),
    refunds:         metric('refunds',       'Refunds',           840, -180,  'currency', sp.map(v => Math.round(v * 0.009))),
    shippingRevenue: metric('shipping_rev',  'Shipping Revenue', 2400,  180,  'currency', sp.map(v => Math.round(v * 0.025))),
    taxes:           metric('taxes',         'Taxes',            5640,  760,  'currency', sp.map(v => Math.round(v * 0.06))),
    netSales:        metric('net_sales',     'Net Sales',       81600, 10400, 'currency', sp.map(v => Math.round(v * 0.87))),
    cogs:            metric('cogs',          'Cost of Goods',   32640, 4100,  'currency', sp.map(v => Math.round(v * 0.35))),
    estimatedFees:   metric('fees',          'Platform Fees',    5040,  640,  'currency', sp.map(v => Math.round(v * 0.054))),
    estimatedProfit: metric('profit',        'Est. Profit',     28560, 4200,  'currency', sp.map(v => Math.round(v * 0.30))),
    profitMargin:    metric('margin',        'Profit Margin',    30.3,  1.8,  'percent',  sp.map(v => parseFloat((v * 0.003).toFixed(1)))),
    salesChart:  points(sp),
    ordersChart: points([4,5,3,6,7,5,8,6,5,8,4,6,7,6,5,5,6,7,5,6,7,4,6,8,5,5,6,8,7,9]),
    unitsChart:  points([18,22,14,28,32,24,36,28,22,38,18,28,32,30,24,26,28,34,24,30,34,18,30,38,26,24,28,40,34,44]),
    aovChart:    points([118,122,114,128,132,124,138,128,122,138,118,128,132,130,124,126,128,134,124,130,134,118,130,138,126,124,128,140,134,144]),
    refundsChart: points([1,2,1,3,2,1,2,2,1,3,1,2,3,2,1,1,2,2,1,2,3,1,2,3,1,1,2,3,2,4]),
    breakdownBy: 'product',
    breakdown: [
      { key: 'p1', label: 'Classic Thread Tee',    revenue: 12400, orders: 120, units: 298, sharePct: 13.2 },
      { key: 'p2', label: 'Drop-Shoulder Blazer',  revenue:  9180, orders:  48, units:  51, sharePct:  9.7 },
      { key: 'p3', label: 'Oversized Hoodie',      revenue:  7820, orders:  60, units:  68, sharePct:  8.3 },
      { key: 'p4', label: 'Wide-Leg Trousers',     revenue:  6506, orders:  58, units:  66, sharePct:  6.9 },
      { key: 'p5', label: 'Logo Cap',              revenue:  3960, orders: 100, units: 110, sharePct:  4.2 },
    ],
  };
}

// ── Products ──────────────────────────────────────────────────────────────────

const DEMO_PRODUCTS = [
  { productId:'p1', name:'Classic Thread Tee',   revenue:12400, unitsSold:298, profit:4340, conversionRate:4.8, refundRate:1.2, views:6210, inventoryStatus:'in_stock' as const },
  { productId:'p2', name:'Drop-Shoulder Blazer', revenue: 9180, unitsSold: 51, profit:3670, conversionRate:2.1, refundRate:2.8, views:2430, inventoryStatus:'in_stock' as const },
  { productId:'p3', name:'Oversized Hoodie',     revenue: 7820, unitsSold: 68, profit:2740, conversionRate:3.4, refundRate:3.1, views:2000, inventoryStatus:'low'      as const },
  { productId:'p4', name:'Wide-Leg Trousers',    revenue: 6506, unitsSold: 66, profit:2280, conversionRate:2.9, refundRate:1.8, views:2280, inventoryStatus:'in_stock' as const },
  { productId:'p5', name:'Logo Cap',             revenue: 3960, unitsSold:110, profit:1980, conversionRate:5.2, refundRate:0.9, views:2120, inventoryStatus:'in_stock' as const },
  { productId:'p6', name:'Cargo Shorts',         revenue: 2840, unitsSold: 88, profit: 996, conversionRate:1.6, refundRate:4.2, views:5500, inventoryStatus:'out_of_stock' as const },
  { productId:'p7', name:'Essential Crewneck',   revenue: 5100, unitsSold:102, profit:1785, conversionRate:3.8, refundRate:1.4, views:2680, inventoryStatus:'low'      as const },
];

export async function getProductAnalytics(_filter?: AnalyticsFilterState): Promise<ProductAnalytics> {
  await delay(360);
  const sorted = [...DEMO_PRODUCTS];
  return {
    topByRevenue:     [...sorted].sort((a,b) => b.revenue - a.revenue),
    topByUnits:       [...sorted].sort((a,b) => b.unitsSold - a.unitsSold),
    topByProfit:      [...sorted].sort((a,b) => b.profit - a.profit),
    mostViewed:       [...sorted].sort((a,b) => b.views - a.views),
    highestConversion:[...sorted].sort((a,b) => b.conversionRate - a.conversionRate),
    lowestConversion: [...sorted].sort((a,b) => a.conversionRate - b.conversionRate),
    mostReturned:     [...sorted].sort((a,b) => b.refundRate - a.refundRate),
    lowPerforming:    sorted.filter(p => p.conversionRate < 2.5),
  };
}

// ── Customers ─────────────────────────────────────────────────────────────────

export async function getCustomerAnalytics(_filter?: AnalyticsFilterState): Promise<CustomerAnalytics> {
  await delay(340);
  const sp30 = [12,14,10,18,22,16,24,20,18,26,12,20,22,20,16,18,20,24,18,22,24,14,20,28,18,16,20,28,24,32];
  return {
    totalCustomers:       metric('total_cust',    'Total Customers',        2840, 340,  'number',  sp30),
    newCustomers:         metric('new_cust',      'New Customers',           627,  84,  'number',  sp30),
    returningCustomers:   metric('ret_cust',      'Returning Customers',     263,  48,  'number',  sp30.map(v => Math.round(v * 0.42))),
    repeatRate:           metric('repeat_rate',   'Repeat Rate',             42,   4,  'percent', sp30.map(v => Math.round(v * 0.42))),
    avgCustomerValue:     metric('acv',           'Avg Customer Value',      128,  12,  'currency',sp30.map(v => Math.round(v * 1.28))),
    clv:                  metric('clv',           'Customer LTV',            480,  30,  'currency',sp30.map(v => Math.round(v * 4.8))),
    purchaseFrequency:    metric('freq',          'Purchase Frequency',      1.8,  0.2, 'number',  sp30.map(() => 1.8)),
    avgDaysBetweenOrders: metric('days_between',  'Avg Days Between Orders', 42,  -4,  'days',    sp30.map(() => 42)),
    churnRisk:            metric('churn',         'Churn Risk',              18,   2,  'percent', sp30.map(() => 18)),
    vipCount:             metric('vip',           'VIP Customers',           84,   12, 'number',  sp30.map(v => Math.round(v * 0.84))),
    atRiskCount:          metric('at_risk',       'At-Risk Customers',       142, -18, 'number',  sp30.map(v => Math.round(v * 1.42))),
    cohorts: [
      { cohortLabel:'Jan 2026', customers:180, month1RetentionPct:48, month2RetentionPct:32, month3RetentionPct:24, avgLtv:360 },
      { cohortLabel:'Feb 2026', customers:142, month1RetentionPct:52, month2RetentionPct:34, month3RetentionPct:0,  avgLtv:290 },
      { cohortLabel:'Mar 2026', customers:198, month1RetentionPct:44, month2RetentionPct:0,  month3RetentionPct:0,  avgLtv:310 },
    ],
    topLocations: [
      { location:'United States', customers:1480, sharePct:52.1 },
      { location:'United Kingdom', customers:384, sharePct:13.5 },
      { location:'Canada',         customers:284, sharePct:10.0 },
      { location:'Australia',      customers:198, sharePct: 7.0 },
      { location:'Germany',        customers:142, sharePct: 5.0 },
    ],
    newVsReturningChart: points(sp30),
  };
}

// ── Content ───────────────────────────────────────────────────────────────────

export async function getContentAnalytics(_filter?: AnalyticsFilterState): Promise<ContentAnalytics> {
  await delay(380);
  const sp = [2200,2800,1900,3600,4200,3100,4800,3800,3400,5200,2400,3800,4200,4000,3200,3600,3800,4600,3400,4000,4400,2600,3800,5200,3600,3200,3800,5400,4600,6000];
  const POSTS = [
    { postId:'v1', type:'video' as const, caption:'Drop tease - The B Hoodie', views:48200, likes:3840, comments:284, saves:1240, shares:680, productClicks:2840, revenue:4200, completionRate:68, publishedAt:'2026-07-10T14:00:00Z', thumbnailUrl:undefined },
    { postId:'v2', type:'video' as const, caption:'Behind the scenes - factory visit', views:32100, likes:2640, comments:182, saves:840, shares:420, productClicks:1480, revenue:2100, completionRate:74, publishedAt:'2026-07-08T12:00:00Z', thumbnailUrl:undefined },
    { postId:'s1', type:'slideshow' as const, caption:'Summer lookbook', views:28400, likes:2180, comments:148, saves:980, shares:360, productClicks:1840, revenue:3100, completionRate:52, publishedAt:'2026-07-06T10:00:00Z', thumbnailUrl:undefined },
    { postId:'v3', type:'video' as const, caption:'Styling the Wide Leg Trousers', views:19800, likes:1480, comments:96, saves:620, shares:240, productClicks:1240, revenue:1840, completionRate:81, publishedAt:'2026-07-04T09:00:00Z', thumbnailUrl:undefined },
    { postId:'s2', type:'slideshow' as const, caption:'New arrivals — July', views:16200, likes:1240, comments:84, saves:540, shares:180, productClicks:980, revenue:1420, completionRate:44, publishedAt:'2026-07-02T11:00:00Z', thumbnailUrl:undefined },
  ];
  const RETENTION = [
    {positionPct:0,retentionPct:100},{positionPct:10,retentionPct:84},{positionPct:20,retentionPct:78},
    {positionPct:30,retentionPct:72},{positionPct:40,retentionPct:68},{positionPct:50,retentionPct:62},
    {positionPct:60,retentionPct:54},{positionPct:70,retentionPct:48},{positionPct:80,retentionPct:40},
    {positionPct:90,retentionPct:32},{positionPct:100,retentionPct:28},
  ];
  return {
    views:             metric('views',      'Total Views',          148400, 24200, 'number',  sp),
    uniqueViewers:     metric('uniq_views', 'Unique Viewers',        98200, 14800, 'number',  sp.map(v=>Math.round(v*0.66))),
    likes:             metric('likes',      'Likes',                 11380,  1820, 'number',  sp.map(v=>Math.round(v*0.077))),
    comments:          metric('comments',   'Comments',                794,   120, 'number',  sp.map(v=>Math.round(v*0.0054))),
    saves:             metric('saves',      'Saves',                  4220,   680, 'number',  sp.map(v=>Math.round(v*0.028))),
    shares:            metric('shares',     'Shares',                 1880,   340, 'number',  sp.map(v=>Math.round(v*0.013))),
    profileVisits:     metric('prof_visits','Profile Visits',         8420,  1240, 'number',  sp.map(v=>Math.round(v*0.057))),
    productClicks:     metric('prod_clicks','Product Clicks',         8380,  1480, 'number',  sp.map(v=>Math.round(v*0.057))),
    addToCarts:        metric('atc',        'Add to Carts',           1840,   280, 'number',  sp.map(v=>Math.round(v*0.012))),
    purchases:         metric('purchases',  'Purchases',               248,    42, 'number',  sp.map(v=>Math.round(v*0.0017))),
    revenueAttributed: metric('rev_attr',   'Revenue Attributed',    12660,  2840, 'currency',sp.map(v=>Math.round(v*0.085))),
    avgWatchTime:      metric('watch_time', 'Avg Watch Time',          14.2,   1.8,'number',  sp.map(()=>14.2)),
    completionRate:    metric('completion', 'Completion Rate',          64,     6, 'percent', sp.map(()=>64)),
    followerGrowth:    metric('followers',  'Follower Growth',         840,   120, 'number',  sp.map(v=>Math.round(v*0.0057))),
    topVideos:      POSTS.filter(p=>p.type==='video'),
    topSlideshows:  POSTS.filter(p=>p.type==='slideshow'),
    highestRevenuePosts: [...POSTS].sort((a,b)=>b.revenue-a.revenue),
    retention: RETENTION,
  };
}

// ── Store ─────────────────────────────────────────────────────────────────────

export async function getStoreAnalytics(_filter?: AnalyticsFilterState): Promise<StoreAnalytics> {
  await delay(350);
  const sp = [580,620,540,740,810,680,860,780,710,890,640,790,850,830,710,750,790,870,740,820,860,670,840,900,770,740,800,920,860,960];
  return {
    visitors:          metric('visitors',   'Store Visitors',        18400, 2100, 'number',  sp),
    uniqueVisitors:    metric('uniq_vis',   'Unique Visitors',       12800, 1400, 'number',  sp.map(v=>Math.round(v*0.70))),
    sessions:          metric('sessions',   'Sessions',              22100, 2600, 'number',  sp.map(v=>Math.round(v*1.2))),
    productPageViews:  metric('prod_views', 'Product Page Views',    48200, 5800, 'number',  sp.map(v=>Math.round(v*2.62))),
    addToCartRate:     metric('atc_rate',   'Add to Cart Rate',       12.5,  1.2, 'percent', sp.map(()=>12.5)),
    checkoutStartRate: metric('co_start',   'Checkout Start Rate',     4.6,  0.4, 'percent', sp.map(()=>4.6)),
    purchaseConversion:metric('conv',       'Purchase Conversion',     3.4,  0.6, 'percent', sp.map(()=>3.4)),
    avgSessionDuration:metric('session_dur','Avg Session Duration',    2.8,  0.3, 'number',  sp.map(()=>2.8)),
    returningVisitors: metric('ret_vis',    'Returning Visitors',     38,    4,   'percent', sp.map(()=>38)),
    mobileTrafficPct:  metric('mobile',     'Mobile Traffic',         74,    2,   'percent', sp.map(()=>74)),
    funnel: [
      { label:'Store Visit',         count:18400, conversionPct:100,  dropOffPct:0    },
      { label:'Product View',        count: 9200, conversionPct: 50,  dropOffPct:50   },
      { label:'Added to Cart',       count: 2300, conversionPct: 25,  dropOffPct:75   },
      { label:'Checkout Started',    count:  840, conversionPct:36.5, dropOffPct:63.5 },
      { label:'Purchase Completed',  count:  627, conversionPct:74.6, dropOffPct:25.4 },
    ],
    sections: [
      { sectionKey:'hero',         label:'Hero Section',         views:18400, clicks:3680, ctr:20.0, purchasesInfluenced:124 },
      { sectionKey:'product_grid', label:'Product Grid',         views:14200, clicks:5680, ctr:40.0, purchasesInfluenced:312 },
      { sectionKey:'featured',     label:'Featured Collection',  views:11800, clicks:2832, ctr:24.0, purchasesInfluenced:148 },
      { sectionKey:'content',      label:'Content Section',      views: 8400, clicks:1680, ctr:20.0, purchasesInfluenced: 84 },
      { sectionKey:'email_signup', label:'Email Signup',         views:16200, clicks: 486, ctr: 3.0, purchasesInfluenced:  0 },
    ],
    visitorsChart: points(sp),
  };
}

// ── Marketing ─────────────────────────────────────────────────────────────────

export async function getMarketingAnalytics(_filter?: AnalyticsFilterState): Promise<MarketingAnalytics> {
  await delay(360);
  const sp = [480,540,420,680,740,600,820,720,640,880,520,700,760,740,620,660,700,800,660,740,800,580,720,880,680,640,700,840,780,960];
  return {
    marketingRevenue:       metric('mktg_rev',    'Marketing Revenue',      18600, 3100, 'currency', sp),
    emailRevenue:           metric('email_rev',   'Email Revenue',           8400, 1400, 'currency', sp.map(v=>Math.round(v*0.45))),
    smsRevenue:             metric('sms_rev',     'SMS Revenue',             2800,  480, 'currency', sp.map(v=>Math.round(v*0.15))),
    discountRevenue:        metric('disc_rev',    'Discount Revenue',        3800,  420, 'currency', sp.map(v=>Math.round(v*0.20))),
    automationRevenue:      metric('auto_rev',    'Automation Revenue',      1840,  280, 'currency', sp.map(v=>Math.round(v*0.10))),
    influencerRevenue:      metric('inf_rev',     'Influencer Revenue',      1200,  200, 'currency', sp.map(v=>Math.round(v*0.065))),
    referralRevenue:        metric('ref_rev',     'Referral Revenue',         560,   80, 'currency', sp.map(v=>Math.round(v*0.03))),
    abandonedCheckoutRecovered: metric('abandon', 'Recovered Carts',         1840,  320, 'currency', sp.map(v=>Math.round(v*0.10))),
    campaigns: [
      { campaignId:'c1', name:'July Launch Email', type:'email', recipients:4800, delivered:4704, opens:1880, clicks:562, orders:84, revenue:8400, conversionRate:1.75, unsubscribes:14, revenuePerRecipient:1.75, sentAt:'2026-07-01T09:00:00Z' },
      { campaignId:'c2', name:'Restock SMS Alert', type:'sms',   recipients:1200, delivered:1188, opens:1188, clicks:354, orders:28, revenue:2800, conversionRate:2.33, unsubscribes: 2, revenuePerRecipient:2.33, sentAt:'2026-07-08T10:00:00Z' },
      { campaignId:'c3', name:'VIP Early Access',  type:'email', recipients:280,  delivered:278,  opens: 184, clicks: 98, orders:18, revenue:1800, conversionRate:6.43, unsubscribes: 1, revenuePerRecipient:6.43, sentAt:'2026-07-12T08:00:00Z' },
    ],
    influencers: [
      { influencerId:'i1', name:'@vault.studio',   views:48200, clicks:2840, orders:42, revenue:4200, commission:420,  returnOnCost:10.0, discountUsage:284 },
      { influencerId:'i2', name:'@streetwear.pdx', views:32100, clicks:1480, orders:18, revenue:1800, commission:180,  returnOnCost:10.0, discountUsage:148 },
    ],
    referral: {
      shares:848, clicks:2120, referredCustomers:284, orders:212, revenue:2840,
      rewardsIssued:284,
      topAdvocates:[
        { name:'Marcus T.',  referrals:14, revenue:1400 },
        { name:'Aria S.',    referrals:12, revenue:1200 },
        { name:'Jordan R.',  referrals: 8, revenue: 800 },
      ],
    },
  };
}

// ── Inventory ─────────────────────────────────────────────────────────────────

export async function getInventoryAnalytics(_filter?: AnalyticsFilterState): Promise<InventoryAnalytics> {
  await delay(330);
  const sp = [100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100];
  const PRODS = [
    { productId:'p1', name:'Classic Thread Tee',   unitsOnHand:840, daysOfStockLeft:62, sellThroughRate:68, status:'healthy'  as const },
    { productId:'p3', name:'Oversized Hoodie',     unitsOnHand: 48, daysOfStockLeft: 6, sellThroughRate:84, status:'low'      as const },
    { productId:'p7', name:'Essential Crewneck',   unitsOnHand: 36, daysOfStockLeft: 8, sellThroughRate:78, status:'low'      as const },
    { productId:'p6', name:'Cargo Shorts',         unitsOnHand:  0, daysOfStockLeft: 0, sellThroughRate:100,status:'out'      as const },
    { productId:'p4', name:'Wide-Leg Trousers',    unitsOnHand:480, daysOfStockLeft:84, sellThroughRate:42, status:'healthy'  as const },
    { productId:'p5', name:'Logo Cap',             unitsOnHand:360, daysOfStockLeft:48, sellThroughRate:52, status:'healthy'  as const },
    { productId:'p2', name:'Drop-Shoulder Blazer', unitsOnHand:240, daysOfStockLeft:148,sellThroughRate:28, status:'overstock' as const },
  ];
  return {
    inventoryValue:    metric('inv_value',  'Inventory Value',     124800, 8400, 'currency', sp),
    unitsOnHand:       metric('on_hand',    'Units on Hand',         2004,  -84, 'number',   sp),
    unitsAvailable:    metric('available',  'Units Available',       1840, -120, 'number',   sp),
    unitsReserved:     metric('reserved',   'Units Reserved',          164,  36, 'number',   sp),
    unitsIncoming:     metric('incoming',   'Units Incoming',          840,   0, 'number',   sp),
    lowStockCount:     metric('low_stock',  'Low Stock Products',        2,   1, 'number',   sp),
    outOfStockCount:   metric('out_stock',  'Out of Stock',              1,   1, 'number',   sp),
    deadStockEstimate: metric('dead_stock', 'Dead Stock Est.',        8400,   0, 'currency', sp),
    sellThroughRate:   metric('sell_through','Sell-Through Rate',      62,   4, 'percent',  sp),
    inventoryTurnover: metric('turnover',   'Inventory Turnover',      4.2, 0.4, 'number',  sp),
    avgDaysOfStock:    metric('avg_days',   'Avg Days of Stock',        58,  -6, 'days',    sp),
    fastestSelling: PRODS.filter(p => p.sellThroughRate >= 68),
    slowestSelling:  PRODS.filter(p => p.sellThroughRate <= 42),
    mostOverstocked: PRODS.filter(p => p.status === 'overstock'),
    likelyRunOut:    PRODS.filter(p => p.daysOfStockLeft > 0 && p.daysOfStockLeft <= 10),
  };
}

// ── Production ────────────────────────────────────────────────────────────────

export async function getProductionAnalytics(_filter?: AnalyticsFilterState): Promise<ProductionAnalytics> {
  await delay(360);
  const sp = [100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100];
  return {
    activeJobs:              metric('active_jobs',  'Active Jobs',          8,  1, 'number', sp),
    unitsInProduction:       metric('in_prod',      'Units in Production', 2400, 400, 'number', sp),
    productionValue:         metric('prod_value',   'Production Value',   48000, 8000, 'currency', sp),
    avgLeadTimeDays:         metric('lead_time',    'Avg Lead Time',        28,  -2, 'days', sp),
    avgSampleTimeDays:       metric('sample_time',  'Avg Sample Time',      14,  -1, 'days', sp),
    onTimeCompletionRate:    metric('on_time',      'On-Time Rate',         84,   4, 'percent', sp),
    delayedJobs:             metric('delayed',      'Delayed Jobs',          1,  -1, 'number', sp),
    qcFailureRate:           metric('qc_fail',      'QC Failure Rate',       2.4,-0.4,'percent', sp),
    avgManufacturerResponse: metric('mfr_response', 'Avg Response Time',    18,  -2, 'hours' as never, sp),
    avgUnitCost:             metric('unit_cost',    'Avg Unit Cost',         18,  -1, 'currency', sp),
    manufacturers: [
      { manufacturerId:'m1', name:'VaultMFG Shanghai',  productsProduced:4, totalUnits:1400, totalSpend:25200, avgUnitCost:18, avgLeadTimeDays:26, delayRate:8,  qualityIssueRate:1.8, sampleApprovalRate:92 },
      { manufacturerId:'m2', name:'ThreadCraft LA',     productsProduced:3, totalUnits:1000, totalSpend:22800, avgUnitCost:22.8,avgLeadTimeDays:32, delayRate:14, qualityIssueRate:3.2, sampleApprovalRate:86 },
    ],
  };
}

// ── Profit ────────────────────────────────────────────────────────────────────

export async function getProfitAnalytics(_filter?: AnalyticsFilterState): Promise<ProfitAnalytics> {
  await delay(350);
  const sp = [186,204,168,252,276,228,300,264,240,312,204,264,288,276,228,240,252,288,240,264,288,216,264,312,252,240,264,312,288,336];
  return {
    grossRevenue:      metric('gross_rev',   'Gross Revenue',     94200, 12800, 'currency', sp.map(v=>v*10)),
    netRevenue:        metric('net_rev',     'Net Revenue',       81600, 10400, 'currency', sp.map(v=>Math.round(v*8.64))),
    productCost:       metric('prod_cost',   'Product Cost',      32640,  4100, 'currency', sp.map(v=>Math.round(v*3.46))),
    manufacturerCost:  metric('mfr_cost',    'Manufacturer Cost', 16800,  2400, 'currency', sp.map(v=>Math.round(v*1.78))),
    packagingCost:     metric('pkg_cost',    'Packaging Cost',     2400,   280, 'currency', sp.map(v=>Math.round(v*0.254))),
    shippingCost:      metric('ship_cost',   'Shipping Cost',      4800,   600, 'currency', sp.map(v=>Math.round(v*0.509))),
    platformFees:      metric('plat_fees',   'Platform Fees',      5040,   640, 'currency', sp.map(v=>Math.round(v*0.535))),
    paymentFees:       metric('pay_fees',    'Payment Fees',       2740,   340, 'currency', sp.map(v=>Math.round(v*0.291))),
    refunds:           metric('refunds',      'Refunds',             840,  -180, 'currency', sp.map(v=>Math.round(v*0.089))),
    marketingCost:     metric('mktg_cost',   'Marketing Cost',     2400,   180, 'currency', sp.map(v=>Math.round(v*0.254))),
    influencerCost:    metric('inf_cost',    'Influencer Cost',     600,   100, 'currency', sp.map(v=>Math.round(v*0.064))),
    estimatedProfit:   metric('profit',      'Est. Profit',       28560,  4200, 'currency', sp.map(v=>Math.round(v*3.03))),
    profitMargin:      metric('margin',      'Profit Margin',       30.3,   1.8, 'percent', sp.map(()=>30.3)),
    lineItems: [
      { label:'Gross Revenue',     amount: 94200, isEstimate:false, isDeduction:false },
      { label:'Cost of Goods',     amount:-32640, isEstimate:false, isDeduction:true  },
      { label:'Manufacturer Cost', amount:-16800, isEstimate:true,  isDeduction:true  },
      { label:'Packaging',         amount: -2400, isEstimate:true,  isDeduction:true  },
      { label:'Shipping',          amount: -4800, isEstimate:false, isDeduction:true  },
      { label:'Platform Fees',     amount: -5040, isEstimate:true,  isDeduction:true  },
      { label:'Payment Fees',      amount: -2740, isEstimate:true,  isDeduction:true  },
      { label:'Refunds',           amount:  -840, isEstimate:false, isDeduction:true  },
      { label:'Marketing',         amount: -2400, isEstimate:false, isDeduction:true  },
      { label:'Influencers',       amount:  -600, isEstimate:true,  isDeduction:true  },
      { label:'Est. Profit',       amount: 28560, isEstimate:true,  isDeduction:false },
    ],
    profitChart: points(sp.map(v=>Math.round(v*3.03))),
    marginChart:  points(sp.map(()=>30.3)),
  };
}

// ── Payout ────────────────────────────────────────────────────────────────────

export async function getPayoutAnalytics(): Promise<PayoutAnalytics> {
  await delay(300);
  const sp = [100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100];
  return {
    availableBalance:       metric('avail',    'Available Balance',   6840,    0, 'currency', sp),
    pendingBalance:         metric('pending',  'Pending Balance',     2280,    0, 'currency', sp),
    heldFunds:              metric('held',     'Held Funds',            0,     0, 'currency', sp),
    nextPayoutAmount:       metric('next_pay', 'Next Payout',         6840,    0, 'currency', sp),
    nextPayoutDate:         '2026-07-18',
    totalPaidOut:           metric('total_out','Total Paid Out',     184200,   0, 'currency', sp),
    manufacturerAllocation: metric('mfr_alloc','Manufacturer Alloc',  16800,   0, 'currency', sp),
    shippingAllocation:     metric('ship_alloc','Shipping Alloc',      4800,   0, 'currency', sp),
    disputeHolds:           metric('disputes', 'Dispute Holds',          0,    0, 'currency', sp),
    refundImpact:           metric('ref_impact','Refund Impact',        840,   0, 'currency', sp),
  };
}

// ── Attribution ───────────────────────────────────────────────────────────────

export async function getAttribution(): Promise<AttributionRecord[]> {
  await delay(280);
  return [
    { source:'seller_post', label:'Seller Posts',   primaryOrders:124, primaryRevenue:12400, assistedOrders:48, assistedRevenue:4800, window:'7d' },
    { source:'campaign',    label:'Campaigns',      primaryOrders: 84, primaryRevenue: 8400, assistedOrders:36, assistedRevenue:3600, window:'7d' },
    { source:'discount',    label:'Discounts',      primaryOrders: 68, primaryRevenue: 6800, assistedOrders:24, assistedRevenue:2400, window:'7d' },
    { source:'influencer',  label:'Influencers',    primaryOrders: 42, primaryRevenue: 4200, assistedOrders:18, assistedRevenue:1800, window:'7d' },
    { source:'referral',    label:'Referrals',      primaryOrders: 28, primaryRevenue: 2800, assistedOrders:12, assistedRevenue:1200, window:'7d' },
    { source:'direct',      label:'Direct',         primaryOrders:281, primaryRevenue:28100, assistedOrders: 0, assistedRevenue:   0, window:'7d' },
  ];
}

// ── Insights ──────────────────────────────────────────────────────────────────

const SEED_INSIGHTS: AnalyticsInsight[] = [
  { id:'i1', type:'warning',     title:'Low hoodie stock', what:'Oversized Hoodie has 6 days of stock remaining.', why:'Running out during a peak period will cost you sales.', action:'Reorder stock or pause the product listing.', route:'/inventory', dismissed:false, completed:false, createdAt:'2026-07-14T08:00:00Z' },
  { id:'i2', type:'opportunity', title:'15-second videos outperform', what:'Your 15-second videos average 74% completion vs 52% for 30-second videos.', why:'Higher completion means more algorithm distribution.', action:'Create more 15-second product reveal videos.', route:'/content', dismissed:false, completed:false, createdAt:'2026-07-13T08:00:00Z' },
  { id:'i3', type:'opportunity', title:'Hero section needs better CTAs', what:'Your Store hero has 20% CTR but the product grid drives 2× more purchases.', why:'The hero is the first thing visitors see — low click-through wastes visibility.', action:'Update the hero button to link directly to your best-selling collection.', route:'/store-builder', dismissed:false, completed:false, createdAt:'2026-07-12T08:00:00Z' },
  { id:'i4', type:'info',        title:'Returning customers spend more', what:'Returning customers average $186 per order vs $102 for first-time buyers.', why:'Loyalty drives higher LTV without additional acquisition cost.', action:'Set up a loyalty email sequence for customers after their first purchase.', route:'/(tabs)/marketing', dismissed:false, completed:false, createdAt:'2026-07-11T08:00:00Z' },
  { id:'i5', type:'action_needed', title:'Cargo Shorts out of stock', what:'Cargo Shorts ran out of stock 3 days ago.', why:'Out-of-stock products lose search placement and buyer confidence.', action:'Start a production order or restock from inventory.', route:'/manufacturer-hub', dismissed:false, completed:false, createdAt:'2026-07-11T08:00:00Z' },
];

export async function getInsights(): Promise<AnalyticsInsight[]> {
  try {
    const raw = await AsyncStorage.getItem(INSIGHTS_KEY);
    if (raw) return JSON.parse(raw) as AnalyticsInsight[];
  } catch { /* non-fatal */ }
  await AsyncStorage.setItem(INSIGHTS_KEY, JSON.stringify(SEED_INSIGHTS));
  return SEED_INSIGHTS;
}

export async function dismissInsight(id: string): Promise<void> {
  const insights = await getInsights();
  const updated  = insights.map(i => i.id === id ? { ...i, dismissed: true } : i);
  await AsyncStorage.setItem(INSIGHTS_KEY, JSON.stringify(updated));
}

export async function completeInsight(id: string): Promise<void> {
  const insights = await getInsights();
  const updated  = insights.map(i => i.id === id ? { ...i, completed: true, dismissed: true } : i);
  await AsyncStorage.setItem(INSIGHTS_KEY, JSON.stringify(updated));
}

// ── Export ────────────────────────────────────────────────────────────────────

export async function exportAnalytics(section: ExportSection, dateRange: AnalyticsFilterState['dateRange']): Promise<AnalyticsExport> {
  await delay(800);
  return {
    section,
    format: 'csv',
    dateRange,
    generatedAt: new Date().toISOString(),
    url: `mock://analytics-export/${section}-${Date.now()}.csv`,
  };
}

// ── Utility ───────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
