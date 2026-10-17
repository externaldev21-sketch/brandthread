/**
 * Server side of the seller "Store setup" checklist
 * (GET/PUT /api/seller/launch-checklist/setup). Kept separate from
 * setupStore.ts so the store's pure logic stays testable without the network
 * stack.
 */
import { serviceRequest } from '@/lib/serviceConfig';
import { isSellerDevPreview } from '@/lib/devPreview';

export interface RemoteSetupStoredState {
  started: boolean;
  dismissed: boolean;
  walkthroughShown: boolean;
  celebrated: boolean;
  dismissedTips: string[];
  openedFeatures: string[];
  tasks: Record<string, { completed?: boolean; skipped?: boolean }>;
}

export interface RemoteSetup {
  /** Done flags read from real account data (Stripe, products, logo, ...). */
  derived: Record<string, boolean>;
  derivedTaskIds: string[];
  state: RemoteSetupStoredState;
  /** Onboarding goals the order was built from. */
  goals: string[];
  /** Task ids, most relevant to the seller's goals first. */
  order: string[];
}

/** null when there is no signed-in server to ask (signed-out seller preview). */
export async function loadRemoteSetup(): Promise<RemoteSetup | null> {
  if (isSellerDevPreview()) return null;
  return serviceRequest<RemoteSetup>('/api/seller/launch-checklist/setup', {}, false);
}

export async function saveRemoteSetup(state: RemoteSetupStoredState): Promise<RemoteSetup | null> {
  if (isSellerDevPreview()) return null;
  return serviceRequest<RemoteSetup>('/api/seller/launch-checklist/setup', {
    method: 'PUT',
    body: JSON.stringify({ state }),
  }, false);
}
