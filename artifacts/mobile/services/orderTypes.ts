/**
 * Brandthread Orders, Fulfillment, Returns, Refunds, Held Funds & Payouts
 * Comprehensive typed models.
 */

// ─── Core enums ───────────────────────────────────────────────────────────────

export type OrderStatus =
  | 'new' | 'processing' | 'ready_to_ship' | 'shipped'
  | 'delivered' | 'cancelled' | 'refunded' | 'disputed';

export type PaymentStatus =
  | 'pending' | 'authorized' | 'paid' | 'partially_refunded'
  | 'refunded' | 'voided' | 'failed';

export type FulfillmentStatus =
  | 'unfulfilled' | 'partially_fulfilled' | 'fulfilled'
  | 'manufacturer_pending' | 'returned' | 'cancelled';

export type FulfillmentType = 'seller' | 'manufacturer' | 'mixed' | 'digital';

export type RiskLevel = 'low' | 'medium' | 'high';

export type ReturnStatus =
  | 'requested' | 'under_review' | 'approved' | 'denied'
  | 'label_issued' | 'in_transit' | 'received' | 'inspected'
  | 'refund_pending' | 'refunded' | 'exchange_completed' | 'closed';

export type ReturnReason =
  | 'wrong_size' | 'wrong_item' | 'damaged' | 'defective'
  | 'not_as_described' | 'changed_mind' | 'late_delivery'
  | 'missing_item' | 'other';

export type RefundStatus = 'processing' | 'completed' | 'failed' | 'cancelled';
export type RefundType = 'full' | 'partial' | 'shipping' | 'item' | 'store_credit';

export type DisputeStatus =
  | 'open' | 'evidence_needed' | 'evidence_submitted'
  | 'under_review' | 'won' | 'lost' | 'closed';

export type DisputeType =
  | 'not_received' | 'not_as_described' | 'unauthorized'
  | 'duplicate_charge' | 'refund_not_received' | 'damaged' | 'other';

export type TrackingStatus =
  | 'label_created' | 'accepted' | 'in_transit'
  | 'out_for_delivery' | 'delivered' | 'exception' | 'returned_to_sender';

export type TimelineEventType =
  | 'order_created' | 'payment_confirmed' | 'risk_review'
  | 'processing_started' | 'manufacturer_assigned' | 'production_update'
  | 'label_purchased' | 'tracking_added' | 'shipped' | 'delivered'
  | 'return_requested' | 'refund_issued' | 'dispute_opened'
  | 'payout_released' | 'note_added' | 'status_changed' | 'cancelled';

export type PayoutMilestoneKey =
  | 'payment_confirmed' | 'manufacturer_deposit' | 'production_started'
  | 'product_shipped' | 'tracking_verified' | 'delivered'
  | 'return_window_complete' | 'dispute_resolved';

export type HeldFundsStatus = 'held' | 'partially_released' | 'released' | 'disputed';

export type CancellationReason =
  | 'customer_request' | 'out_of_stock' | 'production_issue'
  | 'fraud_risk' | 'shipping_restriction' | 'duplicate_order'
  | 'seller_decision' | 'other';

// ─── Address ──────────────────────────────────────────────────────────────────

export interface OrderAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
}

// ─── Customer ─────────────────────────────────────────────────────────────────

export interface OrderCustomer {
  id: string;
  name: string;
  email: string;
  phone?: string;
  initials: string;
  totalOrders: number;
  lifetimeValueCents: number;
  tags: string[];
  shippingAddress: OrderAddress;
  billingAddress: OrderAddress;
}

// ─── Line items ───────────────────────────────────────────────────────────────

export interface OrderLineItem {
  id: string;
  productId: string;
  productName: string;
  variant: string;
  sku?: string;
  imageUri?: string;
  quantity: number;
  unitPriceCents: number;
  discountAmountCents: number;
  taxAmountCents: number;
  totalCents: number;
  fulfillmentSource: FulfillmentType;
  fulfillmentGroupId?: string;
  productionStatus?: string;
  contentTagSource?: string;
  isPreOrder: boolean;
}

// ─── Shipping ─────────────────────────────────────────────────────────────────

export interface ShippingRate {
  id: string;
  carrier: string;
  service: string;
  priceCents: number;
  estimatedDays: number;
  estimatedDelivery: string;
  trackingIncluded: boolean;
  insuranceIncluded: boolean;
  isRecommended: boolean;
}

export interface TrackingEvent {
  id: string;
  status: TrackingStatus;
  location?: string;
  description: string;
  timestamp: string;
}

export interface ShippingLabel {
  id: string;
  orderId: string;
  fulfillmentGroupId?: string;
  carrier: string;
  service: string;
  trackingNumber: string;
  labelUrl?: string;
  priceCents: number;
  status: 'active' | 'voided';
  isDemo: boolean;
  purchasedAt: string;
}

export interface Shipment {
  id: string;
  orderId: string;
  fulfillmentGroupId: string;
  carrier?: string;
  trackingNumber?: string;
  trackingStatus?: TrackingStatus;
  trackingEvents: TrackingEvent[];
  labelId?: string;
  shippedAt?: string;
  estimatedDelivery?: string;
  deliveredAt?: string;
  isDemo: boolean;
}

// ─── Fulfillment ──────────────────────────────────────────────────────────────

export interface FulfillmentGroup {
  id: string;
  orderId: string;
  type: FulfillmentType;
  status: FulfillmentStatus;
  lineItemIds: string[];
  manufacturerId?: string;
  manufacturerName?: string;
  shipmentId?: string;
  labelId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Fulfillment {
  id: string;
  orderId: string;
  groups: FulfillmentGroup[];
  type: FulfillmentType;
  status: FulfillmentStatus;
  // Seller fulfillment checklist state
  isPicked: boolean;
  isPacked: boolean;
  fromAddress?: OrderAddress;
}

// ─── Payment & Held Funds ─────────────────────────────────────────────────────

export interface PayoutMilestone {
  key: PayoutMilestoneKey;
  label: string;
  completedAt?: string;
  isRequired: boolean;
}

export interface HeldFundsRecord {
  id: string;
  orderId: string;
  status: HeldFundsStatus;
  totalReceivedCents: number;
  currentlyHeldCents: number;
  manufacturerReservedCents: number;
  shippingReservedCents: number;
  platformFeeCents: number;
  sellerPendingCents: number;
  sellerReleasedCents: number;
  milestones: PayoutMilestone[];
  holdReason?: string;
  expectedReleaseDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentSummary {
  subtotalCents: number;
  discountTotalCents: number;
  shippingTotalCents: number;
  taxTotalCents: number;
  totalCents: number;
  amountPaidCents: number;
  amountRefundedCents: number;
  amountHeldCents: number;
  amountPendingCents: number;
  sellerAllocationCents: number;
  manufacturerAllocationCents: number;
  shippingLabelAllocationCents: number;
  platformFeeCents: number;
  payoutStatus: 'available' | 'pending' | 'held' | 'paid';
}

// ─── Risk ─────────────────────────────────────────────────────────────────────

export interface RiskFlag {
  id: string;
  type: string;
  label: string;
  severity: 'low' | 'medium' | 'high';
  detail?: string;
}

// ─── Timeline & Notes ─────────────────────────────────────────────────────────

export interface OrderTimelineEvent {
  id: string;
  type: TimelineEventType;
  message: string;
  isCustomerVisible: boolean;
  isSystemEvent: boolean;
  isSellerNote: boolean;
  authorName?: string;
  createdAt: string;
}

export interface OrderNote {
  id: string;
  orderId: string;
  type: 'internal' | 'customer' | 'manufacturer';
  content: string;
  isPinned: boolean;
  fileIds: string[];
  authorName: string;
  createdAt: string;
}

// ─── Cancellation ─────────────────────────────────────────────────────────────

export interface Cancellation {
  id: string;
  orderId: string;
  reason: CancellationReason;
  notes?: string;
  refundAmountCents: number;
  notifyCustomer: boolean;
  cancelledAt: string;
}

// ─── Returns ─────────────────────────────────────────────────────────────────

export interface ReturnItem {
  lineItemId: string;
  productName: string;
  variant: string;
  quantity: number;
  unitPriceCents: number;
  reason: ReturnReason;
}

export interface ReturnInspection {
  id: string;
  returnId: string;
  result: 'pass' | 'fail' | 'partial';
  notes: string;
  imageUris: string[];
  inspectedAt: string;
}

export interface ReturnRequest {
  id: string;
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  status: ReturnStatus;
  items: ReturnItem[];
  customerExplanation: string;
  imageUris: string[];
  requestedResolution: 'refund' | 'exchange' | 'store_credit';
  returnDeadline: string;
  labelId?: string;
  labelPaidBy?: 'seller' | 'customer' | 'manufacturer';
  shipmentId?: string;
  inspection?: ReturnInspection;
  deniedReason?: string;
  refundId?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Refunds ──────────────────────────────────────────────────────────────────

export interface RefundLineItem {
  lineItemId: string;
  productName: string;
  variant: string;
  quantity: number;
  amountCents: number;
}

export interface Refund {
  id: string;
  orderId: string;
  returnId?: string;
  type: RefundType;
  status: RefundStatus;
  lineItems: RefundLineItem[];
  shippingAmountCents: number;
  taxAmountCents: number;
  totalAmountCents: number;
  reason?: string;
  restockInventory: boolean;
  notifyCustomer: boolean;
  isDemo: boolean;
  processedAt?: string;
  failedReason?: string;
  createdAt: string;
}

// ─── Disputes ─────────────────────────────────────────────────────────────────

export interface DisputeEvidence {
  id: string;
  disputeId: string;
  type: 'tracking' | 'photo' | 'policy' | 'written_response' | 'other';
  description: string;
  fileUri?: string;
  submittedAt: string;
}

export interface Dispute {
  id: string;
  orderId: string;
  type: DisputeType;
  status: DisputeStatus;
  customerClaim: string;
  amountCents: number;
  evidenceDeadline?: string;
  evidence: DisputeEvidence[];
  internalNotes: string[];
  potentialHoldCents: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Pre-order ────────────────────────────────────────────────────────────────

export interface PreOrderInfo {
  manufacturerId?: string;
  manufacturerName?: string;
  fundingGoalCents?: number;
  unitsOrdered: number;
  estimatedProductionDate?: string;
  estimatedShipDate?: string;
  productionStatus: 'pending' | 'started' | 'delayed' | 'complete';
  customerNotified: boolean;
  delayNoticeCount: number;
}

// ─── Main Order ───────────────────────────────────────────────────────────────

export interface Order {
  id: string;
  orderNumber: string;
  sellerId: string;
  sellerName: string;
  sellerHandle: string;
  source: string;
  salesChannel: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  fulfillmentType: FulfillmentType;
  riskLevel: RiskLevel;
  riskFlags: RiskFlag[];
  customer: OrderCustomer;
  lineItems: OrderLineItem[];
  fulfillment: Fulfillment;
  payment: PaymentSummary;
  heldFunds?: HeldFundsRecord;
  shipments: Shipment[];
  labels: ShippingLabel[];
  returns: ReturnRequest[];
  refunds: Refund[];
  disputes: Dispute[];
  timeline: OrderTimelineEvent[];
  notes: OrderNote[];
  cancellation?: Cancellation;
  preOrder?: PreOrderInfo;
  hasUnreadMessage: boolean;
  isPreOrder: boolean;
  isManufacturerFulfilled: boolean;
  currency: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

// ─── Buyer view ───────────────────────────────────────────────────────────────

export interface BuyerOrderView {
  id: string;
  orderNumber: string;
  sellerId: string;
  sellerName: string;
  sellerHandle: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  lineItems: {
    productName: string;
    variant: string;
    quantity: number;
    unitPriceCents: number;
    imageUri?: string;
  }[];
  shippingAddress: OrderAddress;
  payment: Pick<PaymentSummary, 'subtotalCents' | 'shippingTotalCents' | 'taxTotalCents' | 'totalCents'>;
  trackingNumber?: string;
  trackingCarrier?: string;
  trackingStatus?: TrackingStatus;
  estimatedDelivery?: string;
  isPreOrder: boolean;
  preOrderEstShipDate?: string;
  hasReturnRequest: boolean;
  cancellationReason?: string | null;
  cancellationNotes?: string | null;
  createdAt: string;
}

// ─── Filter & Sort ────────────────────────────────────────────────────────────

export type OrderFilterKey =
  | 'all' | 'new' | 'unfulfilled' | 'partially_fulfilled' | 'processing'
  | 'ready_to_ship' | 'shipped' | 'delivered' | 'cancelled' | 'refunded'
  | 'returned' | 'pre_order' | 'manufacturer_fulfilled' | 'seller_fulfilled'
  | 'high_risk' | 'disputed';

export type OrderSortKey =
  | 'newest' | 'oldest' | 'highest_value' | 'lowest_value'
  | 'customer_name' | 'fulfillment_status' | 'payment_status';

// ─── Constants ────────────────────────────────────────────────────────────────

export const PAYOUT_MILESTONES: { key: PayoutMilestoneKey; label: string; isRequired: boolean }[] = [
  { key: 'payment_confirmed',      label: 'Payment confirmed',        isRequired: true },
  { key: 'manufacturer_deposit',   label: 'Manufacturer deposit approved', isRequired: false },
  { key: 'production_started',     label: 'Production started',       isRequired: false },
  { key: 'product_shipped',        label: 'Product shipped',          isRequired: true },
  { key: 'tracking_verified',      label: 'Tracking verified',        isRequired: true },
  { key: 'delivered',              label: 'Delivered',                isRequired: true },
  { key: 'return_window_complete', label: 'Return window complete',   isRequired: true },
  { key: 'dispute_resolved',       label: 'Dispute resolved',         isRequired: false },
];

export const RETURN_REASONS: { key: ReturnReason; label: string }[] = [
  { key: 'wrong_size',       label: 'Wrong size' },
  { key: 'wrong_item',       label: 'Wrong item sent' },
  { key: 'damaged',          label: 'Damaged on arrival' },
  { key: 'defective',        label: 'Defective product' },
  { key: 'not_as_described', label: 'Not as described' },
  { key: 'changed_mind',     label: 'Changed mind' },
  { key: 'late_delivery',    label: 'Late delivery' },
  { key: 'missing_item',     label: 'Missing item' },
  { key: 'other',            label: 'Other' },
];

export const CANCELLATION_REASONS: { key: CancellationReason; label: string }[] = [
  { key: 'customer_request',    label: 'Customer request' },
  { key: 'out_of_stock',        label: 'Out of stock' },
  { key: 'production_issue',    label: 'Production issue' },
  { key: 'fraud_risk',          label: 'Fraud risk' },
  { key: 'shipping_restriction', label: 'Shipping restriction' },
  { key: 'duplicate_order',     label: 'Duplicate order' },
  { key: 'seller_decision',     label: 'Seller decision' },
  { key: 'other',               label: 'Other' },
];

export const DISPUTE_TYPES: { key: DisputeType; label: string }[] = [
  { key: 'not_received',       label: 'Product not received' },
  { key: 'not_as_described',   label: 'Not as described' },
  { key: 'unauthorized',       label: 'Unauthorized payment' },
  { key: 'duplicate_charge',   label: 'Duplicate charge' },
  { key: 'refund_not_received', label: 'Refund not received' },
  { key: 'damaged',            label: 'Damaged product' },
  { key: 'other',              label: 'Other' },
];

export const DEMO_CARRIER_RATES: ShippingRate[] = [
  {
    id: 'rate_ups_ground',
    carrier: 'UPS', service: 'Ground',
    priceCents: 899, estimatedDays: 5,
    estimatedDelivery: 'Jul 21',
    trackingIncluded: true, insuranceIncluded: false,
    isRecommended: false,
  },
  {
    id: 'rate_usps_priority',
    carrier: 'USPS', service: 'Priority Mail',
    priceCents: 1240, estimatedDays: 3,
    estimatedDelivery: 'Jul 19',
    trackingIncluded: true, insuranceIncluded: true,
    isRecommended: true,
  },
  {
    id: 'rate_fedex_2day',
    carrier: 'FedEx', service: '2Day',
    priceCents: 1985, estimatedDays: 2,
    estimatedDelivery: 'Jul 18',
    trackingIncluded: true, insuranceIncluded: true,
    isRecommended: false,
  },
  {
    id: 'rate_ups_next',
    carrier: 'UPS', service: 'Next Day Air',
    priceCents: 3850, estimatedDays: 1,
    estimatedDelivery: 'Jul 17',
    trackingIncluded: true, insuranceIncluded: true,
    isRecommended: false,
  },
];
