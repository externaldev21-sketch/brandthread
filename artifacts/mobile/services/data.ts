// ─── Brandthread Demo Data Layer ──────────────────────────────────────────────
// Realistic demo data for every seller screen.
// Keep this file separate from UI — swap these functions with real API calls later.

import type {
  Product, Order,
  InventoryItem, Customer, ContentPost, DesignProject, Payout,
  AnalyticsPoint, SubscriptionPlan,
} from './types';

// ─── Products ────────────────────────────────────────────────────────────────

export const DEMO_PRODUCTS: Product[] = [
  {
    id: 'p1', name: 'Vintage Washed Tee', description: 'Premium 280gsm ringspun cotton tee with acid wash finish.',
    category: 'Tops', productType: 'T-Shirt', vendor: 'Ace Apparel Co.', status: 'active', salesModel: 'pre-made',
    priceCents: 5999, compareAtPriceCents: 7999, costCents: 1450,
    variants: [
      { id: 'v1a', size: 'S',  color: 'Washed Black', sku: 'VWT-BLK-S',  inventory: 42, priceCents: 5999 },
      { id: 'v1b', size: 'M',  color: 'Washed Black', sku: 'VWT-BLK-M',  inventory: 3,  priceCents: 5999 },
      { id: 'v1c', size: 'L',  color: 'Washed Black', sku: 'VWT-BLK-L',  inventory: 67, priceCents: 5999 },
      { id: 'v1d', size: 'XL', color: 'Washed Black', sku: 'VWT-BLK-XL', inventory: 28, priceCents: 5999 },
      { id: 'v1e', size: 'M',  color: 'Washed Slate', sku: 'VWT-SLT-M',  inventory: 0,  priceCents: 5999 },
      { id: 'v1f', size: 'L',  color: 'Washed Slate', sku: 'VWT-SLT-L',  inventory: 19, priceCents: 5999 },
    ],
    totalInventory: 159, lowStockThreshold: 10, totalSales: 1827, revenueCents: 10961373, tags: ['tee', 'vintage', 'bestseller'],
    collections: ['Summer 2026', 'Core Collection'], weight: 0.3, createdAt: '2026-01-15', updatedAt: '2026-07-10',
  },
  {
    id: 'p2', name: 'Oversized Hoodie', description: 'Ultra-soft 400gsm French terry hoodie. Boxy oversized fit.',
    category: 'Tops', productType: 'Hoodie', vendor: 'Stitch Labs', status: 'active', salesModel: 'pre-made',
    priceCents: 8999, costCents: 2200,
    variants: [
      { id: 'v2a', size: 'S',  color: 'Midnight', sku: 'OSH-MID-S', inventory: 24, priceCents: 8999 },
      { id: 'v2b', size: 'M',  color: 'Midnight', sku: 'OSH-MID-M', inventory: 5,  priceCents: 8999 },
      { id: 'v2c', size: 'L',  color: 'Midnight', sku: 'OSH-MID-L', inventory: 38, priceCents: 8999 },
      { id: 'v2d', size: 'M',  color: 'Sage',     sku: 'OSH-SAG-M', inventory: 11, priceCents: 8999 },
    ],
    totalInventory: 78, lowStockThreshold: 10, totalSales: 1241, revenueCents: 11167759, tags: ['hoodie', 'oversized', 'core'],
    collections: ['Core Collection'], weight: 0.6, createdAt: '2026-01-20', updatedAt: '2026-07-08',
  },
  {
    id: 'p3', name: 'Archive Tee Vol.3', description: 'Limited archive series graphic tee. 220gsm ringspun.',
    category: 'Tops', productType: 'T-Shirt', vendor: 'Ace Apparel Co.', status: 'pre-order', salesModel: 'pre-order',
    priceCents: 6999, costCents: 1600,
    variants: [
      { id: 'v3a', size: 'S',  color: 'White', sku: 'ATV3-WHT-S', inventory: 0, priceCents: 6999 },
      { id: 'v3b', size: 'M',  color: 'White', sku: 'ATV3-WHT-M', inventory: 0, priceCents: 6999 },
      { id: 'v3c', size: 'L',  color: 'White', sku: 'ATV3-WHT-L', inventory: 0, priceCents: 6999 },
    ],
    totalInventory: 0, lowStockThreshold: 20, totalSales: 0, revenueCents: 0, tags: ['archive', 'limited', 'graphic'],
    collections: ['Archive Series'], weight: 0.28,
    preOrderOpenDate: '2026-07-01', preOrderCloseDate: '2026-07-31', preOrderMOQ: 50, expectedShipDate: '2026-09-01',
    createdAt: '2026-06-20', updatedAt: '2026-07-12',
  },
  {
    id: 'p4', name: 'Cargo Sweatpants', description: '320gsm French terry cargo pants with side zip pockets.',
    category: 'Bottoms', productType: 'Sweatpants', vendor: 'Elite Garments', status: 'active', salesModel: 'pre-made',
    priceCents: 7999, costCents: 1950,
    variants: [
      { id: 'v4a', size: 'S',  color: 'Charcoal', sku: 'CSP-CHR-S', inventory: 33, priceCents: 7999 },
      { id: 'v4b', size: 'M',  color: 'Charcoal', sku: 'CSP-CHR-M', inventory: 7,  priceCents: 7999 },
      { id: 'v4c', size: 'L',  color: 'Charcoal', sku: 'CSP-CHR-L', inventory: 44, priceCents: 7999 },
    ],
    totalInventory: 84, lowStockThreshold: 10, totalSales: 721, revenueCents: 5767279, tags: ['cargo', 'sweatpants', 'bottoms'],
    collections: ['Core Collection'], weight: 0.55, createdAt: '2026-02-01', updatedAt: '2026-07-05',
  },
  {
    id: 'p5', name: 'Canvas Cargo Jacket', description: 'Heavy-duty 14oz canvas with brass hardware. Water resistant.',
    category: 'Outerwear', productType: 'Jacket', vendor: 'Apex Garment Co.', status: 'active', salesModel: 'pre-made',
    priceCents: 14999, compareAtPriceCents: 19999, costCents: 3800,
    variants: [
      { id: 'v5a', size: 'S',  color: 'Olive',  sku: 'CCJ-OLV-S', inventory: 12, priceCents: 14999 },
      { id: 'v5b', size: 'M',  color: 'Olive',  sku: 'CCJ-OLV-M', inventory: 8,  priceCents: 14999 },
      { id: 'v5c', size: 'L',  color: 'Olive',  sku: 'CCJ-OLV-L', inventory: 3,  priceCents: 14999 },
      { id: 'v5d', size: 'M',  color: 'Black',  sku: 'CCJ-BLK-M', inventory: 18, priceCents: 14999 },
    ],
    totalInventory: 41, lowStockThreshold: 5, totalSales: 478, revenueCents: 7169522, tags: ['jacket', 'canvas', 'outerwear'],
    collections: ['Fall Drop'], weight: 1.2, createdAt: '2026-04-10', updatedAt: '2026-07-11',
  },
  {
    id: 'p6', name: 'Heavyweight Crewneck', description: '450gsm brushed fleece crewneck. Relaxed heavyweight fit.',
    category: 'Tops', productType: 'Crewneck', vendor: 'Stitch Labs', status: 'draft', salesModel: 'pre-made',
    priceCents: 9999, costCents: 2600,
    variants: [
      { id: 'v6a', size: 'M', color: 'Sage',   sku: 'HCN-SAG-M', inventory: 0, priceCents: 9999 },
      { id: 'v6b', size: 'L', color: 'Cream',  sku: 'HCN-CRM-L', inventory: 0, priceCents: 9999 },
    ],
    totalInventory: 0, lowStockThreshold: 20, totalSales: 0, revenueCents: 0, tags: ['crewneck', 'heavyweight'],
    collections: ['Fall Drop'], weight: 0.65, createdAt: '2026-07-01', updatedAt: '2026-07-12',
  },
];

// ─── Orders ──────────────────────────────────────────────────────────────────

const defaultAddress: import('./types').Address = {
  name: '', line1: '—', city: '—', state: '—', zip: '—', country: 'US',
};

export const DEMO_ORDERS: Order[] = [
  {
    id: 'o1', orderNumber: '#BT-78291',
    customer: { id: 'c1', name: 'Jonah Barnes', email: 'jonah.b@gmail.com', initials: 'JB', totalOrders: 4 },
    items: [
      { productId: 'p2', productName: 'Oversized Hoodie',   variant: 'Midnight — L', quantity: 1, priceCents: 8999, totalCents: 8999 },
      { productId: 'p1', productName: 'Vintage Washed Tee', variant: 'Washed Black — M', quantity: 1, priceCents: 5999, totalCents: 5999 },
    ],
    status: 'shipped', paymentStatus: 'paid', fulfillmentStatus: 'fulfilled',
    subtotalCents: 14998, discountCents: 2000, shippingCents: 999, taxCents: 1248, totalCents: 15245,
    shippingAddress: { name: 'Jonah Barnes', line1: '142 Oak Ave', city: 'Los Angeles', state: 'CA', zip: '90001', country: 'US' },
    billingAddress: { name: 'Jonah Barnes', line1: '142 Oak Ave', city: 'Los Angeles', state: 'CA', zip: '90001', country: 'US' },
    deliveryMethod: 'Standard Shipping', trackingNumber: '1Z999AA10123456784', carrier: 'UPS',
    estimatedDelivery: 'Jul 16, 2026',
    timeline: [
      { date: 'Jul 12, 10:42 AM', event: 'Order placed', type: 'info' },
      { date: 'Jul 12, 11:30 AM', event: 'Payment confirmed', type: 'success' },
      { date: 'Jul 13, 2:15 PM',  event: 'Label created', type: 'info' },
      { date: 'Jul 14, 9:00 AM',  event: 'Package shipped via UPS', type: 'success' },
    ],
    date: 'Jul 12, 2026', isPreOrder: false, isHighRisk: false,
  },
  {
    id: 'o2', orderNumber: '#BT-78290',
    customer: { id: 'c2', name: 'Lucas Martinez', email: 'lucas.m@icloud.com', initials: 'LM', totalOrders: 2 },
    items: [
      { productId: 'p3', productName: 'Archive Tee Vol.3', variant: 'White — M', quantity: 1, priceCents: 6999, totalCents: 6999 },
    ],
    status: 'processing', paymentStatus: 'paid', fulfillmentStatus: 'unfulfilled',
    subtotalCents: 6999, discountCents: 0, shippingCents: 999, taxCents: 630, totalCents: 8628,
    shippingAddress: { name: 'Lucas Martinez', line1: '87 Maple Dr', city: 'New York', state: 'NY', zip: '10001', country: 'US' },
    billingAddress: { name: 'Lucas Martinez', line1: '87 Maple Dr', city: 'New York', state: 'NY', zip: '10001', country: 'US' },
    deliveryMethod: 'Pre-order — Est. Jul 22',
    timeline: [
      { date: 'Jul 11, 3:20 PM', event: 'Pre-order placed', type: 'info' },
      { date: 'Jul 11, 3:21 PM', event: 'Payment confirmed — funds held', type: 'success' },
    ],
    date: 'Jul 11, 2026', isPreOrder: true, isHighRisk: false,
  },
  {
    id: 'o3', orderNumber: '#BT-78289',
    customer: { id: 'c3', name: 'David Kim', email: 'd.kim@proton.me', initials: 'DK', totalOrders: 7 },
    items: [
      { productId: 'p5', productName: 'Canvas Cargo Jacket',  variant: 'Olive — S',  quantity: 1, priceCents: 14999, totalCents: 14999 },
      { productId: 'p6', productName: 'Heavyweight Crewneck', variant: 'Sage — M',   quantity: 1, priceCents: 9999,  totalCents: 9999  },
    ],
    status: 'new', paymentStatus: 'paid', fulfillmentStatus: 'unfulfilled',
    subtotalCents: 24998, discountCents: 0, shippingCents: 0, taxCents: 2250, totalCents: 27248,
    shippingAddress: { name: 'David Kim', line1: '22 Pine St', city: 'Chicago', state: 'IL', zip: '60601', country: 'US' },
    billingAddress: { name: 'David Kim', line1: '22 Pine St', city: 'Chicago', state: 'IL', zip: '60601', country: 'US' },
    deliveryMethod: 'Free Standard Shipping',
    timeline: [
      { date: 'Jul 11, 8:55 AM', event: 'Order placed', type: 'info' },
      { date: 'Jul 11, 8:56 AM', event: 'Payment confirmed', type: 'success' },
    ],
    date: 'Jul 11, 2026', isPreOrder: false, isHighRisk: false,
  },
  {
    id: 'o4', orderNumber: '#BT-78288',
    customer: { id: 'c4', name: 'Anthony Lee', email: 'a.lee@outlook.com', initials: 'AL', totalOrders: 1 },
    items: [
      { productId: 'p4', productName: 'Cargo Sweatpants', variant: 'Charcoal — L', quantity: 1, priceCents: 7999, totalCents: 7999 },
    ],
    status: 'delivered', paymentStatus: 'paid', fulfillmentStatus: 'fulfilled',
    subtotalCents: 7999, discountCents: 0, shippingCents: 999, taxCents: 720, totalCents: 9718,
    shippingAddress: { name: 'Anthony Lee', line1: '305 Elm St', city: 'Miami', state: 'FL', zip: '33101', country: 'US' },
    billingAddress: defaultAddress,
    deliveryMethod: 'Standard Shipping', trackingNumber: '1Z999AA10123456785', carrier: 'UPS',
    timeline: [
      { date: 'Jul 8,  10:00 AM', event: 'Order placed', type: 'info' },
      { date: 'Jul 8,  10:01 AM', event: 'Payment confirmed', type: 'success' },
      { date: 'Jul 9,  9:00 AM',  event: 'Package shipped', type: 'success' },
      { date: 'Jul 10, 2:30 PM',  event: 'Delivered', type: 'success' },
    ],
    date: 'Jul 8, 2026', isPreOrder: false, isHighRisk: false,
  },
  {
    id: 'o5', orderNumber: '#BT-78287',
    customer: { id: 'c5', name: 'Brandon Grant', email: 'brandon.g@gmail.com', initials: 'BG', totalOrders: 3 },
    items: [
      { productId: 'p1', productName: 'Vintage Washed Tee', variant: 'Washed Slate — L', quantity: 2, priceCents: 5999, totalCents: 11998 },
    ],
    status: 'ready_to_ship', paymentStatus: 'paid', fulfillmentStatus: 'unfulfilled',
    subtotalCents: 11998, discountCents: 0, shippingCents: 999, taxCents: 1080, totalCents: 14077,
    shippingAddress: { name: 'Brandon Grant', line1: '14 Harbor Blvd', city: 'Seattle', state: 'WA', zip: '98101', country: 'US' },
    billingAddress: defaultAddress,
    deliveryMethod: 'Standard Shipping',
    timeline: [
      { date: 'Jul 9,  4:00 PM', event: 'Order placed', type: 'info' },
      { date: 'Jul 9,  4:01 PM', event: 'Payment confirmed', type: 'success' },
      { date: 'Jul 12, 11:00 AM', event: 'Ready to ship', type: 'info' },
    ],
    date: 'Jul 9, 2026', isPreOrder: false, isHighRisk: false,
  },
  {
    id: 'o6', orderNumber: '#BT-78285',
    customer: { id: 'c6', name: 'Maria Santos', email: 'm.santos@gmail.com', initials: 'MS', totalOrders: 8 },
    items: [
      { productId: 'p2', productName: 'Oversized Hoodie', variant: 'Midnight — S', quantity: 1, priceCents: 8999, totalCents: 8999 },
    ],
    status: 'refunded', paymentStatus: 'refunded', fulfillmentStatus: 'returned',
    subtotalCents: 8999, discountCents: 0, shippingCents: 999, taxCents: 810, totalCents: 10808,
    shippingAddress: { name: 'Maria Santos', line1: '77 Cedar Lane', city: 'Austin', state: 'TX', zip: '78701', country: 'US' },
    billingAddress: defaultAddress,
    deliveryMethod: 'Standard Shipping',
    timeline: [
      { date: 'Jul 5,  3:00 PM', event: 'Order placed', type: 'info' },
      { date: 'Jul 7,  10:00 AM', event: 'Delivered', type: 'success' },
      { date: 'Jul 10, 9:00 AM',  event: 'Return requested — wrong size', type: 'warning' },
      { date: 'Jul 11, 2:00 PM',  event: 'Refund issued', type: 'info' },
    ],
    date: 'Jul 5, 2026', isPreOrder: false, isHighRisk: false,
  },
];

// ─── Inventory ────────────────────────────────────────────────────────────────

export const DEMO_INVENTORY: InventoryItem[] = [
  { id: 'i1', productId: 'p1', productName: 'Vintage Washed Tee', variant: 'Washed Black — M',  sku: 'VWT-BLK-M',  quantity: 3,  lowStockThreshold: 10, location: 'VS Fulfillment — LA', lastUpdated: 'Jul 12, 2026' },
  { id: 'i2', productId: 'p1', productName: 'Vintage Washed Tee', variant: 'Washed Slate — M',  sku: 'VWT-SLT-M',  quantity: 0,  lowStockThreshold: 10, location: 'VS Fulfillment — LA', lastUpdated: 'Jul 10, 2026' },
  { id: 'i3', productId: 'p2', productName: 'Oversized Hoodie',   variant: 'Midnight — M',      sku: 'OSH-MID-M',  quantity: 5,  lowStockThreshold: 10, location: 'VS Fulfillment — LA', lastUpdated: 'Jul 11, 2026' },
  { id: 'i4', productId: 'p5', productName: 'Canvas Cargo Jacket', variant: 'Olive — L',        sku: 'CCJ-OLV-L',  quantity: 3,  lowStockThreshold: 5,  location: 'VS Overflow — Ontario', lastUpdated: 'Jul 9, 2026' },
  { id: 'i5', productId: 'p4', productName: 'Cargo Sweatpants',   variant: 'Charcoal — M',      sku: 'CSP-CHR-M',  quantity: 7,  lowStockThreshold: 10, location: 'VS Fulfillment — LA', lastUpdated: 'Jul 8, 2026' },
];

// ─── Customers ────────────────────────────────────────────────────────────────

export const DEMO_CUSTOMERS: Customer[] = [
  { id: 'c1', name: 'Jonah Barnes',   email: 'jonah.b@gmail.com',    initials: 'JB', segment: 'vip',         totalOrders: 4,  totalSpent: 542.80,  averageOrderValue: 135.70, lastOrderDate: 'Jul 12', tags: ['VIP'], marketingConsent: true, joinedDate: '2025-11' },
  { id: 'c2', name: 'Lucas Martinez', email: 'lucas.m@icloud.com',   initials: 'LM', segment: 'returning',   totalOrders: 2,  totalSpent: 156.27,  averageOrderValue: 78.14,  lastOrderDate: 'Jul 11', tags: [], marketingConsent: true,  joinedDate: '2026-04' },
  { id: 'c3', name: 'David Kim',      email: 'd.kim@proton.me',      initials: 'DK', segment: 'high_spender',totalOrders: 7,  totalSpent: 1248.65, averageOrderValue: 178.38, lastOrderDate: 'Jul 11', tags: ['VIP', 'Pre-order'], marketingConsent: false, joinedDate: '2025-08' },
  { id: 'c4', name: 'Anthony Lee',    email: 'a.lee@outlook.com',    initials: 'AL', segment: 'new',         totalOrders: 1,  totalSpent: 97.18,   averageOrderValue: 97.18,  lastOrderDate: 'Jul 8',  tags: [], marketingConsent: true,  joinedDate: '2026-07' },
  { id: 'c5', name: 'Brandon Grant',  email: 'brandon.g@gmail.com',  initials: 'BG', segment: 'returning',   totalOrders: 3,  totalSpent: 389.22,  averageOrderValue: 129.74, lastOrderDate: 'Jul 9',  tags: [], marketingConsent: true,  joinedDate: '2026-02' },
  { id: 'c6', name: 'Maria Santos',   email: 'm.santos@gmail.com',   initials: 'MS', segment: 'at_risk',     totalOrders: 8,  totalSpent: 798.40,  averageOrderValue: 99.80,  lastOrderDate: 'Jul 5',  tags: ['Returned'], marketingConsent: false, joinedDate: '2025-06' },
  { id: 'c7', name: 'Zoe Williams',   email: 'zoe.w@yahoo.com',      initials: 'ZW', segment: 'vip',         totalOrders: 12, totalSpent: 1847.20, averageOrderValue: 153.93, lastOrderDate: 'Jul 7',  tags: ['VIP', 'Repeat'], marketingConsent: true, joinedDate: '2025-03' },
];

// ─── Content ─────────────────────────────────────────────────────────────────

export const DEMO_CONTENT: ContentPost[] = [
  { id: 'cn1', type: 'video', status: 'published', caption: 'The Vintage Washed Tee is back — and better than ever. 🖤', hashtags: ['#streetwear', '#fashion', '#clothing'], publishedAt: 'Jul 10', views: 48200, likes: 3841, comments: 217, saves: 892, shares: 341, productTags: ['p1'] },
  { id: 'cn2', type: 'image', status: 'published', caption: 'Oversized Hoodie drop — limited restock. Link in bio.', hashtags: ['#hoodie', '#drop', '#limitededition'], publishedAt: 'Jul 8',  views: 21400, likes: 1728, comments: 94,  saves: 412, shares: 157, productTags: ['p2'] },
  { id: 'cn3', type: 'announcement', status: 'scheduled', caption: 'Archive Tee Vol.3 pre-order opens July 1. Set your reminder. 👀', hashtags: ['#archive', '#preorder'], scheduledFor: 'Jul 15, 9:00 AM', views: 0, likes: 0, comments: 0, saves: 0, shares: 0, productTags: ['p3'] },
  { id: 'cn4', type: 'behind_scenes', status: 'draft', caption: 'Inside the factory — how the Canvas Cargo Jacket gets made.', hashtags: ['#behindthescenes', '#manufacturing'], views: 0, likes: 0, comments: 0, saves: 0, shares: 0, productTags: ['p5'] },
];

// ─── Design projects ──────────────────────────────────────────────────────────

export const DEMO_DESIGN_PROJECTS: DesignProject[] = [
  { id: 'dp1', name: 'Archive Vol.3 Graphic', type: 'design',    lastEdited: 'Jul 12', status: 'complete' },
  { id: 'dp2', name: 'Canvas Jacket Mockup',  type: 'mockup',    lastEdited: 'Jul 11', status: 'complete' },
  { id: 'dp3', name: 'Fall Drop Shoot',        type: 'photoshoot',lastEdited: 'Jul 9',  status: 'in_progress' },
  { id: 'dp4', name: 'Heavyweight Crewneck',   type: 'design',    lastEdited: 'Jul 8',  status: 'in_progress' },
  { id: 'dp5', name: 'Holiday Campaign',       type: 'draft',     lastEdited: 'Jul 6',  status: 'draft' },
];

// ─── Payouts ─────────────────────────────────────────────────────────────────

export const DEMO_PAYOUTS: Payout[] = [
  { id: 'py1', amount: 4281.22, status: 'available', date: 'Jul 14, 2026', description: 'Weekly payout — 28 orders', orderIds: ['o1','o3','o4','o5'] },
  { id: 'py2', amount: 1842.50, status: 'pending',   date: 'Jul 21, 2026', description: 'Upcoming payout — 14 orders', orderIds: ['o2'] },
  { id: 'py3', amount: 3920.00, status: 'paid',      date: 'Jul 7, 2026',  description: 'Weekly payout — 31 orders', orderIds: [] },
  { id: 'py4', amount: 2240.80, status: 'paid',      date: 'Jun 30, 2026', description: 'Weekly payout — 22 orders', orderIds: [] },
];

// ─── Analytics ────────────────────────────────────────────────────────────────

export const DEMO_ANALYTICS: AnalyticsPoint[] = [
  { date: 'Jun 14', revenue: 4200,  orders: 48,  visitors: 3200,  conversion: 1.50 },
  { date: 'Jun 21', revenue: 5800,  orders: 62,  visitors: 4100,  conversion: 1.51 },
  { date: 'Jun 28', revenue: 6400,  orders: 70,  visitors: 4800,  conversion: 1.46 },
  { date: 'Jul 5',  revenue: 8200,  orders: 89,  visitors: 6200,  conversion: 1.44 },
  { date: 'Jul 12', revenue: 11400, orders: 124, visitors: 8100,  conversion: 1.53 },
];

// ─── Subscription plans ───────────────────────────────────────────────────────

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'starter', name: 'Starter', price: 29, interval: 'month', highlight: false,
    features: [
      { name: 'Up to 20 products',          included: true },
      { name: 'Orders & fulfilment',         included: true },
      { name: 'Basic analytics',             included: true },
      { name: 'Manufacturer directory',      included: true },
      { name: 'AI Design Studio',            included: false },
      { name: 'Store builder',               included: false },
      { name: 'Content creation',            included: false },
      { name: 'Team members',                included: false, limit: '1 user' },
    ],
  },
  {
    id: 'pro', name: 'Pro', price: 79, interval: 'month', badge: 'Most Popular', highlight: true,
    features: [
      { name: 'Unlimited products',          included: true },
      { name: 'Orders & fulfilment',         included: true },
      { name: 'Advanced analytics',          included: true },
      { name: 'Manufacturer directory',      included: true },
      { name: 'AI Design Studio',            included: true },
      { name: 'Store builder',               included: true },
      { name: 'Content creation',            included: true },
      { name: 'Team members',                included: true, limit: '5 users' },
    ],
  },
  {
    id: 'scale', name: 'Scale', price: 199, interval: 'month', badge: 'Best Value', highlight: false,
    features: [
      { name: 'Unlimited products',          included: true },
      { name: 'Priority order processing',   included: true },
      { name: 'Full analytics suite',        included: true },
      { name: 'Dedicated manufacturer mgr',  included: true },
      { name: 'AI Design Studio',            included: true },
      { name: 'Custom store builder',        included: true },
      { name: 'Multi-channel content',       included: true },
      { name: 'Team members',                included: true, limit: 'Unlimited' },
    ],
  },
];

// ─── Setup checklist ──────────────────────────────────────────────────────────

export interface SetupTask {
  id:       string;
  label:    string;
  desc:     string;
  icon:     string;
  route:    string;
  done:     boolean;
}

export const SETUP_TASKS: SetupTask[] = [
  { id: 'st1', label: 'Add brand logo',         desc: 'Upload your logo to your profile.',          icon: 'image',       route: '/edit-profile', done: true  },
  { id: 'st2', label: 'Create first product',   desc: 'Add a product to your store.',               icon: 'box',         route: '/add-product',  done: false },
  { id: 'st3', label: 'Connect payouts',        desc: 'Add a bank account to receive payments.',    icon: 'dollar-sign', route: '/payments',     done: false },
  { id: 'st4', label: 'Build storefront',       desc: 'Customise your online store.',               icon: 'layout',      route: '/store-builder', done: false },
  { id: 'st5', label: 'Add manufacturer',       desc: 'Connect with a production partner.',         icon: 'tool',        route: '/manufacturer', done: true  },
  { id: 'st6', label: 'Set shipping',           desc: 'Configure your shipping preferences.',       icon: 'truck',       route: '/shipping',     done: false },
  { id: 'st7', label: 'Publish first post',     desc: 'Share your brand on the Thread.',            icon: 'send',        route: '/content',      done: false },
];

// ─── Today's priorities ───────────────────────────────────────────────────────

export interface Priority {
  id:       string;
  title:    string;
  category: string;
  icon:     string;
  color:    string;
  due:      'overdue' | 'today' | 'upcoming';
  done:     boolean;
  route:    string;
}

export const TODAY_PRIORITIES: Priority[] = [
  { id: 'tp1', title: 'Approve manufacturer quote',   category: 'Manufacturing', icon: 'check-circle', color: '#C7CDD5', due: 'today',    done: false, route: '/manufacturer' },
  { id: 'tp2', title: 'Ship 3 ready orders',          category: 'Orders',        icon: 'package',      color: '#3B82F6', due: 'overdue',  done: false, route: '/orders' },
  { id: 'tp3', title: 'Review sample photos',         category: 'Production',    icon: 'camera',       color: '#06B6D4', due: 'today',    done: false, route: '/manufacturer' },
  { id: 'tp4', title: 'Restock Vintage Washed Tee M', category: 'Inventory',     icon: 'alert-circle', color: '#F97316', due: 'overdue',  done: false, route: '/inventory' },
  { id: 'tp5', title: 'Finish product description',   category: 'Products',      icon: 'edit-2',       color: '#39FF88', due: 'upcoming', done: false, route: '/products' },
];

// ─── Recent activity ──────────────────────────────────────────────────────────

export interface ActivityItem {
  id:      string;
  type:    'order' | 'message' | 'manufacturer' | 'payout' | 'inventory' | 'review' | 'refund';
  title:   string;
  desc:    string;
  time:    string;
  icon:    string;
  color:   string;
  route:   string;
  unread:  boolean;
}

export const RECENT_ACTIVITY: ActivityItem[] = [
  { id: 'a1', type: 'order',        title: 'New order — #BT-78291',        desc: 'Jonah B. — $152.45',          time: '2 min ago',  icon: 'shopping-bag',  color: '#39FF88', route: '/order-detail', unread: true  },
  { id: 'a2', type: 'manufacturer', title: 'Quote received from Stitch Labs', desc: 'Graphic Zip Hoodie — $28/unit (MOQ 150)', time: '1 hr ago',   icon: 'tool',          color: '#C7CDD5', route: '/manufacturer', unread: true  },
  { id: 'a3', type: 'inventory',    title: 'Low stock: Vintage Washed Tee M', desc: '3 units remaining',             time: '3 hrs ago',  icon: 'alert-triangle',color: '#F97316', route: '/inventory',   unread: false },
  { id: 'a4', type: 'payout',       title: 'Payout processed',              desc: '$3,920.00 sent to your bank',  time: 'Yesterday',  icon: 'dollar-sign',   color: '#06B6D4', route: '/payments',    unread: false },
  { id: 'a5', type: 'review',       title: 'New 5-star review',             desc: '"Perfect quality, fast ship"',  time: 'Yesterday',  icon: 'star',          color: '#FBBF24', route: '/customers',   unread: false },
  { id: 'a6', type: 'refund',       title: 'Refund request',                desc: 'Maria S. — Oversized Hoodie',  time: '2 days ago', icon: 'rotate-ccw',    color: '#EF4444', route: '/orders',      unread: false },
];
