/**
 * The account the dev web preview (`?bt_preview=seller|buyer`) stands in for.
 *
 * One identity per role, shared by every preview surface (the account switcher
 * already shows these names), so screens never disagree about who "you" are.
 *
 * - Fresh (default): what a brand-new account has right after onboarding — a
 *   name and a username, nothing else. No bio, website, location, socials or
 *   contact email, because a real new account has not entered any.
 * - Demo (`&demo=1` only): the same person with a filled-in profile.
 *
 * Pure: callers pass the role/demo flags (see lib/devPreview.ts).
 */
export type PreviewRole = 'seller' | 'buyer';

export interface PreviewAccount {
  id: string;
  role: PreviewRole;
  name: string;
  username: string;
  email: string;
  bio: string;
  website: string;
  category: string;
  tags: string[];
  location: string;
  contactEmail: string;
  instagram: string;
  tiktok: string;
  pronouns: string;
  phone: string;
}

const BASE: Record<PreviewRole, Pick<PreviewAccount, 'id' | 'role' | 'name' | 'username'>> = {
  seller: { id: 'preview-seller', role: 'seller', name: 'Atelier Noire', username: 'atelier_noire' },
  buyer: { id: 'preview-buyer', role: 'buyer', name: 'Ava', username: 'ava' },
};

const DEMO_DETAILS: Record<PreviewRole, Omit<PreviewAccount, 'id' | 'role' | 'name' | 'username'>> = {
  seller: {
    email: 'studio@ateliernoire.co',
    bio: 'Sculpted outerwear and evening pieces, cut in small runs.',
    website: 'https://ateliernoire.co',
    category: 'Womenswear',
    tags: ['tailoring', 'small batch'],
    location: 'Paris, France',
    contactEmail: 'studio@ateliernoire.co',
    instagram: '@atelier.noire',
    tiktok: '@atelier.noire',
    pronouns: '',
    phone: '',
  },
  buyer: {
    email: 'ava@brandthread.demo',
    bio: '',
    website: '',
    category: '',
    tags: [],
    location: 'New York, NY',
    contactEmail: '',
    instagram: '',
    tiktok: '',
    pronouns: 'she/her',
    phone: '',
  },
};

const FRESH_DETAILS: Omit<PreviewAccount, 'id' | 'role' | 'name' | 'username'> = {
  email: '',
  bio: '',
  website: '',
  category: '',
  tags: [],
  location: '',
  contactEmail: '',
  instagram: '',
  tiktok: '',
  pronouns: '',
  phone: '',
};

export function getPreviewAccount(role: PreviewRole, demo: boolean): PreviewAccount {
  return { ...BASE[role], ...(demo ? DEMO_DETAILS[role] : FRESH_DETAILS), tags: [...(demo ? DEMO_DETAILS[role].tags : [])] };
}

/**
 * Store-setup progress for the preview seller, keyed apart from any real
 * account and apart per mode, so demo progress never shows in a fresh preview.
 */
export function previewSetupUserId(demo: boolean): string {
  return demo ? 'preview-seller-demo' : 'preview-seller';
}

/**
 * Setup steps the demo seller has already done — it has a live store with
 * products, paid orders and payouts connected (lib/previewApiData.ts demo
 * answers). A fresh preview has only finished onboarding.
 */
export const PREVIEW_DEMO_SETUP_TASKS = ['verify_account', 'connect_payments', 'first_product', 'publish_store'] as const;
