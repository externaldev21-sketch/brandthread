/**
 * Brandthread Inventory Service — demo layer with AsyncStorage persistence.
 * Single source of truth for all inventory quantities and events.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { serviceRequest } from '../lib/serviceConfig';
import {
  InventoryItem, InventoryLevel, InventoryLocation, InventoryAdjustment,
  InventoryEvent, InventoryTransfer, InventoryTransferItem,
  IncomingInventory, InventoryReceipt, InventoryDiscrepancy,
  InventoryAlert, InventoryReservation, PreorderCommitment,
  InventoryCount, InventoryCountItem, RestockRecommendation,
  InventoryValuation, InventoryOverview,
  InventoryStatus, AdjustmentType, IncomingStatus, TransferStatus,
  AlertLevel, OversellPolicy, LocationType, CountType, CountStatus,
  InventoryFilterKey,
} from './inventoryTypes';

// ─── Storage keys ─────────────────────────────────────────────────────────────

const KEYS = {
  items:       'inv:items:v1',
  locations:   'inv:locations:v1',
  adjustments: 'inv:adjustments:v1',
  events:      'inv:events:v1',
  transfers:   'inv:transfers:v1',
  incoming:    'inv:incoming:v1',
  alerts:      'inv:alerts:v1',
  reservations:'inv:reservations:v1',
  preorders:   'inv:preorders:v1',
  counts:      'inv:counts:v1',
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

function computeStatus(item: InventoryItem): InventoryStatus {
  if (item.onHand === 0 && item.committed > 0) return 'pre_order';
  if (item.available === 0) return 'out_of_stock';
  if (item.available <= item.lowStockThreshold) return 'low_stock';
  if (item.reserved > 0 && item.available === 0) return 'reserved';
  if (item.incoming > 0 && item.available === 0) return 'incoming';
  return 'available';
}

// ─── Demo seed data ───────────────────────────────────────────────────────────

const DEFAULT_LOCATION: InventoryLocation = {
  id: 'loc_main', name: 'Main Warehouse', type: 'warehouse',
  address: '123 Commerce St, Los Angeles, CA 90001',
  isPrimary: true, fulfillmentEnabled: true, isArchived: false,
  totalUnits: 247, availableUnits: 198, reservedUnits: 32,
  incomingUnits: 17, lowStockCount: 2,
  createdAt: daysAgo(30), updatedAt: now(),
};

const STUDIO_LOCATION: InventoryLocation = {
  id: 'loc_studio', name: 'Home Studio', type: 'home_studio',
  address: '456 Creator Ave, Los Angeles, CA 90010',
  isPrimary: false, fulfillmentEnabled: true, isArchived: false,
  totalUnits: 43, availableUnits: 38, reservedUnits: 5,
  incomingUnits: 0, lowStockCount: 1,
  createdAt: daysAgo(20), updatedAt: now(),
};

function makeLevel(locationId: string, locationName: string, onHand: number, reserved = 0, incoming = 0, damaged = 0): InventoryLevel {
  return { locationId, locationName, onHand, available: Math.max(0, onHand - reserved), reserved, incoming, damaged, unavailable: 0 };
}

const DEMO_ITEMS: InventoryItem[] = [
  {
    id: 'inv_001', productId: 'p1', productName: 'Oversized Hoodie', variantId: 'v1a',
    variantLabel: 'Black / L', sku: 'HOD-BLK-L', barcode: '094922356789',
    cost: 28, retailPrice: 98, onHand: 42, available: 35, reserved: 7, incoming: 0,
    committed: 0, damaged: 0, unavailable: 0, lowStockThreshold: 10,
    oversellPolicy: 'block', trackInventory: true, status: 'available',
    inventoryValue: 42 * 28, fulfillmentType: 'seller',
    levels: [makeLevel('loc_main', 'Main Warehouse', 30, 7), makeLevel('loc_studio', 'Home Studio', 12, 0)],
    createdAt: daysAgo(30), updatedAt: now(),
  },
  {
    id: 'inv_002', productId: 'p1', productName: 'Oversized Hoodie', variantId: 'v1b',
    variantLabel: 'Black / M', sku: 'HOD-BLK-M', barcode: '094922356790',
    cost: 28, retailPrice: 98, onHand: 8, available: 6, reserved: 2, incoming: 15,
    committed: 0, damaged: 0, unavailable: 0, lowStockThreshold: 10,
    oversellPolicy: 'block', trackInventory: true, status: 'low_stock',
    inventoryValue: 8 * 28, fulfillmentType: 'seller',
    levels: [makeLevel('loc_main', 'Main Warehouse', 8, 2, 15)],
    createdAt: daysAgo(30), updatedAt: now(),
  },
  {
    id: 'inv_003', productId: 'p1', productName: 'Oversized Hoodie', variantId: 'v1c',
    variantLabel: 'Grey / XL', sku: 'HOD-GRY-XL', barcode: '094922356791',
    cost: 28, retailPrice: 98, onHand: 0, available: 0, reserved: 0, incoming: 0,
    committed: 0, damaged: 0, unavailable: 0, lowStockThreshold: 10,
    oversellPolicy: 'block', trackInventory: true, status: 'out_of_stock',
    inventoryValue: 0, fulfillmentType: 'seller',
    levels: [makeLevel('loc_main', 'Main Warehouse', 0)],
    createdAt: daysAgo(30), updatedAt: now(),
  },
  {
    id: 'inv_004', productId: 'p2', productName: 'Logo Tee', variantId: 'v2a',
    variantLabel: 'White / M', sku: 'TEE-WHT-M', barcode: '094922356792',
    cost: 8, retailPrice: 32, onHand: 85, available: 78, reserved: 7, incoming: 0,
    committed: 0, damaged: 2, unavailable: 0, lowStockThreshold: 15,
    oversellPolicy: 'allow', trackInventory: true, status: 'available',
    inventoryValue: 85 * 8, fulfillmentType: 'seller',
    levels: [makeLevel('loc_main', 'Main Warehouse', 55, 7, 0, 2), makeLevel('loc_studio', 'Home Studio', 30, 0)],
    createdAt: daysAgo(25), updatedAt: now(),
  },
  {
    id: 'inv_005', productId: 'p3', productName: 'Track Jacket', variantId: 'v3a',
    variantLabel: 'Navy / L', sku: 'TRK-NVY-L', barcode: '094922356793',
    cost: 45, retailPrice: 145, onHand: 0, available: 0, reserved: 0, incoming: 0,
    committed: 12, damaged: 0, unavailable: 0, lowStockThreshold: 5,
    oversellPolicy: 'convert_to_preorder', trackInventory: true, status: 'pre_order',
    inventoryValue: 0, fulfillmentType: 'manufacturer', manufacturerId: 'mfg_001',
    levels: [],
    createdAt: daysAgo(14), updatedAt: now(),
  },
  {
    id: 'inv_006', productId: 'p4', productName: 'Vintage Cap', variantId: 'v4a',
    variantLabel: 'Washed Black / One Size', sku: 'CAP-BLK-OS', barcode: '094922356794',
    cost: 12, retailPrice: 45, onHand: 120, available: 115, reserved: 5, incoming: 30,
    committed: 0, damaged: 0, unavailable: 0, lowStockThreshold: 20,
    oversellPolicy: 'block', trackInventory: true, status: 'available',
    inventoryValue: 120 * 12, fulfillmentType: 'seller',
    levels: [makeLevel('loc_main', 'Main Warehouse', 120, 5, 30)],
    createdAt: daysAgo(20), updatedAt: now(),
  },
];

const DEMO_ADJUSTMENTS: InventoryAdjustment[] = [
  {
    id: 'adj_001', itemId: 'inv_001', productId: 'p1', productName: 'Oversized Hoodie',
    variantLabel: 'Black / L', locationId: 'loc_main', locationName: 'Main Warehouse',
    type: 'received_stock', quantityBefore: 30, quantityChange: 12, quantityAfter: 42,
    availableBefore: 23, availableAfter: 35, inventoryValueImpact: 12 * 28,
    reason: 'Received from supplier', teamMember: 'Seller', createdAt: daysAgo(3),
  },
  {
    id: 'adj_002', itemId: 'inv_004', productId: 'p2', productName: 'Logo Tee',
    variantLabel: 'White / M', locationId: 'loc_main', locationName: 'Main Warehouse',
    type: 'damage', quantityBefore: 87, quantityChange: -2, quantityAfter: 85,
    availableBefore: 80, availableAfter: 78, inventoryValueImpact: -2 * 8,
    reason: 'Water damage during storage', teamMember: 'Seller', createdAt: daysAgo(5),
  },
];

const DEMO_EVENTS: InventoryEvent[] = [
  {
    id: 'evt_001', itemId: 'inv_001', productId: 'p1', productName: 'Oversized Hoodie',
    variantLabel: 'Black / L', locationId: 'loc_main', locationName: 'Main Warehouse',
    type: 'adjustment', quantityBefore: 30, quantityChanged: 12, quantityAfter: 42,
    reason: 'Received stock', source: 'Manual adjustment', teamMember: 'Seller', createdAt: daysAgo(3),
  },
  {
    id: 'evt_002', itemId: 'inv_001', productId: 'p1', productName: 'Oversized Hoodie',
    variantLabel: 'Black / L', locationId: 'loc_main', locationName: 'Main Warehouse',
    type: 'reservation', quantityBefore: 42, quantityChanged: -7, quantityAfter: 35,
    reason: 'Order #1042 reserved 7 units', source: 'Order', relatedOrderId: 'ord_001',
    teamMember: 'System', createdAt: daysAgo(1),
  },
];

const DEMO_TRANSFERS: InventoryTransfer[] = [
  {
    id: 'trf_001', transferNumber: 'TRF-0001',
    sourceLocationId: 'loc_main', sourceLocationName: 'Main Warehouse',
    destinationLocationId: 'loc_studio', destinationLocationName: 'Home Studio',
    status: 'in_transit',
    items: [
      { itemId: 'inv_001', productId: 'p1', productName: 'Oversized Hoodie', variantLabel: 'Black / L', sku: 'HOD-BLK-L', quantitySent: 5, quantityReceived: 0, quantityDamaged: 0, quantityMissing: 0 },
    ],
    trackingNumber: 'UPS1234567890', notes: 'Replenishing studio stock',
    expectedArrival: daysFromNow(2), shippedAt: daysAgo(1),
    hasDiscrepancy: false, createdAt: daysAgo(2), updatedAt: now(),
  },
];

const DEMO_INCOMING: IncomingInventory[] = [
  {
    id: 'inc_001', source: 'manufacturer',
    itemId: 'inv_002', productId: 'p1', productName: 'Oversized Hoodie',
    variantLabel: 'Black / M', sku: 'HOD-BLK-M', quantity: 15, receivedQuantity: 0, damagedQuantity: 0,
    expectedDate: daysFromNow(5),
    destinationLocationId: 'loc_main', destinationLocationName: 'Main Warehouse',
    status: 'in_transit', trackingNumber: 'FDX9876543210',
    manufacturerId: 'mfg_001', manufacturerName: 'Apex Apparel Co.',
    productionOrderId: 'prod_001',
    createdAt: daysAgo(7), updatedAt: now(),
  },
  {
    id: 'inc_002', source: 'manufacturer',
    itemId: 'inv_006', productId: 'p4', productName: 'Vintage Cap',
    variantLabel: 'Washed Black / One Size', sku: 'CAP-BLK-OS', quantity: 30, receivedQuantity: 0, damagedQuantity: 0,
    expectedDate: daysFromNow(12),
    destinationLocationId: 'loc_main', destinationLocationName: 'Main Warehouse',
    status: 'in_production',
    manufacturerId: 'mfg_001', manufacturerName: 'Apex Apparel Co.',
    createdAt: daysAgo(3), updatedAt: now(),
  },
];

const DEMO_ALERTS: InventoryAlert[] = [
  {
    id: 'alr_001', itemId: 'inv_002', productId: 'p1', productName: 'Oversized Hoodie',
    variantLabel: 'Black / M', sku: 'HOD-BLK-M',
    level: 'low', available: 6, reserved: 2, incoming: 15, threshold: 10,
    recentSalesRate: 1.4, daysOfStockEstimate: 4, suggestedRestockQty: 20,
    isDismissed: false, isReviewed: false, createdAt: daysAgo(1), updatedAt: now(),
  },
  {
    id: 'alr_002', itemId: 'inv_003', productId: 'p1', productName: 'Oversized Hoodie',
    variantLabel: 'Grey / XL', sku: 'HOD-GRY-XL',
    level: 'out_of_stock', available: 0, reserved: 0, incoming: 0, threshold: 10,
    recentSalesRate: 0.8, daysOfStockEstimate: null, suggestedRestockQty: 15,
    isDismissed: false, isReviewed: false, createdAt: daysAgo(2), updatedAt: now(),
  },
];

// ─── In-memory store ──────────────────────────────────────────────────────────

let _init = false;
let _items:       InventoryItem[]        = [];
let _locations:   InventoryLocation[]    = [];
let _adjustments: InventoryAdjustment[]  = [];
let _events:      InventoryEvent[]       = [];
let _transfers:   InventoryTransfer[]    = [];
let _incoming:    IncomingInventory[]    = [];
let _alerts:      InventoryAlert[]       = [];
let _reservations:InventoryReservation[] = [];
let _preorders:   PreorderCommitment[]   = [];
let _counts:      InventoryCount[]       = [];

async function persist() {
  await AsyncStorage.multiSet([
    [KEYS.items,        JSON.stringify(_items)],
    [KEYS.locations,    JSON.stringify(_locations)],
    [KEYS.adjustments,  JSON.stringify(_adjustments)],
    [KEYS.events,       JSON.stringify(_events)],
    [KEYS.transfers,    JSON.stringify(_transfers)],
    [KEYS.incoming,     JSON.stringify(_incoming)],
    [KEYS.alerts,       JSON.stringify(_alerts)],
    [KEYS.reservations, JSON.stringify(_reservations)],
    [KEYS.preorders,    JSON.stringify(_preorders)],
    [KEYS.counts,       JSON.stringify(_counts)],
  ]);
}

async function ensureInitialized() {
  if (_init) return;
  _init = true;
  try {
    const pairs = await AsyncStorage.multiGet(Object.values(KEYS));
    const map: Record<string, string | null> = {};
    pairs.forEach(([k, v]) => { map[k] = v; });

    _items       = map[KEYS.items]        ? JSON.parse(map[KEYS.items]!)        : DEMO_ITEMS;
    _locations   = map[KEYS.locations]    ? JSON.parse(map[KEYS.locations]!)    : [DEFAULT_LOCATION, STUDIO_LOCATION];
    _adjustments = map[KEYS.adjustments]  ? JSON.parse(map[KEYS.adjustments]!)  : DEMO_ADJUSTMENTS;
    _events      = map[KEYS.events]       ? JSON.parse(map[KEYS.events]!)       : DEMO_EVENTS;
    _transfers   = map[KEYS.transfers]    ? JSON.parse(map[KEYS.transfers]!)    : DEMO_TRANSFERS;
    _incoming    = map[KEYS.incoming]     ? JSON.parse(map[KEYS.incoming]!)     : DEMO_INCOMING;
    _alerts      = map[KEYS.alerts]       ? JSON.parse(map[KEYS.alerts]!)       : DEMO_ALERTS;
    _reservations= map[KEYS.reservations] ? JSON.parse(map[KEYS.reservations]!) : [];
    _preorders   = map[KEYS.preorders]    ? JSON.parse(map[KEYS.preorders]!)    : [];
    _counts      = map[KEYS.counts]       ? JSON.parse(map[KEYS.counts]!)       : [];

    // Seed AsyncStorage on first run
    if (!map[KEYS.items]) await persist();
  } catch {
    _items = DEMO_ITEMS;
    _locations = [DEFAULT_LOCATION, STUDIO_LOCATION];
    _adjustments = DEMO_ADJUSTMENTS;
    _events = DEMO_EVENTS;
    _transfers = DEMO_TRANSFERS;
    _incoming = DEMO_INCOMING;
    _alerts = DEMO_ALERTS;
  }
}

function addEvent(
  item: InventoryItem, type: InventoryEvent['type'],
  qBefore: number, qChanged: number, qAfter: number,
  reason: string, source: string,
  refs?: { orderId?: string; returnId?: string; transferId?: string; productionId?: string }
) {
  _events.unshift({
    id: 'evt_' + uid(), itemId: item.id, productId: item.productId,
    productName: item.productName, variantLabel: item.variantLabel,
    locationId: item.levels[0]?.locationId ?? 'loc_main',
    locationName: item.levels[0]?.locationName ?? 'Main Warehouse',
    type, quantityBefore: qBefore, quantityChanged: qChanged, quantityAfter: qAfter,
    reason, source,
    relatedOrderId: refs?.orderId,
    relatedReturnId: refs?.returnId,
    relatedTransferId: refs?.transferId,
    relatedProductionId: refs?.productionId,
    teamMember: 'Seller', createdAt: now(),
  });
}

// ─── API → local type adapter ─────────────────────────────────────────────────

function apiRowToInventoryItem(row: any): InventoryItem {
  return {
    id:               row.variantId,
    productId:        row.productId,
    productName:      row.productName,
    variantId:        row.variantId,
    variantLabel:     row.variantLabel ?? row.sku,
    sku:              row.sku,
    barcode:          undefined,
    onHand:           row.stock,
    available:        row.stock,
    reserved:         0,
    committed:        0,
    incoming:         0,
    damaged:          0,
    unavailable:      0,
    lowStockThreshold: row.lowStockThreshold,
    status:           row.status as InventoryStatus,
    inventoryValue:   row.stock * ((row.priceCents ?? 0) / 100),
    oversellPolicy:   'deny' as OversellPolicy,
    isTracked:        true,
    isContinuouslySynced: false,
    fulfillmentType:  'seller' as any,
    levels: [{
      locationId:   'default',
      locationName: 'Default Location',
      onHand:       row.stock,
      available:    row.stock,
      reserved:     0,
      incoming:     0,
      damaged:      0,
      unavailable:  0,
    }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as InventoryItem;
}

// ─── Public API — Overview ─────────────────────────────────────────────────────

export async function getInventoryOverview(): Promise<InventoryOverview> {
  try {
    const rows = await serviceRequest<any[]>('/api/inventory');
    return {
      totalOnHand:           rows.reduce((s, r) => s + r.stock, 0),
      totalAvailable:        rows.reduce((s, r) => s + r.stock, 0),
      totalReserved:         0,
      totalIncoming:         0,
      totalCommitted:        0,
      totalDamaged:          0,
      lowStockCount:         rows.filter(r => r.status === 'low_stock').length,
      outOfStockCount:       rows.filter(r => r.status === 'out_of_stock').length,
      inventoryValue:        rows.reduce((s, r) => s + r.stock * ((r.priceCents ?? 0) / 100), 0),
      locationCount:         1,
      unitsInProduction:     0,
      recentAdjustmentCount: 0,
    } as InventoryOverview;
  } catch { /* fall through to local */ }
  await ensureInitialized();
  const items = _items;
  return {
    totalOnHand:     items.reduce((s, i) => s + i.onHand,    0),
    totalAvailable:  items.reduce((s, i) => s + i.available, 0),
    totalReserved:   items.reduce((s, i) => s + i.reserved,  0),
    totalIncoming:   items.reduce((s, i) => s + i.incoming,  0),
    totalCommitted:  items.reduce((s, i) => s + i.committed, 0),
    totalDamaged:    items.reduce((s, i) => s + i.damaged,   0),
    lowStockCount:   items.filter(i => i.status === 'low_stock').length,
    outOfStockCount: items.filter(i => i.status === 'out_of_stock').length,
    inventoryValue:  items.reduce((s, i) => s + i.inventoryValue, 0),
    locationCount:   _locations.filter(l => !l.isArchived).length,
    unitsInProduction: _incoming.filter(i => i.status === 'in_production').reduce((s, i) => s + i.quantity, 0),
    recentAdjustmentCount: _adjustments.filter(a => {
      const d = new Date(a.createdAt);
      const week = new Date(); week.setDate(week.getDate() - 7);
      return d > week;
    }).length,
  };
}

// ─── Public API — Items ───────────────────────────────────────────────────────

export async function getInventoryItems(): Promise<InventoryItem[]> {
  try {
    const rows = await serviceRequest<any[]>('/api/inventory');
    _items = rows.map(apiRowToInventoryItem);
    return [..._items];
  } catch { /* fall through to local */ }
  await ensureInitialized();
  return [..._items];
}

export async function getInventoryItem(id: string): Promise<InventoryItem | undefined> {
  await ensureInitialized();
  return _items.find(i => i.id === id);
}

export async function getItemsByProduct(productId: string): Promise<InventoryItem[]> {
  await ensureInitialized();
  return _items.filter(i => i.productId === productId);
}

export async function searchInventory(query: string): Promise<InventoryItem[]> {
  await ensureInitialized();
  const q = query.toLowerCase().trim();
  if (!q) return [..._items];
  return _items.filter(i =>
    i.productName.toLowerCase().includes(q) ||
    i.variantLabel.toLowerCase().includes(q) ||
    i.sku.toLowerCase().includes(q) ||
    (i.barcode ?? '').includes(q)
  );
}

export function filterInventory(items: InventoryItem[], filter: InventoryFilterKey): InventoryItem[] {
  switch (filter) {
    case 'all':                    return items;
    case 'available':              return items.filter(i => i.status === 'available');
    case 'low_stock':              return items.filter(i => i.status === 'low_stock');
    case 'out_of_stock':           return items.filter(i => i.status === 'out_of_stock');
    case 'incoming':               return items.filter(i => i.incoming > 0);
    case 'reserved':               return items.filter(i => i.reserved > 0);
    case 'pre_order':              return items.filter(i => i.status === 'pre_order' || i.committed > 0);
    case 'damaged':                return items.filter(i => i.damaged > 0);
    case 'unavailable':            return items.filter(i => i.unavailable > 0);
    case 'overselling':            return items.filter(i => i.oversellPolicy !== 'block');
    case 'seller_fulfilled':       return items.filter(i => i.fulfillmentType === 'seller');
    case 'manufacturer_fulfilled': return items.filter(i => i.fulfillmentType === 'manufacturer');
    default:                       return items;
  }
}

// ─── Public API — Adjustments ─────────────────────────────────────────────────

export async function adjustStock(params: {
  itemId: string;
  locationId: string;
  type: AdjustmentType;
  quantityChange: number;
  reason: string;
  note?: string;
  referenceNumber?: string;
  relatedOrderId?: string;
  relatedReturnId?: string;
  relatedTransferId?: string;
}): Promise<InventoryAdjustment | undefined> {
  await ensureInitialized();
  const item = _items.find(i => i.id === params.itemId);
  if (!item) return undefined;

  const qBefore = item.onHand;
  const newOnHand = Math.max(0, item.onHand + params.quantityChange);
  const adj: InventoryAdjustment = {
    id: 'adj_' + uid(),
    itemId: params.itemId,
    productId: item.productId,
    productName: item.productName,
    variantLabel: item.variantLabel,
    locationId: params.locationId,
    locationName: _locations.find(l => l.id === params.locationId)?.name ?? params.locationId,
    type: params.type,
    quantityBefore: qBefore,
    quantityChange: params.quantityChange,
    quantityAfter: newOnHand,
    availableBefore: item.available,
    availableAfter: Math.max(0, item.available + params.quantityChange),
    inventoryValueImpact: params.quantityChange * item.cost,
    reason: params.reason,
    note: params.note,
    referenceNumber: params.referenceNumber,
    teamMember: 'Seller',
    relatedOrderId: params.relatedOrderId,
    relatedReturnId: params.relatedReturnId,
    relatedTransferId: params.relatedTransferId,
    createdAt: now(),
  };

  // Update item
  item.onHand = newOnHand;
  item.available = Math.max(0, item.available + params.quantityChange);
  item.inventoryValue = item.onHand * item.cost;
  item.status = computeStatus(item);
  item.updatedAt = now();

  // Handle damage type
  if (params.type === 'damage' || params.type === 'return_damaged') {
    item.damaged += Math.abs(params.quantityChange);
  }

  _adjustments.unshift(adj);
  addEvent(item, 'adjustment', qBefore, params.quantityChange, newOnHand, params.reason, 'Manual adjustment', {
    orderId: params.relatedOrderId, returnId: params.relatedReturnId, transferId: params.relatedTransferId,
  });

  // Regenerate alerts
  regenerateAlerts(item);
  await persist();
  return adj;
}

export async function getAdjustments(itemId?: string): Promise<InventoryAdjustment[]> {
  await ensureInitialized();
  if (itemId) return _adjustments.filter(a => a.itemId === itemId);
  return [..._adjustments];
}

// ─── Public API — Events ──────────────────────────────────────────────────────

export async function getEvents(itemId?: string): Promise<InventoryEvent[]> {
  await ensureInitialized();
  const evts = itemId ? _events.filter(e => e.itemId === itemId) : [..._events];
  return evts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ─── Public API — Locations ───────────────────────────────────────────────────

export async function getLocations(): Promise<InventoryLocation[]> {
  await ensureInitialized();
  return _locations.filter(l => !l.isArchived);
}

export async function addLocation(data: {
  name: string; type: LocationType; address?: string; fulfillmentEnabled?: boolean;
}): Promise<InventoryLocation> {
  await ensureInitialized();
  const loc: InventoryLocation = {
    id: 'loc_' + uid(), name: data.name, type: data.type, address: data.address,
    isPrimary: _locations.filter(l => !l.isArchived).length === 0,
    fulfillmentEnabled: data.fulfillmentEnabled ?? true, isArchived: false,
    totalUnits: 0, availableUnits: 0, reservedUnits: 0, incomingUnits: 0, lowStockCount: 0,
    createdAt: now(), updatedAt: now(),
  };
  _locations.push(loc);
  await persist();
  return loc;
}

export async function updateLocation(id: string, data: Partial<Pick<InventoryLocation, 'name' | 'type' | 'address' | 'fulfillmentEnabled' | 'isPrimary'>>): Promise<InventoryLocation | undefined> {
  await ensureInitialized();
  const loc = _locations.find(l => l.id === id);
  if (!loc) return undefined;
  if (data.isPrimary) _locations.forEach(l => { l.isPrimary = false; });
  Object.assign(loc, data);
  loc.updatedAt = now();
  await persist();
  return loc;
}

export async function archiveLocation(id: string): Promise<void> {
  await ensureInitialized();
  const loc = _locations.find(l => l.id === id);
  if (loc) { loc.isArchived = true; loc.updatedAt = now(); }
  await persist();
}

// ─── Public API — Transfers ───────────────────────────────────────────────────

export async function getTransfers(): Promise<InventoryTransfer[]> {
  await ensureInitialized();
  return [..._transfers].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getTransfer(id: string): Promise<InventoryTransfer | undefined> {
  await ensureInitialized();
  return _transfers.find(t => t.id === id);
}

export async function createTransfer(data: {
  sourceLocationId: string;
  destinationLocationId: string;
  items: { itemId: string; quantity: number }[];
  notes?: string;
  expectedArrival?: string;
}): Promise<InventoryTransfer> {
  await ensureInitialized();
  const srcLoc = _locations.find(l => l.id === data.sourceLocationId);
  const dstLoc = _locations.find(l => l.id === data.destinationLocationId);
  const num = 'TRF-' + String(_transfers.length + 1).padStart(4, '0');

  const items: InventoryTransferItem[] = data.items.map(d => {
    const item = _items.find(i => i.id === d.itemId);
    return {
      itemId: d.itemId,
      productId: item?.productId ?? '',
      productName: item?.productName ?? '',
      variantLabel: item?.variantLabel ?? '',
      sku: item?.sku ?? '',
      quantitySent: d.quantity,
      quantityReceived: 0, quantityDamaged: 0, quantityMissing: 0,
    };
  });

  const transfer: InventoryTransfer = {
    id: 'trf_' + uid(), transferNumber: num,
    sourceLocationId: data.sourceLocationId,
    sourceLocationName: srcLoc?.name ?? data.sourceLocationId,
    destinationLocationId: data.destinationLocationId,
    destinationLocationName: dstLoc?.name ?? data.destinationLocationId,
    status: 'draft', items,
    notes: data.notes, expectedArrival: data.expectedArrival,
    hasDiscrepancy: false, createdAt: now(), updatedAt: now(),
  };
  _transfers.unshift(transfer);
  await persist();
  return transfer;
}

export async function shipTransfer(id: string, trackingNumber?: string): Promise<InventoryTransfer | undefined> {
  await ensureInitialized();
  const t = _transfers.find(x => x.id === id);
  if (!t) return undefined;
  t.status = 'in_transit';
  t.shippedAt = now();
  if (trackingNumber) t.trackingNumber = trackingNumber;
  t.updatedAt = now();
  await persist();
  return t;
}

export async function receiveTransfer(id: string, receipts: { itemId: string; received: number; damaged: number }[]): Promise<InventoryTransfer | undefined> {
  await ensureInitialized();
  const t = _transfers.find(x => x.id === id);
  if (!t) return undefined;

  let hasDiscrepancy = false;
  receipts.forEach(r => {
    const ti = t.items.find(i => i.itemId === r.itemId);
    if (!ti) return;
    ti.quantityReceived = r.received;
    ti.quantityDamaged  = r.damaged;
    ti.quantityMissing  = ti.quantitySent - r.received - r.damaged;
    if (ti.quantityMissing !== 0) hasDiscrepancy = true;

    // Add to destination inventory
    const item = _items.find(i => i.id === r.itemId);
    if (item && r.received > 0) {
      const qBefore = item.onHand;
      item.onHand += r.received;
      item.available += r.received;
      item.inventoryValue = item.onHand * item.cost;
      item.status = computeStatus(item);
      item.updatedAt = now();
      addEvent(item, 'transfer_in', qBefore, r.received, item.onHand, `Received from transfer ${t.transferNumber}`, 'Transfer', { transferId: id });
    }
  });

  t.status = hasDiscrepancy ? 'discrepancy' : 'received';
  t.hasDiscrepancy = hasDiscrepancy;
  t.receivedAt = now();
  t.updatedAt = now();
  await persist();
  return t;
}

// ─── Public API — Incoming ────────────────────────────────────────────────────

export async function getIncoming(status?: IncomingStatus): Promise<IncomingInventory[]> {
  await ensureInitialized();
  const list = status ? _incoming.filter(i => i.status === status) : [..._incoming];
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createIncoming(data: {
  source: IncomingInventory['source'];
  itemId: string;
  quantity: number;
  expectedDate?: string;
  destinationLocationId: string;
  manufacturerId?: string;
  manufacturerName?: string;
  productionOrderId?: string;
  notes?: string;
}): Promise<IncomingInventory | undefined> {
  await ensureInitialized();
  const item = _items.find(i => i.id === data.itemId);
  if (!item) return undefined;
  const loc = _locations.find(l => l.id === data.destinationLocationId);

  const rec: IncomingInventory = {
    id: 'inc_' + uid(),
    source: data.source,
    itemId: data.itemId,
    productId: item.productId,
    productName: item.productName,
    variantLabel: item.variantLabel,
    sku: item.sku,
    quantity: data.quantity,
    receivedQuantity: 0, damagedQuantity: 0,
    expectedDate: data.expectedDate,
    destinationLocationId: data.destinationLocationId,
    destinationLocationName: loc?.name ?? data.destinationLocationId,
    status: 'planned',
    manufacturerId: data.manufacturerId,
    manufacturerName: data.manufacturerName,
    productionOrderId: data.productionOrderId,
    notes: data.notes,
    createdAt: now(), updatedAt: now(),
  };

  item.incoming += data.quantity;
  item.updatedAt = now();
  _incoming.unshift(rec);
  await persist();
  return rec;
}

export async function updateIncomingStatus(id: string, status: IncomingStatus, trackingNumber?: string): Promise<IncomingInventory | undefined> {
  await ensureInitialized();
  const rec = _incoming.find(i => i.id === id);
  if (!rec) return undefined;
  rec.status = status;
  if (trackingNumber) rec.trackingNumber = trackingNumber;
  rec.updatedAt = now();
  await persist();
  return rec;
}

export async function receiveIncoming(id: string, receivedQty: number, damagedQty: number): Promise<IncomingInventory | undefined> {
  await ensureInitialized();
  const rec = _incoming.find(i => i.id === id);
  if (!rec) return undefined;
  const item = _items.find(i => i.id === rec.itemId);

  rec.receivedQuantity += receivedQty;
  rec.damagedQuantity  += damagedQty;
  const allReceived = rec.receivedQuantity + rec.damagedQuantity >= rec.quantity;
  rec.status = allReceived ? 'received' : 'partially_received';
  rec.updatedAt = now();

  if (item && receivedQty > 0) {
    const qBefore = item.onHand;
    item.onHand    += receivedQty;
    item.available += receivedQty;
    item.incoming   = Math.max(0, item.incoming - receivedQty - damagedQty);
    if (damagedQty > 0) item.damaged += damagedQty;
    item.inventoryValue = item.onHand * item.cost;
    item.status = computeStatus(item);
    item.updatedAt = now();
    addEvent(item, 'incoming_received', qBefore, receivedQty, item.onHand, `Received incoming from ${rec.manufacturerName ?? rec.source}`, 'Incoming');
    regenerateAlerts(item);
  }
  await persist();
  return rec;
}

// ─── Public API — Alerts ──────────────────────────────────────────────────────

function regenerateAlerts(item: InventoryItem) {
  const existing = _alerts.find(a => a.itemId === item.id);
  if (item.available > item.lowStockThreshold && item.available > 0) {
    // Remove alert if now healthy
    if (existing) _alerts = _alerts.filter(a => a.itemId !== item.id);
    return;
  }
  const level: AlertLevel = item.available === 0 ? 'out_of_stock'
    : item.available <= Math.floor(item.lowStockThreshold / 2) ? 'critical'
    : 'low';
  const salesRate = 1.2;
  const daysEst = salesRate > 0 ? Math.floor(item.available / salesRate) : null;
  const alert: InventoryAlert = {
    id: existing?.id ?? 'alr_' + uid(),
    itemId: item.id, productId: item.productId, productName: item.productName,
    variantLabel: item.variantLabel, sku: item.sku, level,
    available: item.available, reserved: item.reserved, incoming: item.incoming,
    threshold: item.lowStockThreshold, recentSalesRate: salesRate,
    daysOfStockEstimate: daysEst, suggestedRestockQty: Math.max(0, item.lowStockThreshold * 3 - item.available - item.incoming),
    isDismissed: existing?.isDismissed ?? false, isReviewed: false,
    createdAt: existing?.createdAt ?? now(), updatedAt: now(),
  };
  if (existing) {
    Object.assign(existing, alert);
  } else {
    _alerts.push(alert);
  }
}

export async function getAlerts(): Promise<InventoryAlert[]> {
  await ensureInitialized();
  return _alerts.filter(a => !a.isDismissed).sort((a, b) => {
    const order: Record<AlertLevel, number> = { out_of_stock: 0, critical: 1, low: 2, attention: 3 };
    return order[a.level] - order[b.level];
  });
}

export async function dismissAlert(id: string): Promise<void> {
  await ensureInitialized();
  const a = _alerts.find(x => x.id === id);
  if (a) { a.isDismissed = true; a.updatedAt = now(); }
  await persist();
}

export async function updateThreshold(itemId: string, threshold: number): Promise<void> {
  await ensureInitialized();
  const item = _items.find(i => i.id === itemId);
  if (!item) return;
  item.lowStockThreshold = threshold;
  item.status = computeStatus(item);
  item.updatedAt = now();
  regenerateAlerts(item);
  await persist();
}

export async function updateOversellPolicy(itemId: string, policy: OversellPolicy): Promise<void> {
  await ensureInitialized();
  const item = _items.find(i => i.id === itemId);
  if (!item) return;
  item.oversellPolicy = policy;
  item.status = computeStatus(item);
  item.updatedAt = now();
  await persist();
}

// ─── Public API — Reservations ────────────────────────────────────────────────

export async function reserveInventory(itemId: string, locationId: string, orderId: string, quantity: number): Promise<InventoryReservation | undefined> {
  await ensureInitialized();
  const item = _items.find(i => i.id === itemId);
  if (!item || item.available < quantity) return undefined;

  const res: InventoryReservation = {
    id: 'res_' + uid(), itemId, locationId, orderId, quantity,
    status: 'active', expiresAt: daysFromNow(2), createdAt: now(), updatedAt: now(),
  };
  item.reserved  += quantity;
  item.available  = Math.max(0, item.available - quantity);
  item.status = computeStatus(item);
  item.updatedAt = now();
  _reservations.push(res);
  addEvent(item, 'reservation', item.available + quantity, -quantity, item.available, `Reserved for order`, 'Order', { orderId });
  await persist();
  return res;
}

export async function releaseReservation(reservationId: string): Promise<void> {
  await ensureInitialized();
  const res = _reservations.find(r => r.id === reservationId);
  if (!res || res.status !== 'active') return;
  const item = _items.find(i => i.id === res.itemId);
  if (item) {
    const qBefore = item.available;
    item.reserved   = Math.max(0, item.reserved - res.quantity);
    item.available += res.quantity;
    item.status = computeStatus(item);
    item.updatedAt = now();
    addEvent(item, 'reservation_released', qBefore, res.quantity, item.available, 'Reservation released', 'Order', { orderId: res.orderId });
    regenerateAlerts(item);
  }
  res.status = 'released';
  res.updatedAt = now();
  await persist();
}

// ─── Public API — Pre-order ───────────────────────────────────────────────────

export async function commitPreorder(itemId: string, orderId: string, customerId: string, quantity: number, productionTarget?: number): Promise<PreorderCommitment | undefined> {
  await ensureInitialized();
  const item = _items.find(i => i.id === itemId);
  if (!item) return undefined;

  const commit: PreorderCommitment = {
    id: 'pre_' + uid(), itemId, productId: item.productId,
    productName: item.productName, variantLabel: item.variantLabel,
    orderId, customerId, quantity,
    productionTarget: productionTarget ?? quantity,
    unitsInProduction: 0, expectedAvailableUnits: quantity,
    status: 'pending', createdAt: now(),
  };
  item.committed += quantity;
  item.status = computeStatus(item);
  item.updatedAt = now();
  _preorders.push(commit);
  addEvent(item, 'pre_order_committed', item.committed - quantity, quantity, item.committed, `Pre-order committed for order`, 'Order', { orderId });
  await persist();
  return commit;
}

// ─── Public API — Returns ─────────────────────────────────────────────────────

export async function processReturnInventory(itemId: string, quantity: number, disposition: import('./inventoryTypes').ReturnDisposition, returnId: string): Promise<void> {
  await ensureInitialized();
  let type: AdjustmentType;
  switch (disposition) {
    case 'restock':       type = 'return_restock'; break;
    case 'damaged':       type = 'return_damaged';  break;
    default:              type = 'other'; break;
  }
  await adjustStock({
    itemId, locationId: _locations.find(l => l.isPrimary)?.id ?? 'loc_main',
    type, quantityChange: disposition === 'restock' ? quantity : 0,
    reason: `Return processed — ${disposition}`, relatedReturnId: returnId,
  });
}

// ─── Public API — Counts ──────────────────────────────────────────────────────

export async function getCounts(): Promise<InventoryCount[]> {
  await ensureInitialized();
  return [..._counts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createCount(type: CountType, locationId?: string, itemIds?: string[]): Promise<InventoryCount> {
  await ensureInitialized();
  const num = 'CNT-' + String(_counts.length + 1).padStart(4, '0');
  const loc = locationId ? _locations.find(l => l.id === locationId) : undefined;
  const targetItems = itemIds ? _items.filter(i => itemIds.includes(i.id)) : (locationId ? _items.filter(i => i.levels.some(l => l.locationId === locationId)) : _items);

  const countItems: InventoryCountItem[] = targetItems.map(i => ({
    itemId: i.id, productName: i.productName, variantLabel: i.variantLabel, sku: i.sku,
    expectedQty: i.onHand, countedQty: null, discrepancy: null,
  }));

  const count: InventoryCount = {
    id: 'cnt_' + uid(), countNumber: num, type, status: 'draft',
    locationId, locationName: loc?.name,
    items: countItems, totalItems: countItems.length, countedItems: 0, discrepancyCount: 0,
    teamMember: 'Seller', createdAt: now(), updatedAt: now(),
  };
  _counts.unshift(count);
  await persist();
  return count;
}

export async function updateCountItem(countId: string, itemId: string, countedQty: number, notes?: string): Promise<InventoryCount | undefined> {
  await ensureInitialized();
  const count = _counts.find(c => c.id === countId);
  if (!count) return undefined;
  const ci = count.items.find(i => i.itemId === itemId);
  if (!ci) return undefined;

  ci.countedQty = countedQty;
  ci.discrepancy = countedQty - ci.expectedQty;
  if (notes) ci.notes = notes;

  count.countedItems = count.items.filter(i => i.countedQty !== null).length;
  count.discrepancyCount = count.items.filter(i => i.discrepancy !== null && i.discrepancy !== 0).length;
  if (count.status === 'draft') { count.status = 'in_progress'; count.startedAt = now(); }
  count.updatedAt = now();
  await persist();
  return count;
}

export async function completeCount(countId: string): Promise<InventoryCount | undefined> {
  await ensureInitialized();
  const count = _counts.find(c => c.id === countId);
  if (!count) return undefined;

  // Apply discrepancies as corrections
  for (const ci of count.items) {
    if (ci.countedQty !== null && ci.discrepancy !== null && ci.discrepancy !== 0) {
      await adjustStock({
        itemId: ci.itemId,
        locationId: count.locationId ?? _locations.find(l => l.isPrimary)?.id ?? 'loc_main',
        type: 'manual_count',
        quantityChange: ci.discrepancy,
        reason: `Inventory count ${count.countNumber}`,
      });
    }
  }
  count.status = count.discrepancyCount > 0 ? 'review_needed' : 'completed';
  count.completedAt = now();
  count.updatedAt = now();
  await persist();
  return count;
}

// ─── Public API — Valuation ───────────────────────────────────────────────────

export async function getValuation(): Promise<InventoryValuation> {
  await ensureInitialized();
  const productMap: Record<string, { productId: string; productName: string; totalUnits: number; costValue: number }> = {};
  for (const item of _items) {
    if (!productMap[item.productId]) productMap[item.productId] = { productId: item.productId, productName: item.productName, totalUnits: 0, costValue: 0 };
    productMap[item.productId].totalUnits += item.onHand;
    productMap[item.productId].costValue  += item.inventoryValue;
  }
  return {
    totalCostValue:    _items.reduce((s, i) => s + i.inventoryValue, 0),
    availableCostValue:_items.reduce((s, i) => s + i.available * i.cost, 0),
    reservedCostValue: _items.reduce((s, i) => s + i.reserved  * i.cost, 0),
    incomingCostValue: _items.reduce((s, i) => s + i.incoming  * i.cost, 0),
    damagedCostValue:  _items.reduce((s, i) => s + i.damaged   * i.cost, 0),
    totalUnits: _items.reduce((s, i) => s + i.onHand, 0),
    byProduct: Object.values(productMap),
    calculatedAt: now(),
  };
}

// ─── Public API — Restock Recommendations ────────────────────────────────────

export function getRestockRecommendations(items: InventoryItem[]): RestockRecommendation[] {
  return items
    .filter(i => i.available <= i.lowStockThreshold || i.status === 'out_of_stock')
    .map(i => {
      const salesRate = 1.2;
      const leadDays = 14;
      const needed = Math.ceil(salesRate * leadDays) + i.lowStockThreshold;
      const toOrder = Math.max(0, needed - i.available - i.incoming);
      return {
        itemId: i.id, productId: i.productId, productName: i.productName,
        variantLabel: i.variantLabel,
        currentAvailable: i.available, reserved: i.reserved, incoming: i.incoming,
        lowStockThreshold: i.lowStockThreshold, recentSalesRate: salesRate,
        leadTimeDays: leadDays, preOrderCommitments: i.committed,
        suggestedQty: toOrder,
        urgency: i.available === 0 ? 'critical' : i.available <= Math.floor(i.lowStockThreshold / 2) ? 'urgent' : 'normal',
        note: `Based on ~${salesRate} units/day × ${leadDays}-day lead time. Estimate only.`,
      } as RestockRecommendation;
    });
}

// ─── Public API — Export ──────────────────────────────────────────────────────

export async function exportInventoryCsv(items?: InventoryItem[]): Promise<string> {
  await ensureInitialized();
  const src = items ?? _items;
  const header = 'Product,Variant,SKU,On Hand,Available,Reserved,Incoming,Damaged,Value,Status';
  const rows = src.map(i =>
    [i.productName, i.variantLabel, i.sku, i.onHand, i.available, i.reserved, i.incoming, i.damaged,
     `$${i.inventoryValue.toFixed(2)}`, i.status].join(',')
  );
  return [header, ...rows].join('\n');
}

// ─── Public API — Seller Home Stats ──────────────────────────────────────────

export async function getInventoryStats(): Promise<{
  lowStockCount: number;
  outOfStockCount: number;
  incomingCount: number;
  delayedCount: number;
  returnsAwaitingInspection: number;
}> {
  await ensureInitialized();
  return {
    lowStockCount: _alerts.filter(a => !a.isDismissed && a.level !== 'out_of_stock').length,
    outOfStockCount: _alerts.filter(a => !a.isDismissed && a.level === 'out_of_stock').length,
    incomingCount: _incoming.filter(i => ['in_transit', 'partially_received'].includes(i.status)).length,
    delayedCount: _incoming.filter(i => i.status === 'delayed').length,
    returnsAwaitingInspection: 0, // Linked from orderService in practice
  };
}
