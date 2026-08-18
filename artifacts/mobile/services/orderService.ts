/**
 * Brandthread Orders Service — demo layer with AsyncStorage persistence.
 * All writes persist across restarts. Demo data seeds on first load.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { serviceRequest } from '@/lib/serviceConfig';
import {
  Order, OrderLineItem, OrderCustomer, OrderAddress, PaymentSummary,
  HeldFundsRecord, PayoutMilestone, Fulfillment, FulfillmentGroup,
  Shipment, ShippingLabel, TrackingEvent, OrderTimelineEvent, OrderNote,
  Cancellation, ReturnRequest, ReturnItem, ReturnInspection, Refund,
  RefundLineItem, Dispute, DisputeEvidence, RiskFlag, BuyerOrderView,
  OrderStatus, PaymentStatus, FulfillmentStatus, FulfillmentType,
  ReturnStatus, ReturnReason, RefundStatus, RefundType, DisputeStatus, DisputeType,
  TrackingStatus, CancellationReason, OrderFilterKey, OrderSortKey,
  ShippingRate, DEMO_CARRIER_RATES, PAYOUT_MILESTONES,
} from './orderTypes';

// ─── Storage keys ─────────────────────────────────────────────────────────────

const KEYS = {
  orders:  'orders:v1',
  buyer:   'buyer_orders:v1',
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function uid(): string { return Math.random().toString(36).slice(2, 11); }
function now(): string { return new Date().toISOString(); }
function daysFromNow(n: number): string {
  const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString();
}
function daysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString();
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Demo data ────────────────────────────────────────────────────────────────

function makeMilestones(completedKeys: string[]): PayoutMilestone[] {
  return PAYOUT_MILESTONES.map(m => ({
    key: m.key,
    label: m.label,
    isRequired: m.isRequired,
    completedAt: completedKeys.includes(m.key) ? daysAgo(1) : undefined,
  }));
}

function makeAddress(name: string): OrderAddress {
  return { name, line1: '123 Main St', city: 'Los Angeles', state: 'CA', zip: '90001', country: 'US', phone: '+13105550001' };
}

function makeCustomer(id: string, name: string, email: string, orders: number, ltv: number): OrderCustomer {
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  return {
    id, name, email, phone: '+13105550001', initials,
    totalOrders: orders, lifetimeValue: ltv, tags: [],
    shippingAddress: makeAddress(name),
    billingAddress: makeAddress(name),
  };
}

function makePayment(total: number, held = true): PaymentSummary {
  const subtotal = +(total * 0.9).toFixed(2);
  const shipping = +(total * 0.1).toFixed(2);
  const fee = +(total * 0.03).toFixed(2);
  const sellerGet = +(total - fee - (held ? total * 0.2 : 0)).toFixed(2);
  return {
    subtotal, discountTotal: 0, shippingTotal: shipping, taxTotal: 0,
    total, amountPaid: total, amountRefunded: 0,
    amountHeld: held ? +(total * 0.2).toFixed(2) : 0,
    amountPending: held ? sellerGet : 0,
    sellerAllocation: sellerGet, manufacturerAllocation: 0,
    shippingLabelAllocation: shipping, platformFee: fee,
    payoutStatus: held ? 'held' : 'available',
  };
}

function makeHeld(orderId: string, total: number, completedKeys: string[]): HeldFundsRecord {
  const held = +(total * 0.2).toFixed(2);
  return {
    id: 'hf_' + uid(), orderId,
    status: completedKeys.includes('delivered') ? 'partially_released' : 'held',
    totalReceived: total,
    currentlyHeld: held,
    manufacturerReserved: 0,
    shippingReserved: +(total * 0.05).toFixed(2),
    platformFee: +(total * 0.03).toFixed(2),
    sellerPending: +(total * 0.72).toFixed(2),
    sellerReleased: completedKeys.includes('delivered') ? +(total * 0.5).toFixed(2) : 0,
    milestones: makeMilestones(completedKeys),
    expectedReleaseDate: daysFromNow(7),
    createdAt: daysAgo(3), updatedAt: now(),
  };
}

function makeTimeline(events: { type: OrderTimelineEvent['type']; message: string; customerVisible?: boolean }[]): OrderTimelineEvent[] {
  return events.map((e, i) => ({
    id: 'tl_' + uid(),
    type: e.type,
    message: e.message,
    isCustomerVisible: e.customerVisible ?? false,
    isSystemEvent: true,
    isSellerNote: false,
    createdAt: daysAgo(events.length - i),
  }));
}

function makeFulfillment(orderId: string, lineItemIds: string[], type: FulfillmentType, status: FulfillmentStatus): Fulfillment {
  const group: FulfillmentGroup = {
    id: 'fg_' + uid(), orderId, type, status, lineItemIds,
    createdAt: daysAgo(2), updatedAt: now(),
  };
  return {
    id: 'ff_' + uid(), orderId, groups: [group], type, status,
    isPicked: ['ready_to_ship', 'fulfilled'].includes(status),
    isPacked: ['ready_to_ship', 'fulfilled'].includes(status),
    fromAddress: makeAddress('Seller'),
  };
}

const DEMO_ORDERS_DATA: Order[] = [
  // 1. New order, seller fulfilled
  (() => {
    const id = 'ord_001'; const num = '#1042'; const total = 148.00;
    const items: OrderLineItem[] = [
      { id: 'li_001a', productId: 'p1', productName: 'Oversized Hoodie', variant: 'Black / L', sku: 'HOD-BLK-L', quantity: 1, unitPrice: 98, discountAmount: 0, taxAmount: 0, total: 98, fulfillmentSource: 'seller', isPreOrder: false },
      { id: 'li_001b', productId: 'p2', productName: 'Logo Tee', variant: 'White / M', sku: 'TEE-WHT-M', quantity: 2, unitPrice: 25, discountAmount: 0, taxAmount: 0, total: 50, fulfillmentSource: 'seller', isPreOrder: false },
    ];
    return {
      id, orderNumber: num, source: 'Thread', salesChannel: 'Brandthread',
      status: 'new' as OrderStatus, paymentStatus: 'paid' as PaymentStatus,
      fulfillmentStatus: 'unfulfilled' as FulfillmentStatus, fulfillmentType: 'seller' as FulfillmentType,
      riskLevel: 'low' as const, riskFlags: [],
      customer: makeCustomer('cust_001', 'Jordan Kim', 'jordan@example.com', 3, 412),
      lineItems: items,
      fulfillment: makeFulfillment(id, items.map(i => i.id), 'seller', 'unfulfilled'),
      payment: makePayment(total), heldFunds: makeHeld(id, total, ['payment_confirmed']),
      shipments: [], labels: [], returns: [], refunds: [], disputes: [],
      timeline: makeTimeline([
        { type: 'order_created', message: `Order ${num} placed`, customerVisible: true },
        { type: 'payment_confirmed', message: 'Payment of $148.00 confirmed', customerVisible: true },
      ]),
      notes: [], hasUnreadMessage: true, isPreOrder: false, isManufacturerFulfilled: false,
      sellerId: 'u_threadhaus', sellerName: 'Threadhaus', sellerHandle: '@threadhaus',
      currency: 'USD', tags: [], createdAt: daysAgo(1), updatedAt: now(),
    } as Order;
  })(),

  // 2. Processing, ready to ship
  (() => {
    const id = 'ord_002'; const num = '#1041'; const total = 265.00;
    const items: OrderLineItem[] = [
      { id: 'li_002a', productId: 'p1', productName: 'Track Jacket', variant: 'Navy / XL', sku: 'TRK-NVY-XL', quantity: 1, unitPrice: 145, discountAmount: 0, taxAmount: 0, total: 145, fulfillmentSource: 'seller', isPreOrder: false },
      { id: 'li_002b', productId: 'p3', productName: 'Cargo Shorts', variant: 'Olive / 32', sku: 'CRG-OLV-32', quantity: 2, unitPrice: 60, discountAmount: 0, taxAmount: 0, total: 120, fulfillmentSource: 'seller', isPreOrder: false },
    ];
    return {
      id, orderNumber: num, source: 'Discover', salesChannel: 'Brandthread',
      status: 'ready_to_ship' as OrderStatus, paymentStatus: 'paid' as PaymentStatus,
      fulfillmentStatus: 'partially_fulfilled' as FulfillmentStatus, fulfillmentType: 'seller' as FulfillmentType,
      riskLevel: 'low' as const, riskFlags: [],
      customer: makeCustomer('cust_002', 'Alex Rivera', 'alex@example.com', 7, 1240),
      lineItems: items,
      fulfillment: makeFulfillment(id, items.map(i => i.id), 'seller', 'partially_fulfilled'),
      payment: makePayment(total), heldFunds: makeHeld(id, total, ['payment_confirmed', 'manufacturer_deposit']),
      shipments: [], labels: [], returns: [], refunds: [], disputes: [],
      timeline: makeTimeline([
        { type: 'order_created', message: `Order ${num} placed`, customerVisible: true },
        { type: 'payment_confirmed', message: 'Payment of $265.00 confirmed', customerVisible: true },
        { type: 'processing_started', message: 'Order marked processing' },
      ]),
      notes: [], hasUnreadMessage: false, isPreOrder: false, isManufacturerFulfilled: false,
      sellerId: 'u_threadhaus', sellerName: 'Threadhaus', sellerHandle: '@threadhaus',
      currency: 'USD', tags: [], createdAt: daysAgo(2), updatedAt: now(),
    } as Order;
  })(),

  // 3. Shipped with tracking
  (() => {
    const id = 'ord_003'; const num = '#1038'; const total = 89.00;
    const items: OrderLineItem[] = [
      { id: 'li_003a', productId: 'p4', productName: 'Vintage Cap', variant: 'Washed Black / One Size', sku: 'CAP-BLK-OS', quantity: 1, unitPrice: 45, discountAmount: 0, taxAmount: 0, total: 45, fulfillmentSource: 'seller', isPreOrder: false },
      { id: 'li_003b', productId: 'p5', productName: 'Logo Socks 3-Pack', variant: 'White / One Size', sku: 'SOC-WHT-OS', quantity: 1, unitPrice: 44, discountAmount: 0, taxAmount: 0, total: 44, fulfillmentSource: 'seller', isPreOrder: false },
    ];
    const shipment: Shipment = {
      id: 'shp_001', orderId: id, fulfillmentGroupId: 'fg_001',
      carrier: 'USPS', trackingNumber: '9400111899223512345671',
      trackingStatus: 'in_transit',
      trackingEvents: [
        { id: 'te_001', status: 'label_created', description: 'Label created', timestamp: daysAgo(3) },
        { id: 'te_002', status: 'accepted', location: 'Los Angeles, CA', description: 'Package accepted at post office', timestamp: daysAgo(2) },
        { id: 'te_003', status: 'in_transit', location: 'Phoenix, AZ', description: 'In transit to destination', timestamp: daysAgo(1) },
      ],
      shippedAt: daysAgo(2), estimatedDelivery: daysFromNow(1), isDemo: true,
    };
    const label: ShippingLabel = {
      id: 'lbl_001', orderId: id, carrier: 'USPS', service: 'Priority Mail',
      trackingNumber: '9400111899223512345671', price: 12.40,
      status: 'active', isDemo: true, purchasedAt: daysAgo(2),
    };
    return {
      id, orderNumber: num, source: 'Thread', salesChannel: 'Brandthread',
      status: 'shipped' as OrderStatus, paymentStatus: 'paid' as PaymentStatus,
      fulfillmentStatus: 'fulfilled' as FulfillmentStatus, fulfillmentType: 'seller' as FulfillmentType,
      riskLevel: 'low' as const, riskFlags: [],
      customer: makeCustomer('cust_003', 'Sam Chen', 'sam@example.com', 2, 245),
      lineItems: items,
      fulfillment: makeFulfillment(id, items.map(i => i.id), 'seller', 'fulfilled'),
      payment: makePayment(total, false), heldFunds: makeHeld(id, total, ['payment_confirmed', 'product_shipped', 'tracking_verified']),
      shipments: [shipment], labels: [label], returns: [], refunds: [], disputes: [],
      timeline: makeTimeline([
        { type: 'order_created', message: `Order ${num} placed`, customerVisible: true },
        { type: 'payment_confirmed', message: 'Payment confirmed', customerVisible: true },
        { type: 'label_purchased', message: 'USPS Priority Mail label purchased — $12.40' },
        { type: 'shipped', message: `Shipped via USPS · Tracking: 9400111899223512345671`, customerVisible: true },
      ]),
      notes: [], hasUnreadMessage: false, isPreOrder: false, isManufacturerFulfilled: false,
      sellerId: 'u_threadhaus', sellerName: 'Threadhaus', sellerHandle: '@threadhaus',
      currency: 'USD', tags: [], createdAt: daysAgo(4), updatedAt: now(),
    } as Order;
  })(),

  // 4. Pre-order
  (() => {
    const id = 'ord_004'; const num = '#1035'; const total = 320.00;
    const items: OrderLineItem[] = [
      { id: 'li_004a', productId: 'p6', productName: 'Limited Drop Hoodie', variant: 'Forest Green / L', sku: 'LTD-GRN-L', quantity: 2, unitPrice: 160, discountAmount: 0, taxAmount: 0, total: 320, fulfillmentSource: 'manufacturer', isPreOrder: true, productionStatus: 'In production' },
    ];
    return {
      id, orderNumber: num, source: 'Thread', salesChannel: 'Brandthread',
      status: 'processing' as OrderStatus, paymentStatus: 'paid' as PaymentStatus,
      fulfillmentStatus: 'manufacturer_pending' as FulfillmentStatus, fulfillmentType: 'manufacturer' as FulfillmentType,
      riskLevel: 'low' as const, riskFlags: [],
      customer: makeCustomer('cust_004', 'Morgan Davis', 'morgan@example.com', 1, 320),
      lineItems: items,
      fulfillment: makeFulfillment(id, items.map(i => i.id), 'manufacturer', 'manufacturer_pending'),
      payment: makePayment(total), heldFunds: makeHeld(id, total, ['payment_confirmed', 'manufacturer_deposit', 'production_started']),
      shipments: [], labels: [], returns: [], refunds: [], disputes: [],
      preOrder: {
        manufacturerId: 'mfg_001', manufacturerName: 'Apex Apparel Co.',
        fundingGoal: 5000, unitsOrdered: 2,
        estimatedProductionDate: daysFromNow(14),
        estimatedShipDate: daysFromNow(30),
        productionStatus: 'started',
        customerNotified: true, delayNoticeCount: 0,
      },
      timeline: makeTimeline([
        { type: 'order_created', message: `Pre-order ${num} placed`, customerVisible: true },
        { type: 'payment_confirmed', message: 'Pre-order payment confirmed', customerVisible: true },
        { type: 'manufacturer_assigned', message: 'Assigned to Apex Apparel Co.' },
        { type: 'production_update', message: 'Production started at Apex Apparel Co.' },
      ]),
      notes: [], hasUnreadMessage: false, isPreOrder: true, isManufacturerFulfilled: true,
      sellerId: 'u_threadhaus', sellerName: 'Threadhaus', sellerHandle: '@threadhaus',
      currency: 'USD', tags: ['pre-order'], createdAt: daysAgo(7), updatedAt: now(),
    } as Order;
  })(),

  // 5. Return requested
  (() => {
    const id = 'ord_005'; const num = '#1030'; const total = 112.00;
    const items: OrderLineItem[] = [
      { id: 'li_005a', productId: 'p1', productName: 'Oversized Hoodie', variant: 'Grey / M', sku: 'HOD-GRY-M', quantity: 1, unitPrice: 98, discountAmount: 0, taxAmount: 0, total: 98, fulfillmentSource: 'seller', isPreOrder: false },
      { id: 'li_005b', productId: 'p2', productName: 'Logo Tee', variant: 'Black / S', sku: 'TEE-BLK-S', quantity: 1, unitPrice: 14, discountAmount: 0, taxAmount: 0, total: 14, fulfillmentSource: 'seller', isPreOrder: false },
    ];
    const returnReq: ReturnRequest = {
      id: 'ret_001', orderId: id, orderNumber: num,
      customerId: 'cust_005', customerName: 'Taylor Nguyen',
      status: 'requested', items: [
        { lineItemId: 'li_005a', productName: 'Oversized Hoodie', variant: 'Grey / M', quantity: 1, unitPrice: 98, reason: 'wrong_size' },
      ],
      customerExplanation: 'Ordered Medium but it runs large — too big for me.',
      imageUris: [], requestedResolution: 'refund',
      returnDeadline: daysFromNow(14),
      createdAt: daysAgo(1), updatedAt: now(),
    };
    return {
      id, orderNumber: num, source: 'Discover', salesChannel: 'Brandthread',
      status: 'delivered' as OrderStatus, paymentStatus: 'paid' as PaymentStatus,
      fulfillmentStatus: 'fulfilled' as FulfillmentStatus, fulfillmentType: 'seller' as FulfillmentType,
      riskLevel: 'low' as const, riskFlags: [],
      customer: makeCustomer('cust_005', 'Taylor Nguyen', 'taylor@example.com', 4, 560),
      lineItems: items,
      fulfillment: makeFulfillment(id, items.map(i => i.id), 'seller', 'fulfilled'),
      payment: makePayment(total, false), heldFunds: makeHeld(id, total, ['payment_confirmed', 'product_shipped', 'tracking_verified', 'delivered']),
      shipments: [], labels: [], returns: [returnReq], refunds: [], disputes: [],
      timeline: makeTimeline([
        { type: 'order_created', message: `Order ${num} placed`, customerVisible: true },
        { type: 'payment_confirmed', message: 'Payment confirmed', customerVisible: true },
        { type: 'shipped', message: 'Shipped via USPS', customerVisible: true },
        { type: 'delivered', message: 'Delivered', customerVisible: true },
        { type: 'return_requested', message: 'Customer requested return — Wrong size', customerVisible: true },
      ]),
      notes: [], hasUnreadMessage: true, isPreOrder: false, isManufacturerFulfilled: false,
      sellerId: 'u_threadhaus', sellerName: 'Threadhaus', sellerHandle: '@threadhaus',
      currency: 'USD', tags: [], createdAt: daysAgo(14), updatedAt: now(),
    } as Order;
  })(),

  // 6. Disputed / high risk
  (() => {
    const id = 'ord_006'; const num = '#1028'; const total = 198.00;
    const items: OrderLineItem[] = [
      { id: 'li_006a', productId: 'p7', productName: 'Denim Jacket', variant: 'Indigo / L', sku: 'DNM-IND-L', quantity: 1, unitPrice: 198, discountAmount: 0, taxAmount: 0, total: 198, fulfillmentSource: 'seller', isPreOrder: false },
    ];
    const dispute: Dispute = {
      id: 'disp_001', orderId: id, type: 'not_received', status: 'evidence_needed',
      customerClaim: 'I never received my order. Tracking says delivered but nothing arrived.',
      amount: 198, evidenceDeadline: daysFromNow(5),
      evidence: [], internalNotes: [], potentialHold: 198,
      createdAt: daysAgo(3), updatedAt: now(),
    };
    return {
      id, orderNumber: num, source: 'Thread', salesChannel: 'Brandthread',
      status: 'disputed' as OrderStatus, paymentStatus: 'paid' as PaymentStatus,
      fulfillmentStatus: 'fulfilled' as FulfillmentStatus, fulfillmentType: 'seller' as FulfillmentType,
      riskLevel: 'high' as const,
      riskFlags: [
        { id: 'rf_001', type: 'billing_mismatch', label: 'Billing & shipping address mismatch', severity: 'medium' },
        { id: 'rf_002', type: 'new_customer', label: 'New customer, high value order', severity: 'low' },
      ],
      customer: makeCustomer('cust_006', 'Casey Park', 'casey@example.com', 1, 198),
      lineItems: items,
      fulfillment: makeFulfillment(id, items.map(i => i.id), 'seller', 'fulfilled'),
      payment: makePayment(total, true), heldFunds: makeHeld(id, total, ['payment_confirmed', 'product_shipped']),
      shipments: [], labels: [], returns: [], refunds: [], disputes: [dispute],
      timeline: makeTimeline([
        { type: 'order_created', message: `Order ${num} placed`, customerVisible: true },
        { type: 'risk_review', message: 'Order flagged for risk review — billing/shipping mismatch' },
        { type: 'payment_confirmed', message: 'Payment confirmed', customerVisible: true },
        { type: 'shipped', message: 'Shipped via UPS', customerVisible: true },
        { type: 'dispute_opened', message: 'Customer dispute opened — Product not received', customerVisible: true },
      ]),
      notes: [], hasUnreadMessage: true, isPreOrder: false, isManufacturerFulfilled: false,
      sellerId: 'u_threadhaus', sellerName: 'Threadhaus', sellerHandle: '@threadhaus',
      currency: 'USD', tags: ['high-risk'], createdAt: daysAgo(18), updatedAt: now(),
    } as Order;
  })(),
];

// Demo buyer orders
const DEMO_BUYER_ORDERS: BuyerOrderView[] = DEMO_ORDERS_DATA.map(o => ({
  id: o.id,
  orderNumber: o.orderNumber,
  sellerId: o.sellerId,
  sellerName: o.sellerName,
  sellerHandle: o.sellerHandle,
  status: o.status,
  paymentStatus: o.paymentStatus,
  fulfillmentStatus: o.fulfillmentStatus,
  lineItems: o.lineItems.map(li => ({ productName: li.productName, variant: li.variant, quantity: li.quantity, unitPrice: li.unitPrice })),
  shippingAddress: o.customer.shippingAddress,
  payment: { subtotal: o.payment.subtotal, shippingTotal: o.payment.shippingTotal, taxTotal: o.payment.taxTotal, total: o.payment.total },
  trackingNumber: o.shipments[0]?.trackingNumber,
  trackingCarrier: o.shipments[0]?.carrier,
  trackingStatus: o.shipments[0]?.trackingStatus,
  estimatedDelivery: o.shipments[0]?.estimatedDelivery,
  isPreOrder: o.isPreOrder,
  preOrderEstShipDate: o.preOrder?.estimatedShipDate,
  hasReturnRequest: o.returns.length > 0,
  createdAt: o.createdAt,
}));

// ─── In-memory store ──────────────────────────────────────────────────────────

let _initialized = false;
let _orders: Order[] = [];
let _buyerOrders: BuyerOrderView[] = [];

async function ensureInitialized() {
  if (_initialized) return;
  _initialized = true;
  try {
    const [[, raw], [, rawBuyer]] = await AsyncStorage.multiGet([KEYS.orders, KEYS.buyer]);
    _orders = raw ? JSON.parse(raw) : DEMO_ORDERS_DATA;
    _buyerOrders = rawBuyer ? JSON.parse(rawBuyer) : DEMO_BUYER_ORDERS;
    // Backfill sellerId/sellerHandle for records persisted before these fields were added
    _buyerOrders = _buyerOrders.map(o => ({
      ...o,
      sellerId:     o.sellerId     ?? 'u_threadhaus',
      sellerName:   o.sellerName   ?? 'Threadhaus',
      sellerHandle: o.sellerHandle ?? '@threadhaus',
    }));
    if (!raw) await AsyncStorage.setItem(KEYS.orders, JSON.stringify(_orders));
    if (!rawBuyer) await AsyncStorage.setItem(KEYS.buyer, JSON.stringify(_buyerOrders));
  } catch {
    _orders = DEMO_ORDERS_DATA;
    _buyerOrders = DEMO_BUYER_ORDERS;
  }
}

async function persistOrders() {
  await AsyncStorage.setItem(KEYS.orders, JSON.stringify(_orders));
}

function addTimeline(order: Order, type: OrderTimelineEvent['type'], message: string, customerVisible = false) {
  order.timeline.push({ id: 'tl_' + uid(), type, message, isCustomerVisible: customerVisible, isSystemEvent: true, isSellerNote: false, createdAt: now() });
}

// ─── Public API — Seller ──────────────────────────────────────────────────────

export async function getOrders(): Promise<Order[]> {
  await ensureInitialized();
  return [..._orders];
}

export async function getOrder(id: string): Promise<Order | undefined> {
  await ensureInitialized();
  return _orders.find(o => o.id === id);
}

export async function searchOrders(query: string): Promise<Order[]> {
  await ensureInitialized();
  const q = query.toLowerCase().trim();
  if (!q) return [..._orders];
  return _orders.filter(o =>
    o.orderNumber.toLowerCase().includes(q) ||
    o.customer.name.toLowerCase().includes(q) ||
    o.customer.email.toLowerCase().includes(q) ||
    o.lineItems.some(li => li.productName.toLowerCase().includes(q) || (li.sku ?? '').toLowerCase().includes(q)) ||
    o.shipments.some(s => (s.trackingNumber ?? '').toLowerCase().includes(q))
  );
}

export function filterOrders(orders: Order[], filter: OrderFilterKey): Order[] {
  switch (filter) {
    case 'all': return orders;
    case 'new': return orders.filter(o => o.status === 'new');
    case 'unfulfilled': return orders.filter(o => o.fulfillmentStatus === 'unfulfilled');
    case 'partially_fulfilled': return orders.filter(o => o.fulfillmentStatus === 'partially_fulfilled');
    case 'processing': return orders.filter(o => o.status === 'processing');
    case 'ready_to_ship': return orders.filter(o => o.status === 'ready_to_ship');
    case 'shipped': return orders.filter(o => o.status === 'shipped');
    case 'delivered': return orders.filter(o => o.status === 'delivered');
    case 'cancelled': return orders.filter(o => o.status === 'cancelled');
    case 'refunded': return orders.filter(o => o.status === 'refunded');
    case 'returned': return orders.filter(o => o.returns.length > 0);
    case 'pre_order': return orders.filter(o => o.isPreOrder);
    case 'manufacturer_fulfilled': return orders.filter(o => o.fulfillmentType === 'manufacturer');
    case 'seller_fulfilled': return orders.filter(o => o.fulfillmentType === 'seller');
    case 'high_risk': return orders.filter(o => o.riskLevel === 'high');
    case 'disputed': return orders.filter(o => o.status === 'disputed');
    default: return orders;
  }
}

export function sortOrders(orders: Order[], sort: OrderSortKey): Order[] {
  const arr = [...orders];
  switch (sort) {
    case 'newest': return arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case 'oldest': return arr.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    case 'highest_value': return arr.sort((a, b) => b.payment.total - a.payment.total);
    case 'lowest_value': return arr.sort((a, b) => a.payment.total - b.payment.total);
    case 'customer_name': return arr.sort((a, b) => a.customer.name.localeCompare(b.customer.name));
    case 'fulfillment_status': return arr.sort((a, b) => a.fulfillmentStatus.localeCompare(b.fulfillmentStatus));
    case 'payment_status': return arr.sort((a, b) => a.paymentStatus.localeCompare(b.paymentStatus));
    default: return arr;
  }
}

export async function markProcessing(orderId: string): Promise<Order | undefined> {
  await ensureInitialized();
  const o = _orders.find(x => x.id === orderId);
  if (!o) return undefined;
  o.status = 'processing';
  addTimeline(o, 'processing_started', 'Order marked as processing');
  o.updatedAt = now();
  await persistOrders();
  return o;
}

export async function markReadyToShip(orderId: string): Promise<Order | undefined> {
  await ensureInitialized();
  const o = _orders.find(x => x.id === orderId);
  if (!o) return undefined;
  o.status = 'ready_to_ship';
  o.fulfillment.isPicked = true;
  o.fulfillment.isPacked = true;
  addTimeline(o, 'status_changed', 'Order marked ready to ship');
  o.updatedAt = now();
  await persistOrders();
  return o;
}

export async function addTracking(orderId: string, carrier: string, trackingNumber: string): Promise<any> {
  // Try real API first, fall back to local demo
  try {
    const { api } = await import('@/lib/api');
    return await api.orders.addTracking(orderId, { trackingNumber, carrier });
  } catch {
    // Demo fallback (if no real order or API unavailable)
    await ensureInitialized();
    const o = _orders.find(x => x.id === orderId);
    if (!o) return undefined;
    const shipment: Shipment = {
      id: 'shp_' + uid(), orderId,
      fulfillmentGroupId: o.fulfillment.groups[0]?.id ?? '',
      carrier, trackingNumber, trackingStatus: 'label_created',
      trackingEvents: [{ id: 'te_' + uid(), status: 'label_created', description: 'Tracking added manually', timestamp: now() }],
      isDemo: true,
    };
    o.shipments.push(shipment);
    addTimeline(o, 'tracking_added', `Tracking added: ${carrier} ${trackingNumber}`, true);
    o.updatedAt = now();
    await persistOrders();
    return o;
  }
}

export async function markShipped(orderId: string): Promise<Order | undefined> {
  await ensureInitialized();
  const o = _orders.find(x => x.id === orderId);
  if (!o) return undefined;
  o.status = 'shipped';
  o.fulfillmentStatus = 'fulfilled';
  o.fulfillment.groups.forEach(g => { g.status = 'fulfilled'; g.updatedAt = now(); });
  if (o.shipments[0]) { o.shipments[0].shippedAt = now(); o.shipments[0].trackingStatus = 'in_transit'; }
  if (o.heldFunds) {
    const m = o.heldFunds.milestones.find(x => x.key === 'product_shipped');
    if (m && !m.completedAt) m.completedAt = now();
  }
  addTimeline(o, 'shipped', 'Order marked as shipped', true);
  o.updatedAt = now();
  await persistOrders();
  return o;
}

export async function markDelivered(orderId: string): Promise<Order | undefined> {
  await ensureInitialized();
  const o = _orders.find(x => x.id === orderId);
  if (!o) return undefined;
  o.status = 'delivered';
  if (o.shipments[0]) { o.shipments[0].deliveredAt = now(); o.shipments[0].trackingStatus = 'delivered'; }
  if (o.heldFunds) {
    ['tracking_verified', 'delivered'].forEach(k => {
      const m = o.heldFunds!.milestones.find(x => x.key === k);
      if (m && !m.completedAt) m.completedAt = now();
    });
  }
  addTimeline(o, 'delivered', 'Order delivered', true);
  o.updatedAt = now();
  await persistOrders();
  return o;
}

export async function getDemoShippingRates(): Promise<ShippingRate[]> {
  return new Promise(resolve => setTimeout(() => resolve(DEMO_CARRIER_RATES), 800));
}

export async function buyDemoLabel(orderId: string, rateId: string): Promise<ShippingLabel | undefined> {
  await ensureInitialized();
  const o = _orders.find(x => x.id === orderId);
  const rate = DEMO_CARRIER_RATES.find(r => r.id === rateId);
  if (!o || !rate) return undefined;
  const tracking = '9400' + Math.floor(Math.random() * 1e16).toString().slice(0, 16);
  const label: ShippingLabel = {
    id: 'lbl_' + uid(), orderId,
    carrier: rate.carrier, service: rate.service,
    trackingNumber: tracking, price: rate.price,
    status: 'active', isDemo: true, purchasedAt: now(),
  };
  o.labels.push(label);
  // add shipment
  const shipment: Shipment = {
    id: 'shp_' + uid(), orderId,
    fulfillmentGroupId: o.fulfillment.groups[0]?.id ?? '',
    carrier: rate.carrier, trackingNumber: tracking,
    trackingStatus: 'label_created',
    trackingEvents: [{ id: 'te_' + uid(), status: 'label_created', description: `${rate.carrier} ${rate.service} label created`, timestamp: now() }],
    estimatedDelivery: rate.estimatedDelivery,
    labelId: label.id, isDemo: true,
  };
  o.shipments.push(shipment);
  addTimeline(o, 'label_purchased', `${rate.carrier} ${rate.service} label purchased — $${rate.price.toFixed(2)}`);
  o.updatedAt = now();
  await persistOrders();
  return label;
}

export async function voidLabel(orderId: string, labelId: string): Promise<void> {
  await ensureInitialized();
  const o = _orders.find(x => x.id === orderId);
  const label = o?.labels.find(l => l.id === labelId);
  if (label) { label.status = 'voided'; }
  if (o) o.updatedAt = now();
  await persistOrders();
}

export async function cancelOrder(orderId: string, reason: CancellationReason, notes?: string): Promise<Order | undefined> {
  await ensureInitialized();
  const o = _orders.find(x => x.id === orderId);
  if (!o) return undefined;
  const refundAmount = o.payment.amountPaid - o.payment.amountRefunded;
  o.cancellation = { id: 'can_' + uid(), orderId, reason, notes, refundAmount, notifyCustomer: true, cancelledAt: now() };
  o.status = 'cancelled';
  addTimeline(o, 'cancelled', `Order cancelled — ${reason.replace(/_/g, ' ')}`, true);
  o.updatedAt = now();
  await persistOrders();
  return o;
}

export async function addOrderNote(orderId: string, content: string, type: OrderNote['type'] = 'internal', isPinned = false): Promise<OrderNote | undefined> {
  await ensureInitialized();
  const o = _orders.find(x => x.id === orderId);
  if (!o) return undefined;
  const note: OrderNote = {
    id: 'note_' + uid(), orderId, type, content, isPinned,
    fileIds: [], authorName: 'Seller', createdAt: now(),
  };
  o.notes.push(note);
  addTimeline(o, 'note_added', `Note added: ${content.slice(0, 60)}`, false);
  o.updatedAt = now();
  await persistOrders();
  return note;
}

// ─── Returns ──────────────────────────────────────────────────────────────────

export async function createReturn(orderId: string, data: {
  items: ReturnItem[];
  customerExplanation: string;
  requestedResolution: ReturnRequest['requestedResolution'];
}): Promise<ReturnRequest | undefined> {
  await ensureInitialized();
  const o = _orders.find(x => x.id === orderId);
  if (!o) return undefined;
  const ret: ReturnRequest = {
    id: 'ret_' + uid(), orderId, orderNumber: o.orderNumber,
    customerId: o.customer.id, customerName: o.customer.name,
    status: 'requested', items: data.items,
    customerExplanation: data.customerExplanation,
    imageUris: [], requestedResolution: data.requestedResolution,
    returnDeadline: daysFromNow(30),
    createdAt: now(), updatedAt: now(),
  };
  o.returns.push(ret);
  addTimeline(o, 'return_requested', `Return requested by ${o.customer.name}`, true);
  o.updatedAt = now();
  await persistOrders();
  return ret;
}

export async function updateReturnStatus(orderId: string, returnId: string, status: ReturnStatus, reason?: string): Promise<void> {
  await ensureInitialized();
  const o = _orders.find(x => x.id === orderId);
  const ret = o?.returns.find(r => r.id === returnId);
  if (!ret) return;
  ret.status = status;
  if (reason) ret.deniedReason = reason;
  ret.updatedAt = now();
  if (o) o.updatedAt = now();
  await persistOrders();
}

// ─── Refunds ──────────────────────────────────────────────────────────────────

export async function createRefund(orderId: string, data: {
  type: RefundType;
  lineItems: RefundLineItem[];
  shippingAmount: number;
  taxAmount: number;
  reason?: string;
  restockInventory: boolean;
  returnId?: string;
}): Promise<Refund | undefined> {
  await ensureInitialized();
  const o = _orders.find(x => x.id === orderId);
  if (!o) return undefined;
  const total = data.lineItems.reduce((s, i) => s + i.amount, 0) + data.shippingAmount + data.taxAmount;
  const refund: Refund = {
    id: 'ref_' + uid(), orderId, returnId: data.returnId,
    type: data.type, status: 'processing',
    lineItems: data.lineItems, shippingAmount: data.shippingAmount,
    taxAmount: data.taxAmount, totalAmount: total,
    reason: data.reason, restockInventory: data.restockInventory,
    notifyCustomer: true, isDemo: true,
    createdAt: now(),
  };
  o.refunds.push(refund);
  o.payment.amountRefunded += total;
  // simulate completion
  setTimeout(async () => {
    const freshO = _orders.find(x => x.id === orderId);
    const freshR = freshO?.refunds.find(r => r.id === refund.id);
    if (freshR) { freshR.status = 'completed'; freshR.processedAt = now(); }
    if (freshO) freshO.updatedAt = now();
    await persistOrders();
  }, 1500);
  addTimeline(o, 'refund_issued', `Refund of $${total.toFixed(2)} initiated (demo)`, true);
  o.updatedAt = now();
  await persistOrders();
  return refund;
}

// ─── Disputes ─────────────────────────────────────────────────────────────────

export async function createDispute(orderId: string, data: {
  type: DisputeType;
  customerClaim: string;
  amount: number;
}): Promise<Dispute | undefined> {
  await ensureInitialized();
  const o = _orders.find(x => x.id === orderId);
  if (!o) return undefined;
  const dispute: Dispute = {
    id: 'disp_' + uid(), orderId, type: data.type,
    status: 'evidence_needed', customerClaim: data.customerClaim,
    amount: data.amount, evidenceDeadline: daysFromNow(7),
    evidence: [], internalNotes: [], potentialHold: data.amount,
    createdAt: now(), updatedAt: now(),
  };
  o.disputes.push(dispute);
  o.status = 'disputed';
  addTimeline(o, 'dispute_opened', `Dispute opened — ${data.type.replace(/_/g, ' ')}`, true);
  o.updatedAt = now();
  await persistOrders();
  return dispute;
}

export async function addDisputeEvidence(orderId: string, disputeId: string, evidence: Omit<DisputeEvidence, 'id' | 'disputeId' | 'submittedAt'>): Promise<void> {
  await ensureInitialized();
  const o = _orders.find(x => x.id === orderId);
  const d = o?.disputes.find(x => x.id === disputeId);
  if (!d) return;
  d.evidence.push({ id: 'ev_' + uid(), disputeId, ...evidence, submittedAt: now() });
  d.status = 'evidence_submitted';
  d.updatedAt = now();
  if (o) o.updatedAt = now();
  await persistOrders();
}

// ─── Pre-order ────────────────────────────────────────────────────────────────

export async function updatePreOrder(orderId: string, update: Partial<Order['preOrder']>): Promise<Order | undefined> {
  await ensureInitialized();
  const o = _orders.find(x => x.id === orderId);
  if (!o || !o.preOrder) return undefined;
  Object.assign(o.preOrder, update);
  const estDate = (update as NonNullable<Order['preOrder']>).estimatedShipDate;
  if (estDate) {
    addTimeline(o, 'production_update', `Estimated ship date updated to ${fmtDate(estDate)}`, false);
  }
  o.updatedAt = now();
  await persistOrders();
  return o;
}

// ─── Stats (for seller home integration) ─────────────────────────────────────

export async function getOrderStats(): Promise<{
  newOrders: number;
  toProcess: number;
  readyToShip: number;
  preOrderUpdates: number;
  returnRequests: number;
  disputes: number;
  total: number;
}> {
  await ensureInitialized();
  const orders = _orders;
  return {
    newOrders: orders.filter(o => o.status === 'new').length,
    toProcess: orders.filter(o => o.status === 'processing').length,
    readyToShip: orders.filter(o => o.status === 'ready_to_ship').length,
    preOrderUpdates: orders.filter(o => o.isPreOrder && o.preOrder?.productionStatus !== 'complete').length,
    returnRequests: orders.flatMap(o => o.returns).filter(r => r.status === 'requested' || r.status === 'under_review').length,
    disputes: orders.filter(o => o.status === 'disputed').length,
    total: orders.length,
  };
}

// ─── Public API — Buyer ───────────────────────────────────────────────────────

// Map DB order status → UI OrderStatus (UI uses a broader set of values)
function mapBuyerOrderStatus(dbStatus: string): OrderStatus {
  switch (dbStatus) {
    case 'pending':       return 'new';
    case 'processing':    return 'processing';
    case 'ready_to_ship': return 'ready_to_ship';
    case 'shipped':       return 'shipped';
    case 'delivered':     return 'delivered';
    case 'cancelled':     return 'cancelled';
    case 'refund_pending':
    case 'refunded':      return 'refunded';
    case 'disputed':      return 'disputed';
    default:              return 'new';
  }
}

function mapBuyerFulfillmentStatus(dbStatus: string): FulfillmentStatus {
  switch (dbStatus) {
    case 'shipped':
    case 'delivered': return 'fulfilled';
    case 'cancelled': return 'cancelled';
    default:          return 'unfulfilled';
  }
}

function mapApiBuyerOrder(o: any): BuyerOrderView {
  return {
    id:                o.id,
    orderNumber:       o.orderNumber,
    sellerId:          o.ownerId          ?? '',
    sellerName:        o.sellerDisplayName ?? o.sellerName ?? 'Seller',
    sellerHandle:      o.sellerHandle     ?? `@seller`,
    status:            mapBuyerOrderStatus(o.status ?? 'pending'),
    paymentStatus:     'paid' as PaymentStatus,
    fulfillmentStatus: mapBuyerFulfillmentStatus(o.status ?? 'pending'),
    lineItems:         (o.items ?? []).map((item: any) => ({
      productName: item.productName ?? item.name ?? '',
      variant:     item.variantLabel ?? '',
      quantity:    item.quantity     ?? 1,
      unitPrice:   (item.priceCents  ?? 0) / 100,
      imageUri:    item.imageUri     ?? undefined,
    })),
    shippingAddress: o.shippingAddress ?? { street: '', city: '', state: '', zip: '', country: 'US' },
    payment: {
      subtotal:      (o.subtotalCents  ?? 0) / 100,
      shippingTotal: (o.shippingCents  ?? 0) / 100,
      taxTotal:      0,
      total:         (o.totalCents     ?? 0) / 100,
    },
    trackingNumber:    o.trackingNumber    ?? undefined,
    trackingCarrier:   o.carrier           ?? undefined,
    trackingStatus:    o.trackingStatus    ?? undefined,
    estimatedDelivery: o.estimatedDelivery ?? undefined,
    isPreOrder:        false,
    hasReturnRequest: false,
    createdAt:       o.createdAt      ?? now(),
  };
}

export async function getBuyerOrders(): Promise<BuyerOrderView[]> {
  // Try real API first so buyers see their actual orders
  try {
    const apiOrders = await serviceRequest('/api/buyer/orders') as any[];
    if (Array.isArray(apiOrders) && apiOrders.length > 0) {
      const mapped = apiOrders.map(mapApiBuyerOrder);
      _buyerOrders = mapped;
      await AsyncStorage.setItem(KEYS.buyer, JSON.stringify(mapped));
      return [...mapped].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
  } catch {
    // Fall through to local cache
  }
  await ensureInitialized();
  return [..._buyerOrders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getBuyerOrder(id: string): Promise<BuyerOrderView | undefined> {
  // Try real API first for a single order fetch
  try {
    const apiOrder = await serviceRequest(`/api/buyer/orders/${encodeURIComponent(id)}`) as any;
    if (apiOrder?.id) {
      const mapped = mapApiBuyerOrder(apiOrder);
      // Update in-memory cache
      const idx = _buyerOrders.findIndex(o => o.id === id);
      if (idx >= 0) _buyerOrders[idx] = mapped; else _buyerOrders.push(mapped);
      return mapped;
    }
  } catch {
    // Fall through to local cache
  }
  await ensureInitialized();
  return _buyerOrders.find(o => o.id === id);
}

export async function exportOrdersCsv(orders: Order[]): Promise<string> {
  const header = 'Order #,Customer,Date,Total,Payment,Fulfillment';
  const rows = orders.map(o =>
    [o.orderNumber, o.customer.name, o.createdAt.slice(0, 10), `$${o.payment.total.toFixed(2)}`, o.paymentStatus, o.fulfillmentStatus].join(',')
  );
  return [header, ...rows].join('\n');
}
