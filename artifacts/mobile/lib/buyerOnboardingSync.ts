import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError } from '@/lib/networkNotice';

type BuyerOnboardingApi = {
  auth: {
    saveBuyerPreferences: (styleInterests: string[], expectedClerkId: string) => Promise<unknown>;
    completeOnboarding: (accountType: 'buyer', expectedClerkId: string) => Promise<unknown>;
  };
};

type PendingBuyerOnboardingSync = {
  styleInterests: string[];
};

const KEY_PREFIX = 'bt:onboarding:buyer-sync-pending:v1:';

export function pendingBuyerOnboardingSyncKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

export async function queueBuyerOnboardingSync(
  userId: string,
  styleInterests: string[],
): Promise<void> {
  const payload: PendingBuyerOnboardingSync = { styleInterests };
  await AsyncStorage.setItem(
    pendingBuyerOnboardingSyncKey(userId),
    JSON.stringify(payload),
  );
}

export async function syncBuyerOnboarding(
  userId: string,
  styleInterests: string[],
  api: BuyerOnboardingApi,
): Promise<void> {
  await api.auth.saveBuyerPreferences(styleInterests, userId);
  await api.auth.completeOnboarding('buyer', userId);
  await AsyncStorage.removeItem(pendingBuyerOnboardingSyncKey(userId));
}

export function isRecoverableBuyerOnboardingSyncError(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500;
}

export async function flushPendingBuyerOnboardingSync(
  userId: string,
  api: BuyerOnboardingApi,
): Promise<boolean> {
  const raw = await AsyncStorage.getItem(pendingBuyerOnboardingSyncKey(userId));
  if (!raw) return false;
  const pending = JSON.parse(raw) as PendingBuyerOnboardingSync;
  await syncBuyerOnboarding(userId, pending.styleInterests, api);
  return true;
}