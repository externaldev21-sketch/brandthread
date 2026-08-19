/**
 * Brandthread Inventory Service — AsyncStorage-backed persistence.
 * Single source of truth for all inventory quantities and events.
 * Starts empty; data is created by sellers via adjustments/transfers/incoming.
 * Real API failures propagate; no demo seed data substituted.
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

/** One-time migration marker — written after legacy demo records are purged. */
const INV_MIGRATION_V1_KEY = 'inv:migration_v1_demo_purged';

// ─── Known legacy demo IDs (seeded in v1 demo build) ─────────────────────────
// These exact IDs are removed on first run to clear stale demo data from devices
// that ran the previous demo build. Legitimate user-created records are never
// affected because user records receive random IDs from uid().

const LEGACY_DEMO_ITEM_IDS        = new Set(['inv_001','inv_002','inv_003','inv_004','inv_005','inv_006']);
const LEGACY_DEMO_ADJUSTMENT_IDS  = new Set(['adj_001','adj_002']);
const LEGACY_DEMO_EVENT_IDS       = new Set(['evt_001','evt_002']);
const LEGACY_DEMO_TRANSFER_IDS    = new Set(['trf_001']);
const LEGACY_DEMO_INCOMING_IDS    = new Set(['inc_001','inc_002']);
const LEGACY_DEMO_ALERT_IDS       = new Set(['alr_001','alr_002']);
const LEGACY_DEMO_LOCATION_IDS    = new Set(['loc_main','loc_studio']);

// ─── Utilities ────────────────────────────────────────────────────────────────

function uid(): string { return Math.random().toString(36).slice(2, 11); }
function now(): string { return new Date().toISOString(); }
function daysFromNow(n: number): string {
  const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString();
}

function computeStatus(item: InventoryItem): InventoryStatus {
  if (item.onHand === 0 && item.committed > 0) return 'pre_order';
  if (item.available === 0) return 'out_of_stock';
  if (item.available <= item.lowStockThreshold) return 'low_stock';
  if (item.reserved > 0 && item.available === 0) return 'reserved';
  if (item.incoming > 0 && item.available === 0) return 'incoming';
  return 'available';
}

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

  // One-time migration: remove known legacy demo records on existing devices.
  // Uses exact known IDs so no user-created record is ever removed.
  const migrated = await AsyncStorage.getItem(INV_MIGRATION_V1_KEY).catch(() => null);
  if (!migrated) {
    try {
      const pairs = await AsyncStorage.multiGet(Object.values(KEYS));
      const updates: [string, string][] = [];
      pairs.forEach(([k, v]) => {
        if (!v) return;
        try {
          const arr: any[] = JSON.parse(v);
          let filtered: any[];
          if (k === KEYS.items)            filtered = arr.filter((x: any) => !LEGACY_DEMO_ITEM_IDS.has(x.id));
          else if (k === KEYS.adjustments) filtered = arr.filter((x: any) => !LEGACY_DEMO_ADJUSTMENT_IDS.has(x.id));
          else if (k === KEYS.events)      filtered = arr.filter((x: any) => !LEGACY_DEMO_EVENT_IDS.has(x.id));
          else if (k === KEYS.transfers)   filtered = arr.filter((x: any) => !LEGACY_DEMO_TRANSFER_IDS.has(x.id));
          else if (k === KEYS.incoming)    filtered = arr.filter((x: any) => !LEGACY_DEMO_INCOMING_IDS.has(x.id));
          else if (k === KEYS.alerts)      filtered = arr.filter((x: any) => !LEGACY_DEMO_ALERT_IDS.has(x.id));
          else if (k === KEYS.locations)   filtered = arr.filter((x: any) => !LEGACY_DEMO_LOCATION_IDS.has(x.id));
          else return; // reservations, preorders, counts — no legacy demo data
          if (filtered.length !== arr.length) updates.push([k, JSON.stringify(filtered)]);
        } catch { /* skip malformed entry */ }
      });
      if (updates.length > 0) await AsyncStorage.multiSet(updates);
    } catch { /* non-fatal */ }
    await AsyncStorage.setItem(INV_MIGRATION_V1_KEY, '1').catch(() => {});
  }

  try {
    const pairs = await AsyncStorage.multiGet(Object.values(KEYS));
    const map: Record<string, string | null> = {};
    pairs.forEach(([k, v]) => { map[k] = v; });

    _items        = map[KEYS.items]        ? JSON.parse(map[KEYS.items]!)        : [];
    _locations    = map[KEYS.locations]    ? JSON.parse(map[KEYS.locations]!)    : [];
    _adjustments  = map[KEYS.adjustments]  ? JSON.parse(map[KEYS.adjustments]!)  : [];
    _events       = map[KEYS.events]       ? JSON.parse(map[KEYS.events]!)       : [];
    _transfers    = map[KEYS.transfers]    ? JSON.parse(map[KEYS.transfers]!)    : [];
    _incoming     = map[KEYS.incoming]     ? JSON.parse(map[KEYS.incoming]!)     : [];
    _alerts       = map[KEYS.alerts]       ? JSON.parse(map[KEYS.alerts]!)       : [];
    _reservations = map[KEYS.reservations] ? JSON.parse(map[KEYS.reservations]!) : [];
    _preorders    = map[KEYS.preorders]    ? JSON.parse(map[KEYS.preorders]!)    : [];
    _counts       = map[KEYS.counts]       ? JSON.parse(map[KEYS.counts]!)       : [];
  } catch {
    // All stores start empty on error — no demo fallback
    _items = []; _locations = []; _adjustments = []; _events = [];
    _transfers = []; _incoming = []; _alerts = [];
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
    locationId: item.levels[0]?.locationId ?? 'unassigned',
    locationName: item.levels[0]?.locationName ?? 'Unassigned',
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
      locationName: 'VS Fulfillment — LA',
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
      locationCount:         0,
      unitsInProduction:     0,
      recentAdjustmentCount: 0,
    } as InventoryOverview;
  } catch (error) {
    throw error;
  }
}

// ─── Public API — Items ───────────────────────────────────────────────────────

export async function getInventoryItems(): Promise<InventoryItem[]> {
  const rows = await serviceRequest<any[]>('/api/inventory');
  _items = rows.map(apiRowToInventoryItem);
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
    itemId, locationId: _locations.find(l => l.isPrimary)?.id ?? 'unassigned',
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
        locationId: count.locationId ?? _locations.find(l => l.isPrimary)?.id ?? 'unassigned',
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
        note: `Based on ~${salesRate} units/day × ${leadDays}-day lead time (Vault Studio avg). Estimate only.`,
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
