import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'buyer_profile_fields_v1';

export interface BuyerProfileFields {
  name: string;
  username: string;
  pronouns: string;
  bio: string;
  links: string;
  location: string;
  gender: string;
  phone: string;
  aiCreator: boolean;
  /** Local URI of the picked avatar image; persisted so it survives screen nav. */
  avatarUri: string;
}

export const DEFAULT_BUYER_PROFILE: BuyerProfileFields = {
  name: '',
  username: 'jordan',
  pronouns: '',
  bio: 'Jordan',
  links: '',
  location: '',
  gender: '',
  phone: '',
  aiCreator: false,
  avatarUri: '',
};

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

/** Coerces an arbitrary parsed JSON value into a well-typed BuyerProfileFields, falling back field-by-field. */
function sanitize(raw: unknown): BuyerProfileFields {
  const obj = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  return {
    name:      str(obj.name, DEFAULT_BUYER_PROFILE.name),
    username:  str(obj.username, DEFAULT_BUYER_PROFILE.username),
    pronouns:  str(obj.pronouns, DEFAULT_BUYER_PROFILE.pronouns),
    bio:       str(obj.bio, DEFAULT_BUYER_PROFILE.bio),
    links:     str(obj.links, DEFAULT_BUYER_PROFILE.links),
    location:  str(obj.location, DEFAULT_BUYER_PROFILE.location),
    gender:    str(obj.gender, DEFAULT_BUYER_PROFILE.gender),
    phone:     str(obj.phone, DEFAULT_BUYER_PROFILE.phone),
    aiCreator: typeof obj.aiCreator === 'boolean' ? obj.aiCreator : DEFAULT_BUYER_PROFILE.aiCreator,
    avatarUri: str(obj.avatarUri, DEFAULT_BUYER_PROFILE.avatarUri),
  };
}

export async function loadBuyerProfile(): Promise<BuyerProfileFields> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_BUYER_PROFILE };
    return sanitize(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_BUYER_PROFILE };
  }
}

export async function saveBuyerProfile(fields: BuyerProfileFields): Promise<boolean> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(fields));
    return true;
  } catch {
    return false;
  }
}
