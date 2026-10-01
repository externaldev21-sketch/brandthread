/**
 * Dev web preview only (?bt_preview=…&demo=1): sample gift card data so the
 * screens can be reviewed without a backend. Never reachable in a real build
 * or by a signed-in account (isPreviewDemoMode is false there).
 */
import type { GiftCard, GiftCardSettings, GiftCardStoreInfo } from '@/lib/giftCards';

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 864e5).toISOString();

export const PREVIEW_STORE_INFO: GiftCardStoreInfo = {
  sellerId: 'preview-seller', storeName: 'Atelier North', enabled: true,
  denominations: [2500, 5000, 10000], allowCustom: false, minCents: 500, maxCents: 100000,
};

export const PREVIEW_CARDS: GiftCard[] = [
  {
    id: 'pc1', sellerId: 'preview-seller', storeName: 'Atelier North', last4: '4821', initialCents: 5000, balanceCents: 3200,
    status: 'active', expiresAt: null, createdAt: iso(12), role: 'owner', recipientName: null, message: null,
  },
  {
    id: 'pc2', sellerId: 'preview-seller-2', storeName: 'Field Supply Co', last4: '7730', initialCents: 2500, balanceCents: 2500,
    status: 'active', expiresAt: new Date(Date.now() + 200 * 864e5).toISOString(), createdAt: iso(3), role: 'owner', recipientName: null, message: null,
  },
  {
    id: 'pc3', sellerId: 'preview-seller', storeName: 'Atelier North', last4: '1093', initialCents: 10000, balanceCents: 10000,
    status: 'active', expiresAt: null, createdAt: iso(1), role: 'purchaser', recipientName: 'Sam', recipientEmail: 'sam@example.com', message: 'Happy birthday',
  },
];

export const PREVIEW_SETTINGS: GiftCardSettings = {
  sellerId: 'preview-seller', enabled: true, denominations: [2500, 5000, 10000], allowCustom: false, expiryMonths: null,
  minCents: 500, maxCents: 100000,
};

export const PREVIEW_SELLER_CARDS: GiftCard[] = [
  { ...PREVIEW_CARDS[0], role: 'seller', recipientName: 'Jordan', recipientEmail: 'jordan@example.com' },
  { ...PREVIEW_CARDS[2], role: 'seller' },
];
