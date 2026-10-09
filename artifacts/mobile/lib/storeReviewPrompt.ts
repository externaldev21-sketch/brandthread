/**
 * App Store / Play review prompt, shown only after a good moment — a
 * seller's first sale or a buyer's 2nd delivered order — and heavily rate
 * limited:
 * each moment at most once per account, at least 120 days between prompts,
 * at most 3 prompts per account. State is scoped to the Clerk user so a
 * decision on a shared device never affects another account. The OS has its
 * own cap on top of this, so a call here may still show nothing.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as StoreReview from 'expo-store-review';

// 'fifth_order' is retired (buyers are now asked after their 2nd delivery)
// but stays in the type so state saved by older builds still parses.
export type ReviewMoment = 'first_sale' | 'fifth_order' | 'second_delivery';
const MOMENTS: readonly ReviewMoment[] = ['first_sale', 'fifth_order', 'second_delivery'];

export interface ReviewPromptState {
  lastPromptAt: number | null;
  promptCount: number;
  done: ReviewMoment[];
}

export const MIN_DAYS_BETWEEN_PROMPTS = 120;
export const MAX_PROMPTS_PER_ACCOUNT = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Order statuses that count as a real sale/purchase (not cancelled/refunded). */
const COUNTED_ORDER_STATUSES = ['pending', 'processing', 'fulfilled', 'shipped', 'delivered'];

export function countRealOrders(orders: unknown): number {
  if (!Array.isArray(orders)) return 0;
  return orders.filter((order) => COUNTED_ORDER_STATUSES.includes((order as { status?: string })?.status ?? '')).length;
}

/** Orders that actually reached the buyer. */
export function countDeliveredOrders(orders: unknown): number {
  if (!Array.isArray(orders)) return 0;
  return orders.filter((order) => (order as { status?: string })?.status === 'delivered').length;
}

/** The buyer moment: their 2nd delivered order (or later, if it was missed). */
export function isSecondDeliveryMoment(orders: unknown): boolean {
  return countDeliveredOrders(orders) >= 2;
}

export const emptyReviewState = (): ReviewPromptState => ({ lastPromptAt: null, promptCount: 0, done: [] });

export function shouldPromptForReview(state: ReviewPromptState, moment: ReviewMoment, now: number): boolean {
  if (state.done.includes(moment)) return false;
  if (state.promptCount >= MAX_PROMPTS_PER_ACCOUNT) return false;
  if (state.lastPromptAt !== null && now - state.lastPromptAt < MIN_DAYS_BETWEEN_PROMPTS * DAY_MS) return false;
  return true;
}

const storageKey = (userId: string) => `bt:review-prompt:v1:${userId}`;
let inFlight = false;

async function readState(userId: string): Promise<ReviewPromptState> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    if (!raw) return emptyReviewState();
    const parsed = JSON.parse(raw) as Partial<ReviewPromptState>;
    return {
      lastPromptAt: typeof parsed.lastPromptAt === 'number' ? parsed.lastPromptAt : null,
      promptCount: typeof parsed.promptCount === 'number' ? parsed.promptCount : 0,
      done: Array.isArray(parsed.done) ? parsed.done.filter((m): m is ReviewMoment => MOMENTS.includes(m as ReviewMoment)) : [],
    };
  } catch {
    return emptyReviewState();
  }
}

/**
 * Call only when a good moment has just been confirmed by the server. Never
 * throws and never blocks the caller's flow. Returns true when the native
 * review sheet was requested.
 */
export async function maybeRequestStoreReview(
  userId: string | null | undefined,
  moment: ReviewMoment,
  now: number = Date.now(),
): Promise<boolean> {
  if (Platform.OS === 'web' || !userId || inFlight) return false;
  inFlight = true;
  try {
    const state = await readState(userId);
    if (!shouldPromptForReview(state, moment, now)) return false;
    if (!(await StoreReview.isAvailableAsync()) || !(await StoreReview.hasAction())) return false;

    // Record before asking so a crash or a concurrent trigger can't re-prompt.
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify({
      lastPromptAt: now,
      promptCount: state.promptCount + 1,
      done: [...state.done, moment],
    } satisfies ReviewPromptState));
    await StoreReview.requestReview();
    return true;
  } catch {
    return false;
  } finally {
    inFlight = false;
  }
}
