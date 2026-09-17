/**
 * Brandthread Buyer Cart, Checkout & Commerce Types
 * Single source of truth for all buyer commerce data models.
 */

// ─── Cart ─────────────────────────────────────────────────────────────────────

export interface CartItem {
  id: string;                // cart line ID
  productId: string;
  variantId: string;
  productName: string;
  variantTitle: string;      // e.g. "M / Black"
  imageUri?: string;
  sellerId: string;
  sellerName: string;
  sellerHandle: string;
  priceCents: number;
  compareAtPriceCents?: number;
  quantity: number;
  maxQuantity: number;       // inventory cap
  isPreOrder: boolean;
  preOrderEstShipDate?: string;
  inventoryPolicy: 'deny' | 'continue';
  isAvailable: boolean;
  unavailableReason?: string;
  sourcePostId?: string;     // attribution
  sourceTagId?: string;
  addedAt: string;
}

export interface SavedCartItem extends Omit<CartItem, 'id'> {
  id: string;
  savedAt: string;
}

export interface CartSellerGroup {
  sellerId: string;
  sellerName: string;
  sellerHandle: string;
  sellerInitial: string;
  items: CartItem[];
  subtotalCents: number;
  hasPreOrder: boolean;
  estimatedShippingCents: number;
  fulfillmentEstimate: string;
}

export interface Cart {
  id: string;
  items: CartItem[];
  savedItems: SavedCartItem[];
  updatedAt: string;
}

// ─── Checkout ─────────────────────────────────────────────────────────────────

export type CheckoutStep =
  | 'information'
  | 'delivery'
  | 'review'
  | 'confirmation'
  /** Legacy persisted values from pre-four-step checkout sessions. */
  | 'contact' | 'shipping' | 'discounts' | 'payment';

export interface CheckoutContact {
  email: string;
  phone: string;
  marketingConsent: boolean;
  orderUpdates: 'email' | 'sms' | 'both' | 'none';
}

export interface CheckoutAddress {
  id?: string;
  firstName: string;
  lastName: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  isDefault?: boolean;
}

export interface CheckoutShippingMethod {
  id: string;
  carrier: string;
  service: string;
  priceCents: number;
  estimatedDays: number;
  estimatedDelivery: string;
  trackingIncluded: boolean;
  isRecommended: boolean;
  isPreOrderEstimate?: boolean;
}

export interface CheckoutDeliveryGroup {
  sellerId: string;
  sellerName: string;
  items: CartItem[];
  selectedMethodId: string;
  availableMethods: CheckoutShippingMethod[];
  hasPreOrder: boolean;
}

export interface CheckoutDiscount {
  code: string;
  type: 'percentage' | 'fixed' | 'free_shipping' | 'store_credit';
  /** Percentage points for percentage discounts; cents for fixed discounts. */
  value: number;
  appliedAmountCents: number;
  description: string;
  isValid: boolean;
  errorMessage?: string;
}

export interface CheckoutTax {
  jurisdiction: string;
  rateBasisPoints: number;
  amount: number;
  isEstimate: boolean;
  note: string;
}

export type PaymentMethodType = 'stripe_checkout';

export interface CheckoutPaymentMethod {
  type: PaymentMethodType;
  label: string;
  last4?: string;
  brand?: string;
  expiryMonth?: number;
  expiryYear?: number;
  billingAddress?: CheckoutAddress;
  saveForFuture: boolean;
  isAvailable: boolean;
}

export interface CheckoutSummary {
  subtotalCents: number;
  discountTotalCents: number;
  shippingTotalCents: number;
  taxTotalCents: number;
  totalCents: number;
  currency: string;
}

/** A points redemption created by /api/loyalty/redeem and attached to one checkout. */
export interface CheckoutLoyaltyRedemption {
  token: string;
  pointsUsed: number;
  discountCents: number;
}

export interface CheckoutSession {
  id: string;
  cartId: string;
  step: CheckoutStep;
  contact?: CheckoutContact;
  shippingAddress?: CheckoutAddress;
  savedAddresses: CheckoutAddress[];
  deliveryGroups: CheckoutDeliveryGroup[];
  discounts: CheckoutDiscount[];
  loyaltyRedemption?: CheckoutLoyaltyRedemption;
  tax?: CheckoutTax;
  paymentMethod?: CheckoutPaymentMethod;
  summary: CheckoutSummary;
  acknowledgments: CheckoutAcknowledgment[];
  attribution?: CheckoutAttribution;
  isBuyNow: boolean;
  buyNowCartItems?: CartItem[];
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Durably tracks which seller groups have already been charged this session.
   * Persisted to AsyncStorage after each successful payment so the ref is
   * restored correctly if the component remounts before the loop finishes.
   * Guest access tokens remain device-local and are needed only to verify the
   * corresponding Stripe session after the browser returns.
   */
  paidGroups?: Record<string, {
    stripeSessionId: string;
    /** Server-assigned UUID / numeric order ID — used for all API calls and navigation. */
    orderId?: string;
    /** Human-readable display reference (e.g. "BT-1234"). Never used as an API key. */
    orderNumber?: string;
    amountTotalCents?: number;
    guestAccessToken?: string;
  }>;
}

export interface CheckoutAcknowledgment {
  key: string;
  label: string;
  required: boolean;
  acknowledged: boolean;
}

export interface CheckoutAttribution {
  sourcePostId?: string;
  sourceTagId?: string;
  campaignId?: string;
  discountCode?: string;
  influencerId?: string;
  referralCode?: string;
  channel: 'thread' | 'discover' | 'search' | 'store' | 'profile' | 'direct';
}

// ─── Payment ──────────────────────────────────────────────────────────────────

export type PaymentAttemptStatus =
  | 'pending' | 'processing' | 'succeeded' | 'failed'
  | 'cancelled' | 'expired' | 'requires_action';

export type PaymentFailureCode =
  | 'card_declined' | 'insufficient_funds' | 'authentication_required'
  | 'network_timeout' | 'provider_unavailable' | 'payment_cancelled'
  | 'session_expired' | 'inventory_changed' | 'price_changed' | 'unknown';

export interface PaymentAttempt {
  id: string;
  checkoutId: string;
  status: PaymentAttemptStatus;
  method: PaymentMethodType;
  amountCents: number;
  currency: string;
  failureCode?: PaymentFailureCode;
  failureMessage?: string;
  isDemo: boolean;
  createdAt: string;
}

// ─── Buyer Order (commerce-facing view) ───────────────────────────────────────

export interface BuyerOrderLineItem {
  id: string;
  productId: string;
  productName: string;
  variantTitle: string;
  imageUri?: string;
  quantity: number;
  unitPriceCents: number;
  discountAmountCents: number;
  totalCents: number;
  isPreOrder: boolean;
  preOrderEstShipDate?: string;
}

export type BuyerTrackingStatus =
  | 'order_confirmed' | 'processing' | 'production'
  | 'label_created' | 'shipped' | 'in_transit' | 'out_for_delivery'
  | 'delivered' | 'exception' | 'returned';

export interface BuyerTrackingEvent {
  id: string;
  status: BuyerTrackingStatus;
  description: string;
  location?: string;
  timestamp: string;
}

export interface BuyerTracking {
  carrier: string;
  trackingNumber: string;
  currentStatus: BuyerTrackingStatus;
  estimatedDelivery?: string;
  latestUpdate: string;
  events: BuyerTrackingEvent[];
}

export type BuyerPreOrderStatus =
  | 'pre_order_opened' | 'order_placed' | 'pre_order_closed'
  | 'production_started' | 'production_update' | 'quality_check'
  | 'ready_to_ship' | 'shipped' | 'delivered';

export interface BuyerPreOrderTimeline {
  status: BuyerPreOrderStatus;
  label: string;
  completedAt?: string;
  note?: string;
}

export type BuyerReturnStatus =
  | 'pending' | 'approved' | 'denied' | 'refunded';

export type BuyerReturnReason =
  | 'wrong_size' | 'wrong_item' | 'damaged' | 'defective'
  | 'not_as_described' | 'changed_mind' | 'late_delivery'
  | 'missing_item' | 'other';

export type BuyerReturnResolution = 'refund' | 'exchange' | 'store_credit' | 'replacement';

export interface BuyerReturnRequest {
  id: string;
  orderId: string;
  orderNumber: string;
  sellerName: string;
  status: BuyerReturnStatus;
  items: {
    lineItemId: string;
    productName: string;
    variantTitle: string;
    quantity: number;
    unitPriceCents: number;
    reason: BuyerReturnReason;
  }[];
  reason: BuyerReturnReason;
  description: string;
  imageUris: string[];
  preferredResolution: BuyerReturnResolution;
  refundEstimateCents: number;
  returnDeadline: string;
  returnPolicy: string;
  submittedAt: string;
  updatedAt: string;
  sellerResponse?: string;
  refundAmountCents?: number;
}

export interface BuyerRefundRequest {
  id: string;
  orderId: string;
  orderNumber: string;
  sellerName: string;
  reason: string;
  description: string;
  evidenceUris: string[];
  maxRefundAmount: number;
  status: 'pending' | 'approved' | 'denied' | 'refunded';
  submittedAt: string;
  sellerResponse?: string;
  refundAmountCents?: number;
}

export type BuyerProblemType =
  | 'not_received' | 'tracking_issue' | 'wrong_product' | 'damaged_product'
  | 'missing_item' | 'seller_not_responding' | 'unauthorized_payment' | 'other';

export interface BuyerProblemReport {
  id: string;
  orderId: string;
  orderNumber: string;
  type: BuyerProblemType;
  description: string;
  evidenceUris: string[];
  contactedSeller: boolean;
  escalatedToSupport: boolean;
  status: 'open' | 'under_review' | 'resolved' | 'closed';
  submittedAt: string;
}

export type BuyerDisputeStatus = 'open' | 'evidence_requested' | 'under_review' | 'resolved' | 'closed';

export interface BuyerDisputeView {
  id: string;
  orderId: string;
  orderNumber: string;
  type: string;
  status: BuyerDisputeStatus;
  customerClaim: string;
  amount: number;
  evidenceDeadline?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Cart validation ──────────────────────────────────────────────────────────

export interface CartValidationResult {
  isValid: boolean;
  issues: CartValidationIssue[];
}

export interface CartValidationIssue {
  itemId: string;
  productName: string;
  type: 'unavailable' | 'price_changed' | 'inventory_changed' | 'pre_order_closed' | 'seller_unavailable';
  message: string;
  oldValue?: string | number;
  newValue?: string | number;
  canContinue: boolean;
}

// ─── Demo product for buyer product detail ────────────────────────────────────

export interface BuyerProduct {
  id: string;
  sellerId: string;
  sellerName: string;
  sellerHandle: string;
  name: string;
  description: string;
  priceCents: number;
  compareAtPriceCents?: number;
  imageUris: string[];
  category: string;
  isPreOrder: boolean;
  preOrderClosingDate?: string;
  preOrderEstShipDate?: string;
  cancellationPolicy: string;
  refundPolicy: string;
  options: BuyerProductOption[];
  variants: BuyerProductVariant[];
  isActive: boolean;
  tags: string[];
}

export interface BuyerProductOption {
  id: string;
  name: string;   // "Size", "Color", "Material"
  values: { id: string; label: string; colorHex?: string }[];
}

export interface BuyerProductVariant {
  id: string;
  title: string;
  optionValues: { optionId: string; valueId: string }[];
  priceCents: number;
  compareAtPriceCents?: number;
  inventoryQuantity: number;
  isAvailable: boolean;
  imageUri?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const RETURN_REASON_OPTIONS: { key: BuyerReturnReason; label: string }[] = [
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

export const PROBLEM_TYPE_OPTIONS: { key: BuyerProblemType; label: string; icon: string }[] = [
  { key: 'not_received',          label: 'Order not received',    icon: 'package' },
  { key: 'tracking_issue',        label: 'Tracking issue',        icon: 'map-pin' },
  { key: 'wrong_product',         label: 'Wrong product',         icon: 'shuffle' },
  { key: 'damaged_product',       label: 'Damaged product',       icon: 'alert-triangle' },
  { key: 'missing_item',          label: 'Missing item',          icon: 'minus-circle' },
  { key: 'seller_not_responding', label: 'Seller not responding', icon: 'message-circle' },
  { key: 'unauthorized_payment',  label: 'Unauthorized payment',  icon: 'credit-card' },
  { key: 'other',                 label: 'Other',                 icon: 'help-circle' },
];

export const CHECKOUT_STEPS: { key: CheckoutStep; label: string; shortLabel: string }[] = [
  { key: 'information',  label: 'Information',       shortLabel: 'Info' },
  { key: 'delivery',     label: 'Delivery',          shortLabel: 'Delivery' },
  { key: 'review',       label: 'Review & Pay',      shortLabel: 'Pay' },
  { key: 'confirmation', label: 'Order Confirmed',   shortLabel: 'Done' },
];
