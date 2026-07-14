/**
 * Brandthread Setup Store
 *
 * Persists seller guided-setup progress via AsyncStorage.
 * All reads/writes go through this module — no direct AsyncStorage calls in screens.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SetupTaskId =
  | 'brand_profile'
  | 'brand_logo'
  | 'first_product'
  | 'product_images'
  | 'product_price'
  | 'sales_model'
  | 'connect_payouts'
  | 'shipping'
  | 'manufacturer'
  | 'customize_store'
  | 'first_post'
  | 'publish_store';

export interface SetupTask {
  id: SetupTaskId;
  label: string;
  description: string;
  icon: string;
  route: string;
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
  { id: 'brand_profile',   label: 'Complete brand profile',  description: 'Add your brand name, bio and social links',       icon: 'user',       route: '/edit-profile' },
  { id: 'brand_logo',      label: 'Upload brand logo',       description: 'Add a logo that represents your brand',           icon: 'image',      route: '/edit-profile' },
  { id: 'first_product',   label: 'Create first product',    description: 'Add your first item to your catalog',             icon: 'package',    route: '/(tabs)/products' },
  { id: 'product_images',  label: 'Add product images',      description: 'Upload photos that show your product well',       icon: 'camera',     route: '/(tabs)/products' },
  { id: 'product_price',   label: 'Set product price',       description: 'Set a price and choose your currency',            icon: 'dollar-sign',route: '/(tabs)/products' },
  { id: 'sales_model',     label: 'Choose sales model',      description: 'Pre-order, in-stock, or limited drop',           icon: 'layers',     route: '/(tabs)/products' },
  { id: 'connect_payouts', label: 'Connect payouts',         description: 'Link a bank account to receive payments',         icon: 'credit-card', route: '/(tabs)/more' },
  { id: 'shipping',        label: 'Configure shipping',      description: 'Set your shipping zones and rates',               icon: 'truck',      route: '/(tabs)/more' },
  { id: 'manufacturer',    label: 'Add manufacturer',        description: 'Find or invite a manufacturer to produce your items', icon: 'tool',   route: '/(tabs)/more' },
  { id: 'customize_store', label: 'Customize store',         description: 'Choose your store colors, fonts and layout',      icon: 'layout',     route: '/(tabs)/more' },
  { id: 'first_post',      label: 'Create first post',       description: 'Share a Seller post to the Thread feed',          icon: 'video',      route: '/create-post' },
  { id: 'publish_store',   label: 'Publish store',           description: 'Make your store visible to buyers',               icon: 'globe',      route: '/(tabs)/more' },
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
    // Merge any new tasks added in future app versions
    const existingIds = new Set(parsed.tasks.map(t => t.id));
    const newTasks = DEFAULT_TASKS
      .filter(t => !existingIds.has(t.id))
      .map(t => ({ ...t, completed: false, skipped: false }));
    return { ...parsed, tasks: [...parsed.tasks, ...newTasks] };
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
    brand_profile:   'Finish setting up your brand profile',
    brand_logo:      'Upload your brand logo',
    first_product:   'Create your first product',
    product_images:  'Add photos to your product',
    product_price:   'Set a price for your product',
    sales_model:     'Choose your sales model',
    connect_payouts: 'Connect payouts before publishing',
    shipping:        'Configure your shipping rates',
    manufacturer:    'Add a manufacturer to your network',
    customize_store: 'Customize your store layout',
    first_post:      'Create your first Seller post',
    publish_store:   'Your store is ready — publish it',
  };

  return {
    label: actions[next.id] ?? next.label,
    route: next.route,
  };
}

export async function resetSetupState(): Promise<void> {
  await AsyncStorage.removeItem(KEY_SETUP);
}
