/**
 * Discount codes in the seller web preview with `&demo=1` — local
 * illustration only, never sent anywhere. Fresh preview shows none; codes a
 * preview seller creates live in lib/previewSellerFreshStore.ts either way.
 * Ids start with `preview-demo-discount-` so edits stay in screen state and
 * never reach the persisted fresh-preview store.
 */
import type { PreviewDiscount } from './previewSellerFreshStore';

const DAY_MS = 86_400_000;

export function isPreviewDemoDiscountId(id: string): boolean {
  return id.startsWith('preview-demo-discount-');
}

export function buildPreviewDemoDiscounts(demo: boolean, now: Date = new Date()): PreviewDiscount[] {
  if (!demo) return [];
  const at = (days: number) => new Date(now.getTime() + days * DAY_MS).toISOString();
  const base = {
    productIds: [], collectionIds: [], minQuantity: 0, oneUsePerCustomer: false, firstOrderOnly: false,
    minOrderCents: 0, maxUses: null, startsAt: null, expiresAt: null, active: true, appliesTo: 'entire_store' as const,
  };
  return [
    { ...base, id: 'preview-demo-discount-welcome', code: 'WELCOME15', type: 'percentage', value: 15, usesCount: 38, oneUsePerCustomer: true, firstOrderOnly: true, status: 'active', createdAt: at(-0.1) },
    { ...base, id: 'preview-demo-discount-shipfree', code: 'SHIPFREE', type: 'free_shipping', value: 0, minOrderCents: 7500, usesCount: 112, status: 'active', createdAt: at(-1.2) },
    { ...base, id: 'preview-demo-discount-drop', code: 'DROP20', type: 'percentage', value: 20, maxUses: 200, usesCount: 0, startsAt: at(3), expiresAt: at(10), status: 'scheduled', createdAt: at(-1.4) },
    { ...base, id: 'preview-demo-discount-hoodie', code: 'HOODIE10', type: 'fixed', value: 10, appliesTo: 'specific_products', productIds: ['preview-product-2'], usesCount: 21, active: false, status: 'paused', createdAt: at(-9) },
    { ...base, id: 'preview-demo-discount-summer', code: 'SUMMER25', type: 'percentage', value: 25, maxUses: 150, usesCount: 150, expiresAt: at(-20), status: 'exhausted', createdAt: at(-60) },
    { ...base, id: 'preview-demo-discount-bfcm', code: 'BFCM30', type: 'percentage', value: 30, minOrderCents: 5000, usesCount: 284, startsAt: at(-320), expiresAt: at(-316), status: 'expired', createdAt: at(-330) },
  ];
}
