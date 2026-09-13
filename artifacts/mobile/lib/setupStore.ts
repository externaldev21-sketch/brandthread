/**
 * Brandthread Setup Store
 *
 * Persists seller guided-setup progress via AsyncStorage.
 * All reads/writes go through this module — no direct AsyncStorage calls in screens.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

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

function createDefaultState(): SetupState {
  return {
    started: false,
    dismissed: false,
    currentStep: null,
    tasks: DEFAULT_TASKS.map(t => ({ ...t, completed: false, skipped: false })),
    dismissedTips: [],
    openedFeatures: [],
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
  const validIds = new Set(DEFAULT_TASKS.map(t => t.id));
  const validTasks = persistedTasks
    .filter(t => t && typeof t === 'object' && validIds.has((t as SetupTask).id))
    .map(t => {
      const task = t as Partial<SetupTask>;
      return { ...task, completed: task.completed === true, skipped: task.skipped === true } as SetupTask;
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
    const next = applySellerOnboardingCompletion(state, options.onboardingComplete === true);
    if (next.started !== state.started || next.tasks.some((task, index) =>
      task.completed !== state.tasks[index]?.completed ||
      task.skipped !== state.tasks[index]?.skipped
    )) {
      await saveSetupState(next, resolvedUserId);
    }
    return next;
  } catch {
    return applySellerOnboardingCompletion(createDefaultState(), options.onboardingComplete === true);
  }
}

export async function saveSetupState(state: SetupState, userId?: string | null): Promise<void> {
  const resolvedUserId = userId ?? activeUserId;
  if (!resolvedUserId) return;
  try {
    await AsyncStorage.setItem(setupStorageKeyForUser(resolvedUserId), JSON.stringify({ ...state, lastUpdated: Date.now() }));
  } catch { /* non-fatal */ }
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

export async function completeTask(id: SetupTaskId, userId?: string | null): Promise<SetupState> {
  const state = await getSetupState(userId);
  const tasks = state.tasks.map(t => t.id === id ? { ...t, completed: true, skipped: false } : t);
  const nextIncomplete = tasks.find(t => !t.completed && !t.skipped);
  const next: SetupState = { ...state, tasks, currentStep: nextIncomplete?.id ?? null };
  await saveSetupState(next, userId);
  return next;
}

export async function skipTask(id: SetupTaskId, userId?: string | null): Promise<SetupState> {
  const state = await getSetupState(userId);
  const tasks = state.tasks.map(t => t.id === id ? { ...t, skipped: true } : t);
  const nextIncomplete = tasks.find(t => !t.completed && !t.skipped);
  const next: SetupState = { ...state, tasks, currentStep: nextIncomplete?.id ?? null };
  await saveSetupState(next, userId);
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
