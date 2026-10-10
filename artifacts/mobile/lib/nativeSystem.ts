/**
 * iOS system surfaces — the only file screens import for them:
 *  - Live Activities + Dynamic Island: buyer order tracking, seller live
 *  - Home Screen widgets: seller "Today", buyer "Thread Cash"
 *  - Home Screen quick actions (long-press the app icon)
 *
 * All of it needs a dev/production build (the `BrandthreadSystem` native
 * module + widget extension from plugins/with-upload-live-activity.js). In
 * Expo Go, on web and on Android every export is a silent no-op: nothing
 * throws, nothing logs.
 */
import { Platform } from 'react-native';
import { isExpoGo } from '@/lib/expoGoRuntime';
import { api } from '@/lib/api';
import {
  planOrderActivities, quickActionsFor,
  type OrderActivityState, type TrackableOrder,
} from '@/lib/nativeSystemLogic';

interface Subscription { remove(): void }

interface BrandthreadSystemModule {
  areLiveActivitiesEnabled(): boolean;
  startOrderActivity(options: {
    orderId: string; orderNumber: string; sellerName: string; thumbnailUri?: string;
    stage: string; statusText: string; etaEpoch?: number;
  }): Promise<void>;
  updateOrderActivity(orderId: string, state: { stage: string; statusText: string; etaEpoch?: number }): Promise<void>;
  endOrderActivity(orderId: string, state: { stage: string; statusText: string; etaEpoch?: number }): Promise<void>;
  activeOrderActivityIds(): string[];
  startLiveStreamActivity(streamId: string, title: string, state: LiveStats): Promise<void>;
  updateLiveStreamActivity(streamId: string, state: LiveStats): Promise<void>;
  endLiveStreamActivity(streamId: string, state: LiveStats): Promise<void>;
  setWidgetSnapshot(key: string, json: string, widgetKind: string): void;
  clearWidgetSnapshot(key: string, widgetKind: string): void;
  setQuickActions(items: { type: string; title: string; symbol: string }[]): void;
  takeInitialQuickAction(): string | null;
  addListener(event: 'onQuickAction', fn: (e: { type: string }) => void): Subscription;
  addListener(event: 'onLiveActivityPushToken', fn: (e: { kind: 'order' | 'live'; targetId: string; token: string }) => void): Subscription;
}

export interface LiveStats {
  viewers: number;
  salesCents: number;
  ordersCount: number;
  isLive: boolean;
}

let cached: BrandthreadSystemModule | null | undefined;

/** The native module, or null wherever it doesn't exist. */
export function getSystemModule(): BrandthreadSystemModule | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (Platform.OS !== 'ios' || isExpoGo()) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const core = require('expo-modules-core') as { requireOptionalNativeModule: (n: string) => BrandthreadSystemModule | null };
    cached = core.requireOptionalNativeModule('BrandthreadSystem') ?? null;
  } catch {
    cached = null;
  }
  return cached;
}

function quietly(run: () => unknown): void {
  try {
    const result = run();
    if (result && typeof (result as Promise<unknown>).catch === 'function') (result as Promise<unknown>).catch(() => {});
  } catch {
    // A system surface must never break the screen that feeds it.
  }
}

function stateArg(state: OrderActivityState) {
  return { stage: state.stage, statusText: state.statusText, ...(state.etaEpoch ? { etaEpoch: state.etaEpoch } : {}) };
}

// ─── Order tracking ───────────────────────────────────────────────────────────

/**
 * Brings the buyer's order Live Activities in line with their orders:
 * starts/updates one per order in transit (shipped → out for delivery),
 * ends it once delivered or cancelled. Call after orders load.
 */
export function syncOrderActivities(orders: TrackableOrder[]): void {
  const native = getSystemModule();
  if (!native) return;
  quietly(() => {
    if (!native.areLiveActivitiesEnabled()) return;
    for (const plan of planOrderActivities(orders, native.activeOrderActivityIds())) {
      if (plan.kind === 'start') {
        const thumb = plan.order.lineItems?.find((i) => i.imageUri)?.imageUri ?? undefined;
        quietly(() => native.startOrderActivity({
          orderId: plan.order.id,
          orderNumber: plan.order.orderNumber,
          sellerName: plan.order.sellerName,
          ...(thumb ? { thumbnailUri: thumb } : {}),
          ...stateArg(plan.state),
        }));
      } else {
        quietly(() => native.endOrderActivity(plan.orderId, stateArg(plan.state)));
      }
    }
  });
}

// ─── Live stream ──────────────────────────────────────────────────────────────

export function startLiveStreamActivity(streamId: string, title: string, stats: LiveStats): void {
  const native = getSystemModule();
  if (!native) return;
  quietly(() => native.areLiveActivitiesEnabled() && native.startLiveStreamActivity(streamId, title, stats));
}

export function updateLiveStreamActivity(streamId: string, stats: LiveStats): void {
  const native = getSystemModule();
  if (native) quietly(() => native.updateLiveStreamActivity(streamId, stats));
}

export function endLiveStreamActivity(streamId: string, stats: LiveStats): void {
  const native = getSystemModule();
  if (native) quietly(() => native.endLiveStreamActivity(streamId, { ...stats, isLive: false }));
}

// ─── Widgets ──────────────────────────────────────────────────────────────────

export function updateSellerTodayWidget(snapshot: {
  salesCents: number; ordersCount: number; toShipCount: number; currency?: string;
}): void {
  const native = getSystemModule();
  if (!native) return;
  quietly(() => native.setWidgetSnapshot(
    'sellerToday',
    JSON.stringify({ ...snapshot, updatedAt: Date.now() / 1000 }),
    'SellerTodayWidget',
  ));
}

export function updateBuyerCashWidget(snapshot: { balanceCents: number; streakDays: number; currency?: string }): void {
  const native = getSystemModule();
  if (!native) return;
  quietly(() => native.setWidgetSnapshot(
    'buyerCash',
    JSON.stringify({ ...snapshot, updatedAt: Date.now() / 1000 }),
    'BuyerCashWidget',
  ));
}

/** Sign-out / account switch: no one else's numbers stay on the Home Screen. */
export function clearHomeWidgets(): void {
  const native = getSystemModule();
  if (!native) return;
  quietly(() => native.clearWidgetSnapshot('sellerToday', 'SellerTodayWidget'));
  quietly(() => native.clearWidgetSnapshot('buyerCash', 'BuyerCashWidget'));
}

// ─── Quick actions ────────────────────────────────────────────────────────────

export function setQuickActionsForRole(role: 'seller' | 'buyer' | null): void {
  const native = getSystemModule();
  if (!native) return;
  quietly(() => native.setQuickActions(quickActionsFor(role).map(({ type, title, symbol }) => ({ type, title, symbol }))));
}

/** Calls `handler` for the shortcut the app was launched with and for every
 *  later one. Returns an unsubscribe function. */
export function subscribeQuickActions(handler: (type: string) => void): () => void {
  const native = getSystemModule();
  if (!native) return () => {};
  try {
    const initial = native.takeInitialQuickAction();
    if (initial) handler(initial);
    const sub = native.addListener('onQuickAction', (e) => handler(e.type));
    return () => sub.remove();
  } catch {
    return () => {};
  }
}

// ─── Live Activity push tokens → API ──────────────────────────────────────────

/** Registers each activity's APNs token with the API so the server can
 *  update it while the app is closed. Returns an unsubscribe function. */
export function subscribeLiveActivityTokens(): () => void {
  const native = getSystemModule();
  if (!native) return () => {};
  try {
    const sub = native.addListener('onLiveActivityPushToken', (e) => {
      void api.liveActivities.registerToken({ kind: e.kind, targetId: e.targetId, token: e.token }).catch(() => {});
    });
    return () => sub.remove();
  } catch {
    return () => {};
  }
}
