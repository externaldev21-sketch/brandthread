/**
 * Brandthread Setup Store
 *
 * Seller guided-setup progress. The server is the source of truth
 * (GET/PUT /api/seller/launch-checklist/setup, stored on the storefront): tasks
 * backed by real data (payments, products, logo, publish, ...) are derived
 * there and can't be ticked by hand, and skips / tips / walkthrough flags
 * follow the seller to a new phone. AsyncStorage is only an offline cache.
 * All reads/writes go through this module — no direct AsyncStorage calls in screens.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadRemoteSetup, saveRemoteSetup, type RemoteSetup, type RemoteSetupStoredState } from '@/lib/setupRemote';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SetupTaskId =
  | 'verify_account'
  | 'connect_payments'
  | 'first_product'
  | 'shipping_rates'
  | 'customize_store'
  | 'connect_domain'
  | 'publish_store'
  | 'first_post'
  | 'connect_manufacturer';

export interface SetupTask {
  id: SetupTaskId;
  label: string;
  description: string;
  icon: string;
  route: string;
  optional?: boolean;
  completed: boolean;
  skipped: boolean;
}

export interface SetupState {
  started: boolean;           // has the seller started the guided setup?
  dismissed: boolean;         // dismissed the welcome card without starting?
  currentStep: SetupTaskId | null;
  tasks: SetupTask[];
  dismissedTips: string[];    // IDs of dismissed contextual tips
  openedFeatures: string[];   // IDs of features opened (clears "New" badge)
  walkthroughShown: boolean;  // has the guided walkthrough sheet been shown at least once?
  celebrated: boolean;        // has the 100% completion celebration already played?
  lastUpdated: number;
}

// ─── Default Task List ────────────────────────────────────────────────────────

const DEFAULT_TASKS: Omit<SetupTask, 'completed' | 'skipped'>[] = [
  {
    id: 'verify_account',
    // The ID is retained for persisted-state and completion-call
    // compatibility. Seller onboarding, not a later identity check, is what
    // gives a newly created seller the initial setup credit.
    label: 'Create your seller account',
    description: 'Finish seller signup and onboarding to open your workspace',
    // Existing verification screens still complete this legacy task ID for
    // sellers who enter setup before onboarding state has synced.
    icon: 'shield',
    route: '/seller-verification',
  },
  {
    id: 'connect_payments',
    label: 'Set up payments',
    description: 'Link Stripe Connect so you can receive payouts',
    icon: 'credit-card',
    // Payouts hub → Stripe Connect onboarding. Completion is read from
    // Stripe on the server, never ticked by hand.
    route: '/payouts',
  },
  {
    id: 'first_product',
    label: 'Add your first product',
    description: 'Create a product and add it to your catalog',
    icon: 'package',
    route: '/add-product',
  },
  {
    id: 'shipping_rates',
    label: 'Set up shipping rates',
    description: 'Configure your shipping zones and rates for buyers',
    icon: 'truck',
    route: '/shipping',
  },
  {
    id: 'customize_store',
    label: 'Customize your storefront',
    description: 'Choose your store colors, fonts and layout',
    icon: 'layout',
    route: '/store-builder',
  },
  {
    id: 'connect_domain',
    label: 'Connect a domain',
    description: 'Verify a custom domain you already own from a registrar',
    icon: 'globe',
    route: '/store-domain',
  },
  {
    id: 'publish_store',
    label: 'Publish your storefront',
    description: 'Make your store live and visible to buyers',
    icon: 'upload-cloud',
    route: '/store-publish',
  },
  {
    id: 'first_post',
    label: 'Post your first video',
    description: 'Share content to the Thread feed to attract buyers',
    icon: 'video',
    route: '/create-post',
  },
  {
    id: 'connect_manufacturer',
    label: 'Connect a manufacturer',
    description: 'Find or invite a manufacturer to produce your drops',
    icon: 'tool',
    route: '/manufacturer-hub',
    optional: true,
  },
];

/**
 * Tasks whose completion is derived from real account data on the server
 * (mirrors DERIVED_SETUP_TASK_IDS in the api-server). These cannot be marked
 * complete by hand — the seller has to actually do them.
 */
export const AUTO_TRACKED_TASK_IDS: readonly SetupTaskId[] = [
  'verify_account',
  'connect_payments',
  'first_product',
  'shipping_rates',
  'customize_store',
  'connect_domain',
  'publish_store',
  'first_post',
];

export function isAutoTrackedTask(id: SetupTaskId): boolean {
  return AUTO_TRACKED_TASK_IDS.includes(id);
}

function createDefaultState(): SetupState {
  return {
    started: false,
    dismissed: false,
    currentStep: null,
    tasks: DEFAULT_TASKS.map(t => ({ ...t, completed: false, skipped: false })),
    dismissedTips: [],
    openedFeatures: [],
    walkthroughShown: false,
    celebrated: false,
    lastUpdated: Date.now(),
  };
}

// ─── Storage Keys ─────────────────────────────────────────────────────────────

const LEGACY_KEY_SETUP = '@brandthread/setup_state';
const KEY_SETUP_PREFIX = '@brandthread/setup_state:';
let activeUserId: string | null = null;

export function setupStorageKeyForUser(userId: string): string {
  return `${KEY_SETUP_PREFIX}${userId}`;
}

export interface SetupStateOptions {
  /**
   * This must come from the authenticated server profile. Local role flags are
   * deliberately not accepted here: completing verification is meaningful
   * only after the seller onboarding transition has succeeded.
   */
  onboardingComplete?: boolean;
}

function normalizeState(value: unknown): SetupState {
  const parsed = value && typeof value === 'object' ? value as Partial<SetupState> : {};
  const persistedTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  const defById = new Map(DEFAULT_TASKS.map(t => [t.id, t]));
  // Only completed/skipped are read back from storage — label/description/icon
  // always come from DEFAULT_TASKS, never the persisted copy. A stored task
  // can be a bare {id, completed} shorthand (this is what the seller-preview
  // seed writes) or simply predate a copy change to DEFAULT_TASKS; either way
  // trusting its own label/description would show stale or blank text instead
  // of today's real copy.
  const validTasks = persistedTasks
    .filter(t => t && typeof t === 'object' && defById.has((t as SetupTask).id))
    .map(t => {
      const task = t as Partial<SetupTask>;
      const def = defById.get(task.id!)!;
      return { ...def, completed: task.completed === true, skipped: task.skipped === true };
    });
  const existingIds = new Set(validTasks.map(t => t.id));
  const newTasks = DEFAULT_TASKS
    .filter(t => !existingIds.has(t.id))
    .map(t => ({ ...t, completed: false, skipped: false }));
  const taskMap = new Map([...validTasks, ...newTasks].map(t => [t.id, t]));
  const tasks = DEFAULT_TASKS.map(def =>
    taskMap.get(def.id) ?? { ...def, completed: false, skipped: false },
  );

  return {
    started: parsed.started === true,
    dismissed: parsed.dismissed === true,
    currentStep: tasks.some(t => t.id === parsed.currentStep) ? parsed.currentStep! : null,
    tasks,
    dismissedTips: Array.isArray(parsed.dismissedTips)
      ? parsed.dismissedTips.filter((tip): tip is string => typeof tip === 'string')
      : [],
    openedFeatures: Array.isArray(parsed.openedFeatures)
      ? parsed.openedFeatures.filter((feature): feature is string => typeof feature === 'string')
      : [],
    walkthroughShown: parsed.walkthroughShown === true,
    celebrated: parsed.celebrated === true,
    lastUpdated: typeof parsed.lastUpdated === 'number' ? parsed.lastUpdated : Date.now(),
  };
}

function applySellerOnboardingCompletion(state: SetupState, onboardingComplete: boolean): SetupState {
  if (!onboardingComplete) return state;
  const tasks = state.tasks.map(task =>
    task.id === 'verify_account'
      ? { ...task, completed: true, skipped: false }
      : task,
  );
  return {
    ...state,
    // Completing seller onboarding is the first setup action, even when the
    // seller has not opened the guided checklist yet.
    started: true,
    dismissed: false,
    tasks,
    currentStep: tasks.find(task => !task.completed && !task.skipped)?.id ?? null,
  };
}

// ─── Read / Write ─────────────────────────────────────────────────────────────

export async function getSetupState(
  userId?: string | null,
  options: SetupStateOptions = {},
): Promise<SetupState> {
  // Never expose an unscoped setup record to an authenticated user (or let a
  // signed-out device accidentally inherit another seller's progress).
  if (userId === null) {
    activeUserId = null;
    return createDefaultState();
  }
  const resolvedUserId = userId ?? activeUserId;
  if (!resolvedUserId) return createDefaultState();
  activeUserId = resolvedUserId;

  try {
    const userKey = setupStorageKeyForUser(resolvedUserId);
    let raw = await AsyncStorage.getItem(userKey);

    // Migrate the one old unscoped record only when this user has no record.
    // Write first and remove second so a failed migration cannot lose progress.
    if (!raw) {
      const legacy = await AsyncStorage.getItem(LEGACY_KEY_SETUP);
      if (legacy) {
        try {
          await AsyncStorage.setItem(userKey, legacy);
          await AsyncStorage.removeItem(LEGACY_KEY_SETUP);
          raw = legacy;
        } catch {
          // Keep the legacy value for a later retry. It is never read without
          // an authenticated user ID.
          raw = legacy;
        }
      }
    }

    const state = raw ? normalizeState(JSON.parse(raw)) : createDefaultState();

    let remote: RemoteSetup | null = null;
    try {
      remote = await loadRemoteSetup();
    } catch {
      remote = null; // offline: fall back to the cached copy below
    }
    if (remote) {
      // One-time carry-over: a seller whose progress so far lived only on this
      // phone keeps their skips/flags the first time the server is empty.
      if (isPristineRemote(remote.state) && hasLocalProgress(state)) {
        try {
          remote = (await saveRemoteSetup(toRemoteState(state))) ?? remote;
        } catch { /* keep the server copy; retried next load */ }
      }
      const merged = applyRemoteSetup(state, remote);
      await writeCache(merged, resolvedUserId);
      return merged;
    }

    const next = applySellerOnboardingCompletion(state, options.onboardingComplete === true);
    if (next.started !== state.started || next.tasks.some((task, index) =>
      task.completed !== state.tasks[index]?.completed ||
      task.skipped !== state.tasks[index]?.skipped
    )) {
      await writeCache(next, resolvedUserId);
    }
    return next;
  } catch {
    return applySellerOnboardingCompletion(createDefaultState(), options.onboardingComplete === true);
  }
}

function isPristineRemote(state: RemoteSetupStoredState): boolean {
  return !state.started && !state.dismissed && !state.walkthroughShown && !state.celebrated &&
    state.dismissedTips.length === 0 && state.openedFeatures.length === 0 &&
    Object.keys(state.tasks ?? {}).length === 0;
}

function hasLocalProgress(state: SetupState): boolean {
  return state.started || state.dismissed || state.walkthroughShown || state.celebrated ||
    state.dismissedTips.length > 0 || state.openedFeatures.length > 0 ||
    state.tasks.some(t => t.skipped || (t.completed && !isAutoTrackedTask(t.id)));
}

/** The per-seller part the server stores (derived completion is never sent). */
export function toRemoteState(state: SetupState): RemoteSetupStoredState {
  const tasks: RemoteSetupStoredState['tasks'] = {};
  for (const t of state.tasks) {
    const entry: { completed?: boolean; skipped?: boolean } = {};
    if (t.skipped && !t.completed) entry.skipped = true;
    if (t.completed && !isAutoTrackedTask(t.id)) entry.completed = true;
    if (entry.skipped || entry.completed) tasks[t.id] = entry;
  }
  return {
    started: state.started,
    dismissed: state.dismissed,
    walkthroughShown: state.walkthroughShown,
    celebrated: state.celebrated,
    dismissedTips: state.dismissedTips,
    openedFeatures: state.openedFeatures,
    tasks,
  };
}

/**
 * Builds the screen state from the server: derived done flags win, stored
 * skips/flags come from the server copy, and tasks follow the goal-based order.
 */
export function applyRemoteSetup(local: SetupState, remote: RemoteSetup): SetupState {
  const stored = remote.state;
  const byId = new Map(local.tasks.map(t => [t.id, t]));
  const orderIds = [
    ...remote.order.filter((id): id is SetupTaskId => byId.has(id as SetupTaskId)),
    ...local.tasks.map(t => t.id).filter(id => !remote.order.includes(id)),
  ];
  const tasks = orderIds.map(id => {
    const task = byId.get(id)!;
    const derivedValue = remote.derived[id];
    const completed = typeof derivedValue === 'boolean'
      ? derivedValue
      : stored.tasks?.[id]?.completed === true;
    const skipped = !completed && stored.tasks?.[id]?.skipped === true;
    return { ...task, completed, skipped };
  });
  const started = stored.started || tasks.some(t => t.completed);
  return {
    started,
    dismissed: stored.dismissed && !started,
    currentStep: tasks.find(t => !t.completed && !t.skipped)?.id ?? null,
    tasks,
    dismissedTips: stored.dismissedTips ?? [],
    openedFeatures: stored.openedFeatures ?? [],
    walkthroughShown: stored.walkthroughShown,
    celebrated: stored.celebrated,
    lastUpdated: Date.now(),
  };
}

async function writeCache(state: SetupState, userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(setupStorageKeyForUser(userId), JSON.stringify({ ...state, lastUpdated: Date.now() }));
  } catch { /* non-fatal */ }
}

export interface SaveSetupOptions {
  /** Throw when the server save fails (screens that show the error). */
  throwOnSyncError?: boolean;
}

export async function saveSetupState(
  state: SetupState,
  userId?: string | null,
  options: SaveSetupOptions = {},
): Promise<void> {
  const resolvedUserId = userId ?? activeUserId;
  if (!resolvedUserId) return;
  await writeCache(state, resolvedUserId);
  try {
    await saveRemoteSetup(toRemoteState(state));
  } catch (error) {
    if (options.throwOnSyncError) throw error;
  }
}

export async function markSetupStarted(userId?: string | null): Promise<SetupState> {
  const state = await getSetupState(userId);
  const next: SetupState = {
    ...state,
    started: true,
    dismissed: false,
    currentStep: state.tasks.find(t => !t.completed && !t.skipped)?.id ?? null,
  };
  await saveSetupState(next, userId);
  return next;
}

export async function dismissWelcome(userId?: string | null): Promise<SetupState> {
  const state = await getSetupState(userId);
  const next: SetupState = { ...state, dismissed: true };
  await saveSetupState(next, userId);
  return next;
}

export async function markWalkthroughShown(userId?: string | null): Promise<SetupState> {
  const state = await getSetupState(userId);
  if (state.walkthroughShown) return state;
  const next: SetupState = { ...state, walkthroughShown: true };
  await saveSetupState(next, userId);
  return next;
}

export async function markCelebrated(userId?: string | null): Promise<SetupState> {
  const state = await getSetupState(userId);
  if (state.celebrated) return state;
  const next: SetupState = { ...state, celebrated: true };
  await saveSetupState(next, userId);
  return next;
}

/**
 * Records a task as done. For an auto-tracked task this is only an optimistic
 * local hint after the real action succeeded — the server ignores it and the
 * next load shows the derived value.
 */
export async function completeTask(
  id: SetupTaskId,
  userId?: string | null,
  options: SaveSetupOptions = {},
): Promise<SetupState> {
  const state = await getSetupState(userId);
  const tasks = state.tasks.map(t => t.id === id ? { ...t, completed: true, skipped: false } : t);
  const nextIncomplete = tasks.find(t => !t.completed && !t.skipped);
  const next: SetupState = { ...state, tasks, currentStep: nextIncomplete?.id ?? null };
  await saveSetupState(next, userId, options);
  return next;
}

export async function skipTask(
  id: SetupTaskId,
  userId?: string | null,
  options: SaveSetupOptions = {},
): Promise<SetupState> {
  const state = await getSetupState(userId);
  const tasks = state.tasks.map(t => t.id === id ? { ...t, skipped: true } : t);
  const nextIncomplete = tasks.find(t => !t.completed && !t.skipped);
  const next: SetupState = { ...state, tasks, currentStep: nextIncomplete?.id ?? null };
  await saveSetupState(next, userId, options);
  return next;
}

export async function dismissTip(tipId: string, userId?: string | null): Promise<void> {
  const state = await getSetupState(userId);
  if (state.dismissedTips.includes(tipId)) return;
  await saveSetupState({ ...state, dismissedTips: [...state.dismissedTips, tipId] }, userId);
}

export async function markFeatureOpened(featureId: string, userId?: string | null): Promise<void> {
  const state = await getSetupState(userId);
  if (state.openedFeatures.includes(featureId)) return;
  await saveSetupState({ ...state, openedFeatures: [...state.openedFeatures, featureId] }, userId);
}

// ─── Computed helpers ─────────────────────────────────────────────────────────

export function completionPercent(state: SetupState): number {
  const required = state.tasks.filter(t => !t.optional);
  if (!required.length) return 0;
  const done = required.filter(t => t.completed).length;
  return Math.round((done / required.length) * 100);
}

export function requiredTaskCount(state: SetupState): number {
  return state.tasks.filter(task => !task.optional).length;
}

export function completedRequiredTaskCount(state: SetupState): number {
  return state.tasks.filter(task => !task.optional && task.completed).length;
}

export function isSetupComplete(state: SetupState): boolean {
  return requiredTaskCount(state) > 0 &&
    completedRequiredTaskCount(state) === requiredTaskCount(state);
}

export function nextTask(state: SetupState): SetupTask | null {
  return state.tasks.find(t => !t.completed && !t.skipped) ?? null;
}

export function nextBestAction(state: SetupState): { label: string; route: string } {
  const next = nextTask(state);
  if (!next) return { label: 'View your brand dashboard', route: '/(tabs)/profile' };

  const actions: Partial<Record<SetupTaskId, string>> = {
    verify_account:       'Create your seller account',
    connect_payments:     'Connect payouts before you can earn',
    first_product:        'Create your first product',
    shipping_rates:       'Configure your shipping rates',
    customize_store:      'Customize your store layout',
    connect_domain:       'Connect a custom domain',
    publish_store:        'Your store is ready — publish it',
    first_post:           'Create your first Seller post',
    connect_manufacturer: 'Add a manufacturer to your network',
  };

  return {
    label: actions[next.id] ?? next.label,
    route: next.route,
  };
}

export async function resetSetupState(userId?: string | null): Promise<void> {
  if (userId) await AsyncStorage.removeItem(setupStorageKeyForUser(userId));
  await AsyncStorage.removeItem(LEGACY_KEY_SETUP);
}
