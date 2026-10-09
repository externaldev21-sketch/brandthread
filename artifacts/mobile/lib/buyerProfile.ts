import AsyncStorage from '@react-native-async-storage/async-storage';

let activeUserId = 'anon';
const keyFor = (userId = activeUserId) => `bt:buyer-profile:${userId}:v2`;

/** Scope editable buyer fields to the authenticated Clerk user. */
export function initBuyerProfile(userId: string | null): void {
  activeUserId = userId ?? 'anon';
}

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
  /**
   * Local URI of the picked avatar image OR, when a video avatar is set, the
   * video's poster frame — every screen that just shows a static avatar
   * (feed, chat, calls) reads this one field and never needs to know a video
   * exists. Persisted so it survives screen nav.
   */
  avatarUri: string;
  /** Set only when the avatar is a moving profile picture; empty for a plain photo. */
  avatarVideoUri: string;
}

export const DEFAULT_BUYER_PROFILE: BuyerProfileFields = {
  name: '',
  username: '',
  pronouns: '',
  bio: '',
  links: '',
  location: '',
  gender: '',
  phone: '',
  aiCreator: false,
  avatarUri: '',
  avatarVideoUri: '',
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
    avatarVideoUri: str(obj.avatarVideoUri, DEFAULT_BUYER_PROFILE.avatarVideoUri),
  };
}

export async function loadBuyerProfile(): Promise<BuyerProfileFields> {
  try {
    const raw = await AsyncStorage.getItem(keyFor());
    if (!raw) return { ...DEFAULT_BUYER_PROFILE };
    return sanitize(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_BUYER_PROFILE };
  }
}

export async function saveBuyerProfile(fields: BuyerProfileFields): Promise<boolean> {
  return saveBuyerProfileForUser(activeUserId, fields);
}

/** Write directly to an immutable Clerk-user key for async onboarding flows. */
export async function saveBuyerProfileForUser(userId: string, fields: BuyerProfileFields): Promise<boolean> {
  try {
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(fields));
    return true;
  } catch {
    return false;
  }
}

/**
 * Fields that follow the account through /api/me/settings (server keys
 * pronouns, gender, aiCreator; limits mirror the server allowlist).
 */
export type BuyerProfileExtras = Pick<BuyerProfileFields, 'pronouns' | 'gender' | 'aiCreator'>;

export function profileExtrasToSettings(fields: BuyerProfileExtras): Record<string, unknown> {
  const text = (v: string) => (v.trim() ? v.trim().slice(0, 40) : null);
  return { pronouns: text(fields.pronouns), gender: text(fields.gender), aiCreator: fields.aiCreator };
}

/** Only the extras the server actually holds (missing keys keep the local value). */
export function profileExtrasFromSettings(settings: Record<string, unknown> | null | undefined): Partial<BuyerProfileExtras> {
  if (!settings) return {};
  const out: Partial<BuyerProfileExtras> = {};
  if (typeof settings.pronouns === 'string') out.pronouns = settings.pronouns;
  if (typeof settings.gender === 'string') out.gender = settings.gender;
  if (typeof settings.aiCreator === 'boolean') out.aiCreator = settings.aiCreator;
  return out;
}
