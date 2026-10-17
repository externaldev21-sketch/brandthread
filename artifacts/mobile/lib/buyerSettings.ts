import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'brandthread_buyer_settings_v2';

export interface BuyerSettingsState {
  privateAccount: boolean;
  activityStatus: boolean;
  readReceipts: boolean;
  storyReplies: 'everyone' | 'friends' | 'off';
  storySharing: boolean;
  allowMentions: 'everyone' | 'friends' | 'nobody';
  allowTags: 'everyone' | 'friends' | 'nobody';
  manualTagApproval: boolean;
  messageRequests: boolean;
  groupAdds: 'everyone' | 'friends';
  hiddenWords: boolean;
  hideLikeCounts: boolean;
  sensitiveContent: 'less' | 'standard' | 'more';
  autoplayVideos: boolean;
  highQualityUploads: boolean;
  dataSaver: boolean;
  orderUpdates: boolean;
  dropAlerts: boolean;
  restockAlerts: boolean;
  priceDropAlerts: boolean;
  friendActivity: boolean;
  messageNotifications: boolean;
  storyNotifications: boolean;
  marketingNotifications: boolean;
  twoFactor: boolean;
  biometricLock: boolean;
  loginAlerts: boolean;
  saveLoginInfo: boolean;
  searchable: boolean;
  contactSync: boolean;
  showShoppingActivity: boolean;
  personalizedRecommendations: boolean;
  sizeTops: string;
  sizeBottoms: string;
  sizeShoes: string;
  preferredFit: 'slim' | 'regular' | 'oversized';
  styleCategories: string[];
  language: string;
  theme: 'system' | 'dark' | 'light';
  reduceMotion: boolean;
  captions: boolean;
  highContrast: boolean;
}

export const DEFAULT_BUYER_SETTINGS: BuyerSettingsState = {
  privateAccount: false,
  activityStatus: true,
  readReceipts: true,
  storyReplies: 'everyone',
  storySharing: true,
  allowMentions: 'everyone',
  allowTags: 'everyone',
  manualTagApproval: false,
  messageRequests: true,
  // Matches the server default (api-server lib/userAppSettings.ts): group
  // creation was never restricted, so 'everyone' is what actually happens.
  groupAdds: 'everyone',
  hiddenWords: true,
  hideLikeCounts: false,
  sensitiveContent: 'standard',
  autoplayVideos: true,
  highQualityUploads: true,
  dataSaver: false,
  orderUpdates: true,
  dropAlerts: true,
  restockAlerts: true,
  priceDropAlerts: false,
  friendActivity: true,
  messageNotifications: true,
  storyNotifications: true,
  marketingNotifications: false,
  twoFactor: false,
  biometricLock: false,
  loginAlerts: true,
  saveLoginInfo: true,
  searchable: true,
  contactSync: false,
  showShoppingActivity: false,
  personalizedRecommendations: true,
  sizeTops: 'M',
  sizeBottoms: '32',
  sizeShoes: '10',
  preferredFit: 'regular',
  styleCategories: ['streetwear', 'vintage'],
  language: 'English',
  theme: 'system',
  reduceMotion: false,
  captions: true,
  highContrast: false,
};

// In-memory snapshot + listeners so app-wide effects (reduce motion, high
// contrast, upload quality, save login info) react to a change immediately,
// without every consumer re-reading AsyncStorage.
let snapshot: BuyerSettingsState = { ...DEFAULT_BUYER_SETTINGS };
const listeners = new Set<(s: BuyerSettingsState) => void>();

/** Last loaded/saved settings (defaults until the first load). Synchronous. */
export function getBuyerSettingsSnapshot(): BuyerSettingsState {
  return snapshot;
}

export function subscribeBuyerSettings(fn: (s: BuyerSettingsState) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function publish(next: BuyerSettingsState) {
  snapshot = next;
  listeners.forEach((fn) => fn(next));
}

export async function loadBuyerSettings(): Promise<BuyerSettingsState> {
  let next: BuyerSettingsState;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    next = raw ? { ...DEFAULT_BUYER_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_BUYER_SETTINGS };
  } catch {
    next = { ...DEFAULT_BUYER_SETTINGS };
  }
  if (JSON.stringify(next) !== JSON.stringify(snapshot)) publish(next);
  return next;
}

export async function saveBuyerSettings(settings: BuyerSettingsState) {
  await AsyncStorage.setItem(KEY, JSON.stringify(settings));
  publish(settings);
}

export async function patchBuyerSettings(patch: Partial<BuyerSettingsState>) {
  const current = await loadBuyerSettings();
  const next = { ...current, ...patch };
  await saveBuyerSettings(next);
  return next;
}

/**
 * Upload quality (Settings → Accessibility & data usage → "Upload at highest
 * quality"): the image-picker / camera JPEG quality to use for a buyer upload.
 * Highest quality keeps the caller's own value; off caps it for smaller,
 * faster uploads.
 */
export const REDUCED_UPLOAD_QUALITY = 0.6;
export function uploadQuality(preferred: number, settings: Pick<BuyerSettingsState, 'highQualityUploads'> = snapshot): number {
  return settings.highQualityUploads ? preferred : Math.min(preferred, REDUCED_UPLOAD_QUALITY);
}
