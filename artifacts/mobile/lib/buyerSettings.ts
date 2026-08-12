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
  language: string;
  theme: 'system' | 'dark' | 'light';
  reduceMotion: boolean;
  captions: boolean;
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
  groupAdds: 'friends',
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
  language: 'English',
  theme: 'system',
  reduceMotion: false,
  captions: true,
};

export async function loadBuyerSettings(): Promise<BuyerSettingsState> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_BUYER_SETTINGS };
    return { ...DEFAULT_BUYER_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_BUYER_SETTINGS };
  }
}

export async function saveBuyerSettings(settings: BuyerSettingsState) {
  await AsyncStorage.setItem(KEY, JSON.stringify(settings));
}

export async function patchBuyerSettings(patch: Partial<BuyerSettingsState>) {
  const current = await loadBuyerSettings();
  const next = { ...current, ...patch };
  await saveBuyerSettings(next);
  return next;
}
