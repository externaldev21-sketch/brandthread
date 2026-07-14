/**
 * Brandthread Inventory System — Typed Models
 * Single source of truth for all inventory entities.
 */

// ─── Core enums ───────────────────────────────────────────────────────────────

export type InventoryStatus =
  | 'available' | 'low_stock' | 'out_of_stock' | 'reserved'
  | 'incoming' | 'damaged' | 'unavailable' | 'pre_order';

export type LocationType =
  | 'warehouse' | 'home_studio' | 'manufacturer' | 'third_party'
  | 'retail' | 'pop_up' | 'returns' | 'other';

export type AdjustmentType =
  | 'received_stock' | 'manual_count' | 'correction' | 'damage'
  | 'lost' | 'found' | 'internal_use' | 'sample_use' | 'promo_use'
  | 'return_restock' | 'return_damaged' | 'production_received'
  | 'transfer_received' | 'transfer_sent' | 'other';

export type InventoryEventType =
  | 'adjustment' | 'reservation' | 'reservation_released' | 'fulfillment'
  | 'return_restock' | 'transfer_in' | 'transfer_out' | 'production_received'
  | 'incoming_received' | 'count_adjustment' | 'oversell' | 'pre_order_committed';

export type TransferStatus =
  | 'draft' | 'ready' | 'in_transit' | 'partially_received'
  | 'received' | 'cancelled' | 'discrepancy' | 'closed';

export type IncomingStatus =
  | 'planned' | 'ordered' | 'in_production' | 'ready_to_ship'
  | 'in_transit' | 'partially_received' | 'received' | 'delayed' | 'cancelled';

export type AlertLevel = 'attention' | 'low' | 'critical' | 'out_of_stock';

export type CountType = 'full' | 'location' | 'product' | 'cycle' | 'spot_check';
export type CountStatus = 'draft' | 'in_progress' | 'review_needed' | 'completed' | 'cancelled';

export type OversellPolicy = 'block' | 'allow' | 'convert_to_preorder';

export type ReturnDisposition = 'restock' | 'damaged' | 'unavailable' | 'return_to_manufacturer' | 'discard' | 'internal_use';

// ─── Location ─────────────────────────────────────────────────────────────────

export interface InventoryLocation {
  id: string;
  name: string;
  type: LocationType;
  address?: string;
  isPrimary: boolean;
  fulfillmentEnabled: boolean;
  isArchived: boolean;
  totalUnits: number;
  availableUnits: number;
  reservedUnits: number;
  incomingUnits: number;
  lowStockCount: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Inventory Level ──────────────────────────────────────────────────────────

export interface InventoryLevel {
  locationId: string;
  locationName: string;
  onHand: number;
  available: number;
  reserved: number;
  incoming: number;
  damaged: number;
  unavailable: number;
}

// ─── Inventory Item (per variant) ────────────────────────────────────────────

export interface InventoryItem {
  id: string;
  productId: string;
  productName: string;
  variantId: string;
  variantLabel: string; // e.g. "Black / L"
  sku: string;
  barcode?: string;
  cost: number;
  retailPrice: number;
  imageUri?: string;
  // Totals (sum across locations)
  onHand: number;
  available: number;
  reserved: number;
  incoming: number;
  committed: number; // pre-order commitments
  damaged: number;
  unavailable: number;
  // Thresholds
  lowStockThreshold: number;
  oversellPolicy: OversellPolicy;
  trackInventory: boolean;
  // Computed
  status: InventoryStatus;
  inventoryValue: number; // onHand * cost
  // Location breakdown
  levels: InventoryLevel[];
  // Linked data IDs
  fulfillmentType: 'seller' | 'manufacturer';
  manufacturerId?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Adjustment ───────────────────────────────────────────────────────────────

export interface InventoryAdjustment {
  id: string;
  itemId: string;
  productId: string;
  productName: string;
  variantLabel: string;
  locationId: string;
  locationName: string;
  type: AdjustmentType;
  quantityBefore: number;
  quantityChange: number;
  quantityAfter: number;
  availableBefore: number;
  availableAfter: number;
  inventoryValueImpact: number;
  reason: string;
  note?: string;
  referenceNumber?: string;
  teamMember: string;
  relatedOrderId?: string;
  relatedReturnId?: string;
  relatedTransferId?: string;
  relatedIncomingId?: string;
  createdAt: string;
}

// ─── Event ────────────────────────────────────────────────────────────────────

export interface InventoryEvent {
  id: string;
  itemId: string;
  productId: string;
  productName: string;
  variantLabel: string;
  locationId: string;
  locationName: string;
  type: InventoryEventType;
  quantityBefore: number;
  quantityChanged: number;
  quantityAfter: number;
  reason: string;
  source: string;
  relatedOrderId?: string;
  relatedReturnId?: string;
  relatedProductionId?: string;
  relatedTransferId?: string;
  teamMember: string;
  createdAt: string;
}

// ─── Transfer ─────────────────────────────────────────────────────────────────

export interface InventoryTransferItem {
  itemId: string;
  productId: string;
  productName: string;
  variantLabel: string;
  sku: string;
  quantitySent: number;
  quantityReceived: number;
  quantityDamaged: number;
  quantityMissing: number;
}

export interface InventoryTransfer {
  id: string;
  transferNumber: string;
  sourceLocationId: string;
  sourceLocationName: string;
  destinationLocationId: string;
  destinationLocationName: string;
  status: TransferStatus;
  items: InventoryTransferItem[];
  trackingNumber?: string;
  notes?: string;
  expectedArrival?: string;
  shippedAt?: string;
  receivedAt?: string;
  hasDiscrepancy: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Incoming ─────────────────────────────────────────────────────────────────

export interface IncomingInventory {
  id: string;
  source: 'manufacturer' | 'purchase_order' | 'transfer' | 'return_restock' | 'manual' | 'third_party';
  itemId: string;
  productId: string;
  productName: string;
  variantLabel: string;
  sku: string;
  quantity: number;
  receivedQuantity: number;
  damagedQuantity: number;
  expectedDate?: string;
  destinationLocationId: string;
  destinationLocationName: string;
  status: IncomingStatus;
  trackingNumber?: string;
  manufacturerId?: string;
  manufacturerName?: string;
  productionOrderId?: string;
  transferId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Receipt ─────────────────────────────────────────────────────────────────

export interface InventoryReceipt {
  id: string;
  incomingId: string;
  locationId: string;
  locationName: string;
  items: {
    itemId: string;
    productName: string;
    variantLabel: string;
    sku: string;
    expectedQuantity: number;
    receivedQuantity: number;
    damagedQuantity: number;
    missingQuantity: number;
    notes?: string;
  }[];
  hasDiscrepancy: boolean;
  teamMember: string;
  receivedAt: string;
}

// ─── Discrepancy ──────────────────────────────────────────────────────────────

export interface InventoryDiscrepancy {
  id: string;
  sourceId: string;
  sourceType: 'transfer' | 'incoming';
  itemId: string;
  productName: string;
  variantLabel: string;
  expected: number;
  actual: number;
  difference: number;
  type: 'shortage' | 'overage' | 'damage';
  resolution?: string;
  resolvedAt?: string;
  createdAt: string;
}

// ─── Alert ────────────────────────────────────────────────────────────────────

export interface InventoryAlert {
  id: string;
  itemId: string;
  productId: string;
  productName: string;
  variantLabel: string;
  sku: string;
  level: AlertLevel;
  available: number;
  reserved: number;
  incoming: number;
  threshold: number;
  recentSalesRate: number; // units/day (7-day avg)
  daysOfStockEstimate: number | null;
  suggestedRestockQty: number;
  isDismissed: boolean;
  isReviewed: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Reservation ─────────────────────────────────────────────────────────────

export interface InventoryReservation {
  id: string;
  itemId: string;
  locationId: string;
  orderId: string;
  quantity: number;
  status: 'active' | 'released' | 'fulfilled' | 'expired';
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Pre-order commitment ─────────────────────────────────────────────────────

export interface PreorderCommitment {
  id: string;
  itemId: string;
  productId: string;
  productName: string;
  variantLabel: string;
  orderId: string;
  customerId: string;
  quantity: number;
  fundingGoal?: number;
  productionTarget?: number;
  unitsInProduction: number;
  expectedAvailableUnits: number;
  expectedShipDate?: string;
  status: 'pending' | 'in_production' | 'ready' | 'fulfilled' | 'cancelled';
  createdAt: string;
}

// ─── Count ────────────────────────────────────────────────────────────────────

export interface InventoryCountItem {
  itemId: string;
  productName: string;
  variantLabel: string;
  sku: string;
  expectedQty: number;
  countedQty: number | null;
  discrepancy: number | null;
  notes?: string;
}

export interface InventoryCount {
  id: string;
  countNumber: string;
  type: CountType;
  status: CountStatus;
  locationId?: string;
  locationName?: string;
  items: InventoryCountItem[];
  totalItems: number;
  countedItems: number;
  discrepancyCount: number;
  teamMember: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Restock Recommendation ───────────────────────────────────────────────────

export interface RestockRecommendation {
  itemId: string;
  productId: string;
  productName: string;
  variantLabel: string;
  currentAvailable: number;
  reserved: number;
  incoming: number;
  lowStockThreshold: number;
  recentSalesRate: number; // units/day
  leadTimeDays: number;
  preOrderCommitments: number;
  suggestedQty: number;
  urgency: 'normal' | 'urgent' | 'critical';
  note: string; // human-readable explanation
}

// ─── Valuation ────────────────────────────────────────────────────────────────

export interface InventoryValuation {
  totalCostValue: number;
  availableCostValue: number;
  reservedCostValue: number;
  incomingCostValue: number;
  damagedCostValue: number;
  totalUnits: number;
  byProduct: {
    productId: string;
    productName: string;
    totalUnits: number;
    costValue: number;
  }[];
  calculatedAt: string;
}

// ─── Overview ─────────────────────────────────────────────────────────────────

export interface InventoryOverview {
  totalOnHand: number;
  totalAvailable: number;
  totalReserved: number;
  totalIncoming: number;
  totalCommitted: number;
  totalDamaged: number;
  lowStockCount: number;
  outOfStockCount: number;
  inventoryValue: number;
  locationCount: number;
  unitsInProduction: number;
  recentAdjustmentCount: number;
}

// ─── Filter/Group keys ────────────────────────────────────────────────────────

export type InventoryFilterKey =
  | 'all' | 'available' | 'low_stock' | 'out_of_stock' | 'incoming'
  | 'reserved' | 'pre_order' | 'damaged' | 'unavailable'
  | 'overselling' | 'seller_fulfilled' | 'manufacturer_fulfilled';

export type InventoryGroupKey = 'product' | 'variant' | 'location' | 'status' | 'manufacturer' | 'collection';

// ─── Constants ────────────────────────────────────────────────────────────────

export const ADJUSTMENT_TYPES: { key: AdjustmentType; label: string; delta: 1 | -1 | 0 }[] = [
  { key: 'received_stock',      label: 'Received stock',         delta:  1 },
  { key: 'manual_count',        label: 'Manual count',           delta:  0 },
  { key: 'correction',          label: 'Correction',             delta:  0 },
  { key: 'damage',              label: 'Damage',                 delta: -1 },
  { key: 'lost',                label: 'Lost',                   delta: -1 },
  { key: 'found',               label: 'Found',                  delta:  1 },
  { key: 'internal_use',        label: 'Internal use',           delta: -1 },
  { key: 'sample_use',          label: 'Sample use',             delta: -1 },
  { key: 'promo_use',           label: 'Promotional use',        delta: -1 },
  { key: 'return_restock',      label: 'Return restock',         delta:  1 },
  { key: 'return_damaged',      label: 'Return damaged',         delta:  0 },
  { key: 'production_received', label: 'Production received',    delta:  1 },
  { key: 'transfer_received',   label: 'Transfer received',      delta:  1 },
  { key: 'transfer_sent',       label: 'Transfer sent',          delta: -1 },
  { key: 'other',               label: 'Other',                  delta:  0 },
];

export const LOCATION_TYPES: { key: LocationType; label: string }[] = [
  { key: 'warehouse',    label: 'Warehouse' },
  { key: 'home_studio',  label: 'Home / Studio' },
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'third_party',  label: 'Third-party fulfillment' },
  { key: 'retail',       label: 'Retail location' },
  { key: 'pop_up',       label: 'Pop-up' },
  { key: 'returns',      label: 'Returns location' },
  { key: 'other',        label: 'Other' },
];
