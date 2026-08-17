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
    label: 'Verify your account',
    description: 'Complete Stripe Identity verification to start selling',
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

const DEFAULT_STATE: SetupState = {
  started: false,
  dismissed: false,
  currentStep: null,
  tasks: DEFAULT_TASKS.map(t => ({ ...t, completed: false, skipped: false })),
  dismissedTips: [],
  openedFeatures: [],
  lastUpdated: Date.now(),
};

// ─── Storage Keys ─────────────────────────────────────────────────────────────

const KEY_SETUP = '@brandthread/setup_state';

// ─── Read / Write ─────────────────────────────────────────────────────────────

export async function getSetupState(): Promise<SetupState> {
  try {
    const raw = await AsyncStorage.getItem(KEY_SETUP);
    if (!raw) return DEFAULT_STATE;
    const parsed: SetupState = JSON.parse(raw);
    // Only retain tasks whose IDs still exist in DEFAULT_TASKS. This lets us
    // rename or remove task IDs across app versions without corrupt persisted state.
    const validIds = new Set(DEFAULT_TASKS.map(t => t.id));
    const validTasks = (parsed.tasks ?? []).filter(t => validIds.has(t.id as SetupTaskId));
    const existingIds = new Set(validTasks.map(t => t.id));
    const newTasks = DEFAULT_TASKS
      .filter(t => !existingIds.has(t.id))
      .map(t => ({ ...t, completed: false, skipped: false }));
    // Preserve DEFAULT_TASKS display order
    const taskMap = new Map([...validTasks, ...newTasks].map(t => [t.id, t]));
    const mergedTasks = DEFAULT_TASKS.map(def =>
      taskMap.get(def.id) ?? { ...def, completed: false, skipped: false }
    );
    return { ...parsed, tasks: mergedTasks };
  } catch {
    return DEFAULT_STATE;
  }
}

export async function saveSetupState(state: SetupState): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_SETUP, JSON.stringify({ ...state, lastUpdated: Date.now() }));
  } catch { /* non-fatal */ }
}

export async function markSetupStarted(): Promise<SetupState> {
  const state = await getSetupState();
  const next: SetupState = {
    ...state,
    started: true,
    dismissed: false,
    currentStep: state.tasks.find(t => !t.completed && !t.skipped)?.id ?? null,
  };
  await saveSetupState(next);
  return next;
}

export async function dismissWelcome(): Promise<SetupState> {
  const state = await getSetupState();
  const next: SetupState = { ...state, dismissed: true };
  await saveSetupState(next);
  return next;
}

export async function completeTask(id: SetupTaskId): Promise<SetupState> {
  const state = await getSetupState();
  const tasks = state.tasks.map(t => t.id === id ? { ...t, completed: true } : t);
  const nextIncomplete = tasks.find(t => !t.completed && !t.skipped);
  const next: SetupState = { ...state, tasks, currentStep: nextIncomplete?.id ?? null };
  await saveSetupState(next);
  return next;
}

export async function skipTask(id: SetupTaskId): Promise<SetupState> {
  const state = await getSetupState();
  const tasks = state.tasks.map(t => t.id === id ? { ...t, skipped: true } : t);
  const nextIncomplete = tasks.find(t => !t.completed && !t.skipped);
  const next: SetupState = { ...state, tasks, currentStep: nextIncomplete?.id ?? null };
  await saveSetupState(next);
  return next;
}

export async function dismissTip(tipId: string): Promise<void> {
  const state = await getSetupState();
  if (state.dismissedTips.includes(tipId)) return;
  await saveSetupState({ ...state, dismissedTips: [...state.dismissedTips, tipId] });
}

export async function markFeatureOpened(featureId: string): Promise<void> {
  const state = await getSetupState();
  if (state.openedFeatures.includes(featureId)) return;
  await saveSetupState({ ...state, openedFeatures: [...state.openedFeatures, featureId] });
}

// ─── Computed helpers ─────────────────────────────────────────────────────────

export function completionPercent(state: SetupState): number {
  if (!state.tasks.length) return 0;
  const done = state.tasks.filter(t => t.completed).length;
  return Math.round((done / state.tasks.length) * 100);
}

export function nextTask(state: SetupState): SetupTask | null {
  return state.tasks.find(t => !t.completed && !t.skipped) ?? null;
}

export function nextBestAction(state: SetupState): { label: string; route: string } {
  const next = nextTask(state);
  if (!next) return { label: 'View your brand dashboard', route: '/(tabs)/profile' };

  const actions: Partial<Record<SetupTaskId, string>> = {
    verify_account:       'Verify your account to start selling',
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

export async function resetSetupState(): Promise<void> {
  await AsyncStorage.removeItem(KEY_SETUP);
}
