// ─── Brandthread Demo Data Layer ──────────────────────────────────────────────
// Realistic demo data for every seller screen.
// Keep this file separate from UI — swap these functions with real API calls later.

import type {
  Product, Order, Manufacturer, ProductionJob, Sample, Quote,
  InventoryItem, Customer, ContentPost, DesignProject, Payout,
  AnalyticsPoint, SubscriptionPlan,
} from './types';

// ─── Products ────────────────────────────────────────────────────────────────

export const DEMO_PRODUCTS: Product[] = [
  {
    id: 'p1', name: 'Vintage Washed Tee', description: 'Premium 280gsm ringspun cotton tee with acid wash finish.',
    category: 'Tops', productType: 'T-Shirt', vendor: 'Ace Apparel Co.', status: 'active', salesModel: 'pre-made',
    price: 59.99, compareAtPrice: 79.99, cost: 14.50,
    variants: [
      { id: 'v1a', size: 'S',  color: 'Washed Black', sku: 'VWT-BLK-S',  inventory: 42, price: 59.99 },
      { id: 'v1b', size: 'M',  color: 'Washed Black', sku: 'VWT-BLK-M',  inventory: 3,  price: 59.99 },
      { id: 'v1c', size: 'L',  color: 'Washed Black', sku: 'VWT-BLK-L',  inventory: 67, price: 59.99 },
      { id: 'v1d', size: 'XL', color: 'Washed Black', sku: 'VWT-BLK-XL', inventory: 28, price: 59.99 },
      { id: 'v1e', size: 'M',  color: 'Washed Slate', sku: 'VWT-SLT-M',  inventory: 0,  price: 59.99 },
      { id: 'v1f', size: 'L',  color: 'Washed Slate', sku: 'VWT-SLT-L',  inventory: 19, price: 59.99 },
    ],
    totalInventory: 159, lowStockThreshold: 10, totalSales: 1827, revenue: 109613.73, tags: ['tee', 'vintage', 'bestseller'],
    collections: ['Summer 2026', 'Core Collection'], weight: 0.3, createdAt: '2026-01-15', updatedAt: '2026-07-10',
  },
  {
    id: 'p2', name: 'Oversized Hoodie', description: 'Ultra-soft 400gsm French terry hoodie. Boxy oversized fit.',
    category: 'Tops', productType: 'Hoodie', vendor: 'Stitch Labs', status: 'active', salesModel: 'pre-made',
    price: 89.99, cost: 22.00,
    variants: [
      { id: 'v2a', size: 'S',  color: 'Midnight', sku: 'OSH-MID-S', inventory: 24, price: 89.99 },
      { id: 'v2b', size: 'M',  color: 'Midnight', sku: 'OSH-MID-M', inventory: 5,  price: 89.99 },
      { id: 'v2c', size: 'L',  color: 'Midnight', sku: 'OSH-MID-L', inventory: 38, price: 89.99 },
      { id: 'v2d', size: 'M',  color: 'Sage',     sku: 'OSH-SAG-M', inventory: 11, price: 89.99 },
    ],
    totalInventory: 78, lowStockThreshold: 10, totalSales: 1241, revenue: 111677.59, tags: ['hoodie', 'oversized', 'core'],
    collections: ['Core Collection'], weight: 0.6, createdAt: '2026-01-20', updatedAt: '2026-07-08',
  },
  {
    id: 'p3', name: 'Archive Tee Vol.3', description: 'Limited archive series graphic tee. 220gsm ringspun.',
    category: 'Tops', productType: 'T-Shirt', vendor: 'Ace Apparel Co.', status: 'pre-order', salesModel: 'pre-order',
    price: 69.99, cost: 16.00,
    variants: [
      { id: 'v3a', size: 'S',  color: 'White', sku: 'ATV3-WHT-S', inventory: 0, price: 69.99 },
      { id: 'v3b', size: 'M',  color: 'White', sku: 'ATV3-WHT-M', inventory: 0, price: 69.99 },
      { id: 'v3c', size: 'L',  color: 'White', sku: 'ATV3-WHT-L', inventory: 0, price: 69.99 },
    ],
    totalInventory: 0, lowStockThreshold: 20, totalSales: 0, revenue: 0, tags: ['archive', 'limited', 'graphic'],
    collections: ['Archive Series'], weight: 0.28,
    preOrderOpenDate: '2026-07-01', preOrderCloseDate: '2026-07-31', preOrderMOQ: 50, expectedShipDate: '2026-09-01',
    createdAt: '2026-06-20', updatedAt: '2026-07-12',
  },
  {
    id: 'p4', name: 'Cargo Sweatpants', description: '320gsm French terry cargo pants with side zip pockets.',
    category: 'Bottoms', productType: 'Sweatpants', vendor: 'Elite Garments', status: 'active', salesModel: 'pre-made',
    price: 79.99, cost: 19.50,
    variants: [
      { id: 'v4a', size: 'S',  color: 'Charcoal', sku: 'CSP-CHR-S', inventory: 33, price: 79.99 },
      { id: 'v4b', size: 'M',  color: 'Charcoal', sku: 'CSP-CHR-M', inventory: 7,  price: 79.99 },
      { id: 'v4c', size: 'L',  color: 'Charcoal', sku: 'CSP-CHR-L', inventory: 44, price: 79.99 },
    ],
    totalInventory: 84, lowStockThreshold: 10, totalSales: 721, revenue: 57672.79, tags: ['cargo', 'sweatpants', 'bottoms'],
    collections: ['Core Collection'], weight: 0.55, createdAt: '2026-02-01', updatedAt: '2026-07-05',
  },
  {
    id: 'p5', name: 'Canvas Cargo Jacket', description: 'Heavy-duty 14oz canvas with brass hardware. Water resistant.',
    category: 'Outerwear', productType: 'Jacket', vendor: 'Apex Garment Co.', status: 'active', salesModel: 'pre-made',
    price: 149.99, compareAtPrice: 199.99, cost: 38.00,
    variants: [
      { id: 'v5a', size: 'S',  color: 'Olive',  sku: 'CCJ-OLV-S', inventory: 12, price: 149.99 },
      { id: 'v5b', size: 'M',  color: 'Olive',  sku: 'CCJ-OLV-M', inventory: 8,  price: 149.99 },
      { id: 'v5c', size: 'L',  color: 'Olive',  sku: 'CCJ-OLV-L', inventory: 3,  price: 149.99 },
      { id: 'v5d', size: 'M',  color: 'Black',  sku: 'CCJ-BLK-M', inventory: 18, price: 149.99 },
    ],
    totalInventory: 41, lowStockThreshold: 5, totalSales: 478, revenue: 71695.22, tags: ['jacket', 'canvas', 'outerwear'],
    collections: ['Fall Drop'], weight: 1.2, createdAt: '2026-04-10', updatedAt: '2026-07-11',
  },
  {
    id: 'p6', name: 'Heavyweight Crewneck', description: '450gsm brushed fleece crewneck. Relaxed heavyweight fit.',
    category: 'Tops', productType: 'Crewneck', vendor: 'Stitch Labs', status: 'draft', salesModel: 'pre-made',
    price: 99.99, cost: 26.00,
    variants: [
      { id: 'v6a', size: 'M', color: 'Sage',   sku: 'HCN-SAG-M', inventory: 0, price: 99.99 },
      { id: 'v6b', size: 'L', color: 'Cream',  sku: 'HCN-CRM-L', inventory: 0, price: 99.99 },
    ],
    totalInventory: 0, lowStockThreshold: 20, totalSales: 0, revenue: 0, tags: ['crewneck', 'heavyweight'],
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
      { productId: 'p2', productName: 'Oversized Hoodie',   variant: 'Midnight — L', quantity: 1, price: 89.99, total: 89.99 },
      { productId: 'p1', productName: 'Vintage Washed Tee', variant: 'Washed Black — M', quantity: 1, price: 59.99, total: 59.99 },
    ],
    status: 'shipped', paymentStatus: 'paid', fulfillmentStatus: 'fulfilled',
    subtotal: 149.98, discount: 20.00, shipping: 9.99, tax: 12.48, total: 152.45,
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
      { productId: 'p3', productName: 'Archive Tee Vol.3', variant: 'White — M', quantity: 1, price: 69.99, total: 69.99 },
    ],
    status: 'processing', paymentStatus: 'paid', fulfillmentStatus: 'unfulfilled',
    subtotal: 69.99, discount: 0, shipping: 9.99, tax: 6.30, total: 86.28,
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
      { productId: 'p5', productName: 'Canvas Cargo Jacket',  variant: 'Olive — S',  quantity: 1, price: 149.99, total: 149.99 },
      { productId: 'p6', productName: 'Heavyweight Crewneck', variant: 'Sage — M',   quantity: 1, price: 99.99,  total: 99.99  },
    ],
    status: 'new', paymentStatus: 'paid', fulfillmentStatus: 'unfulfilled',
    subtotal: 249.98, discount: 0, shipping: 0, tax: 22.50, total: 272.48,
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
      { productId: 'p4', productName: 'Cargo Sweatpants', variant: 'Charcoal — L', quantity: 1, price: 79.99, total: 79.99 },
    ],
    status: 'delivered', paymentStatus: 'paid', fulfillmentStatus: 'fulfilled',
    subtotal: 79.99, discount: 0, shipping: 9.99, tax: 7.20, total: 97.18,
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
      { productId: 'p1', productName: 'Vintage Washed Tee', variant: 'Washed Slate — L', quantity: 2, price: 59.99, total: 119.98 },
    ],
    status: 'ready_to_ship', paymentStatus: 'paid', fulfillmentStatus: 'unfulfilled',
    subtotal: 119.98, discount: 0, shipping: 9.99, tax: 10.80, total: 140.77,
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
      { productId: 'p2', productName: 'Oversized Hoodie', variant: 'Midnight — S', quantity: 1, price: 89.99, total: 89.99 },
    ],
    status: 'refunded', paymentStatus: 'refunded', fulfillmentStatus: 'returned',
    subtotal: 89.99, discount: 0, shipping: 9.99, tax: 8.10, total: 108.08,
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

// ─── Manufacturers ────────────────────────────────────────────────────────────

export const DEMO_MANUFACTURERS: Manufacturer[] = [
  {
    id: 'm1', name: 'Ace Apparel Co.', country: 'Pakistan', city: 'Lahore', initials: 'ACE',
    rating: 4.9, reviewCount: 142, verification: 'verified',
    specialties: ['T-Shirts', 'Polos', 'Tank Tops', 'Activewear'],
    moq: 100, priceRange: '$6.50–$14', leadTime: '18–22 days', responseTime: '< 2 hrs',
    capabilities: ['Screen Print', 'Embroidery', 'DTG', 'Cut & Sew', 'Custom Labels'],
    certifications: ['OEKO-TEX', 'GOTS', 'ISO 9001'],
    description: 'Specialist in premium basics and activewear. Trusted by 200+ clothing brands globally.',
    activeOrders: 12, completedOrders: 847, joined: '2023-06',
  },
  {
    id: 'm2', name: 'Stitch Labs', country: 'Portugal', city: 'Porto', initials: 'SL',
    rating: 4.8, reviewCount: 93, verification: 'verified',
    specialties: ['Hoodies', 'Crewnecks', 'Sweatpants', 'Fleece'],
    moq: 100, priceRange: '$18–$32', leadTime: '15–18 days', responseTime: '< 4 hrs',
    capabilities: ['French Terry', 'Fleece', 'Embroidery', 'Garment Dye', 'Stone Wash'],
    certifications: ['GOTS', 'Fair Wear'],
    description: 'European-standard premium fleece production. Ethical and sustainable manufacturing.',
    activeOrders: 7, completedOrders: 412, joined: '2024-01',
  },
  {
    id: 'm3', name: 'Elite Garments', country: 'Turkey', city: 'Istanbul', initials: 'EG',
    rating: 4.5, reviewCount: 67, verification: 'verified',
    specialties: ['Outerwear', 'Denim', 'Workwear', 'Tailored'],
    moq: 200, priceRange: '$22–$55', leadTime: '20–25 days', responseTime: '< 8 hrs',
    capabilities: ['Denim Construction', 'Canvas Work', 'Woven Labels', 'Metal Hardware'],
    certifications: ['OEKO-TEX', 'ISO 9001'],
    description: 'Premium outerwear and structured garment specialist since 1987.',
    activeOrders: 3, completedOrders: 289, joined: '2024-03',
  },
  {
    id: 'm4', name: 'Apex Garment Co.', country: 'China', city: 'Guangzhou', initials: 'AG',
    rating: 4.9, reviewCount: 218, verification: 'verified',
    specialties: ['Jackets', 'Technical Wear', 'Accessories', 'Bags'],
    moq: 50, priceRange: '$4–$18', leadTime: '14–18 days', responseTime: '< 1 hr',
    capabilities: ['Technical Fabrication', 'YKK Zippers', 'Waterproof Coating', 'Screen Print', 'Embroidery'],
    certifications: ['OEKO-TEX', 'ISO 9001', 'Bluesign'],
    description: 'High-volume technical wear manufacturer with cutting-edge machinery.',
    activeOrders: 22, completedOrders: 1342, joined: '2023-01',
  },
];

// ─── Production jobs ──────────────────────────────────────────────────────────

export const DEMO_PRODUCTION: ProductionJob[] = [
  {
    id: 'pr1', product: 'Oversized Hoodie — Midnight', manufacturer: 'Stitch Labs', manufacturerId: 'm2',
    stage: 'production', quantity: 500, unitCost: 22.00, totalCost: 11000, deposit: 5500, remainingBalance: 5500,
    startDate: 'Jul 1, 2026', estimatedCompletion: 'Jul 22, 2026', progress: 65,
    photos: [], notes: 'Garment dye batch confirmed. Moving to cut stage.',
  },
  {
    id: 'pr2', product: 'Canvas Cargo Jacket — Olive', manufacturer: 'Elite Garments', manufacturerId: 'm3',
    stage: 'quality_check', quantity: 200, unitCost: 38.00, totalCost: 7600, deposit: 3800, remainingBalance: 3800,
    startDate: 'Jun 20, 2026', estimatedCompletion: 'Jul 18, 2026', progress: 88,
    photos: [], notes: 'QC photos requested.',
  },
  {
    id: 'pr3', product: 'Archive Tee Vol.3 — White', manufacturer: 'Ace Apparel Co.', manufacturerId: 'm1',
    stage: 'sample', quantity: 300, unitCost: 16.00, totalCost: 4800, deposit: 2400, remainingBalance: 2400,
    startDate: 'Jul 10, 2026', estimatedCompletion: 'Aug 5, 2026', progress: 12,
    photos: [], notes: 'Sample requested for print placement review.',
  },
];

// ─── Samples ─────────────────────────────────────────────────────────────────

export const DEMO_SAMPLES: Sample[] = [
  {
    id: 's1', product: 'Archive Tee Vol.3', manufacturer: 'Ace Apparel Co.', manufacturerId: 'm1',
    stage: 'shipped', requestedDate: 'Jul 8, 2026', expectedDate: 'Jul 16, 2026', cost: 145,
    notes: 'Please use plastisol ink on chest graphic.',
  },
  {
    id: 's2', product: 'Cargo Sweatpants v2', manufacturer: 'Stitch Labs', manufacturerId: 'm2',
    stage: 'in_development', requestedDate: 'Jul 5, 2026', expectedDate: 'Jul 20, 2026', cost: 220,
    notes: 'Confirm pocket placement before sewing.',
  },
  {
    id: 's3', product: 'Heavyweight Crewneck', manufacturer: 'Stitch Labs', manufacturerId: 'm2',
    stage: 'review_needed', requestedDate: 'Jun 28, 2026', expectedDate: 'Jul 9, 2026',
    receivedDate: 'Jul 10, 2026', cost: 195,
  },
];

// ─── Quotes ──────────────────────────────────────────────────────────────────

export const DEMO_QUOTES: Quote[] = [
  {
    id: 'q1', product: 'Vintage Washed Tee — Restock 500',
    manufacturer: 'Ace Apparel Co.', manufacturerId: 'm1',
    unitPrice: 14.50, sampleCost: 95, toolingCost: 0, shippingEstimate: 420,
    moq: 100, productionTime: '18–22 days', paymentTerms: '50% deposit, 50% on delivery',
    expiresAt: 'Jul 25, 2026', status: 'pending', requestedAt: 'Jul 10, 2026',
  },
  {
    id: 'q2', product: 'Graphic Zip Hoodie — New Style',
    manufacturer: 'Stitch Labs', manufacturerId: 'm2',
    unitPrice: 28.00, sampleCost: 195, toolingCost: 320, shippingEstimate: 580,
    moq: 150, productionTime: '22–26 days', paymentTerms: '40% deposit, 60% on delivery',
    expiresAt: 'Jul 20, 2026', status: 'pending', requestedAt: 'Jul 8, 2026',
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
  { id: 'tp1', title: 'Approve manufacturer quote',   category: 'Manufacturing', icon: 'check-circle', color: '#8B5CF6', due: 'today',    done: false, route: '/manufacturer' },
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
  { id: 'a2', type: 'manufacturer', title: 'Quote received from Stitch Labs', desc: 'Graphic Zip Hoodie — $28/unit (MOQ 150)', time: '1 hr ago',   icon: 'tool',          color: '#8B5CF6', route: '/manufacturer', unread: true  },
  { id: 'a3', type: 'inventory',    title: 'Low stock: Vintage Washed Tee M', desc: '3 units remaining',             time: '3 hrs ago',  icon: 'alert-triangle',color: '#F97316', route: '/inventory',   unread: false },
  { id: 'a4', type: 'payout',       title: 'Payout processed',              desc: '$3,920.00 sent to your bank',  time: 'Yesterday',  icon: 'dollar-sign',   color: '#06B6D4', route: '/payments',    unread: false },
  { id: 'a5', type: 'review',       title: 'New 5-star review',             desc: '"Perfect quality, fast ship"',  time: 'Yesterday',  icon: 'star',          color: '#FBBF24', route: '/customers',   unread: false },
  { id: 'a6', type: 'refund',       title: 'Refund request',                desc: 'Maria S. — Oversized Hoodie',  time: '2 days ago', icon: 'rotate-ccw',    color: '#EF4444', route: '/orders',      unread: false },
];
