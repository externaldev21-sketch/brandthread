/**
 * Seller launch checklist — client view of GET /api/seller/launch-checklist.
 * The server owns the done flags; this file owns the copy and the route each
 * step's primary action opens.
 */
import type { Feather } from '@expo/vector-icons';

export type LaunchStepId =
  | 'name_handle'
  | 'logo_banner'
  | 'accent'
  | 'socials'
  | 'first_product'
  | 'shipping'
  | 'preview'
  | 'publish'
  | 'payouts';

export interface LaunchChecklistResponse {
  steps: { id: LaunchStepId; done: boolean }[];
  doneCount: number;
  total: number;
  complete: boolean;
  handle: string | null;
  dismissed: boolean;
}

interface LaunchStepMeta {
  title: string;
  body: string;
  cta: string;
  route: string;
  icon: keyof typeof Feather.glyphMap;
}

export const LAUNCH_STEP_META: Record<LaunchStepId, LaunchStepMeta> = {
  name_handle: {
    title: 'Name your store',
    body: 'Choose the store name and @handle buyers will see.',
    cta: 'Name your store',
    route: '/store-setup-name',
    icon: 'type',
  },
  logo_banner: {
    title: 'Add your logo and banner',
    body: 'Upload a square logo and a wide banner for your storefront.',
    cta: 'Add logo and banner',
    route: '/store-setup-brand',
    icon: 'image',
  },
  accent: {
    title: 'Choose your store color',
    body: 'Pick the accent color used across your storefront.',
    cta: 'Choose color',
    route: '/store-setup-brand',
    icon: 'droplet',
  },
  socials: {
    title: 'Link Instagram or TikTok',
    body: 'Connect at least one account so buyers can find you.',
    cta: 'Link account',
    route: '/store-setup-socials',
    icon: 'link',
  },
  first_product: {
    title: 'Add your first product',
    body: 'Create a product with photos, a price and sizes.',
    cta: 'Add product',
    route: '/add-product',
    icon: 'package',
  },
  shipping: {
    title: 'Set your shipping rates',
    body: 'Choose what buyers pay for shipping and where you ship.',
    cta: 'Set shipping rates',
    route: '/shipping',
    icon: 'truck',
  },
  preview: {
    title: 'Preview as a buyer',
    body: 'See your storefront exactly the way buyers do.',
    cta: 'Preview store',
    route: '/store-preview-as-buyer',
    icon: 'eye',
  },
  publish: {
    title: 'Publish your store',
    body: 'Make your storefront live at your store link.',
    cta: 'Publish store',
    route: '/launch-publish',
    icon: 'globe',
  },
  payouts: {
    title: 'Set up payouts',
    body: 'Connect your bank through Stripe to get paid for orders.',
    cta: 'Set up payouts',
    route: '/payouts',
    icon: 'credit-card',
  },
};

// ─── "Get ready to sell" (dashboard card) ─────────────────────────────────
// Shopify's dashboard checklist, six rows in Shopify's order. Payouts come
// after the first product (never during sign-up). Built from the same server
// flags as the full checklist screen; customize = logo + banner + color.

export type GetReadyRowId = 'first_product' | 'name_store' | 'shipping' | 'payouts' | 'customize' | 'share';

export interface GetReadyRow {
  id: GetReadyRowId;
  title: string;
  route: string;
  done: boolean;
}

export function getReadyRows(checklist: LaunchChecklistResponse): GetReadyRow[] {
  const done = (id: LaunchStepId) => checklist.steps.find((s) => s.id === id)?.done ?? false;
  const published = done('publish');
  return [
    { id: 'first_product', title: 'Add your first product', route: '/add-product', done: done('first_product') },
    { id: 'name_store', title: 'Name your store', route: '/store-setup-name', done: done('name_handle') },
    { id: 'shipping', title: 'Set your shipping rates', route: '/shipping', done: done('shipping') },
    { id: 'payouts', title: 'Set up payouts', route: '/payouts', done: done('payouts') },
    { id: 'customize', title: 'Customize your store', route: '/store-setup-brand', done: done('logo_banner') && done('accent') },
    // Sharing needs a live store: publish first, then the share screen.
    { id: 'share', title: 'Share your store', route: published ? '/share-store' : '/launch-publish', done: published },
  ];
}

/** Step shown as "next" — the first one still open. */
export function nextLaunchStep(checklist: LaunchChecklistResponse): LaunchStepId | null {
  return checklist.steps.find((s) => !s.done)?.id ?? null;
}

/** Only with `&demo=1` on the web preview; never used against a real account. */
export function buildDemoLaunchChecklist(): LaunchChecklistResponse {
  const done = new Set<LaunchStepId>(['name_handle', 'logo_banner', 'first_product', 'shipping']);
  const ids = Object.keys(LAUNCH_STEP_META) as LaunchStepId[];
  return {
    steps: ids.map((id) => ({ id, done: done.has(id) })),
    doneCount: done.size,
    total: ids.length,
    complete: false,
    handle: 'atelier',
    dismissed: false,
  };
}
