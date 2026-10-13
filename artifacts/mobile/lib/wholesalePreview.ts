/**
 * Dev web preview only (?bt_preview=…&demo=1): sample wholesale data so the
 * screens can be reviewed without a backend. Never reachable in a real build
 * or by a signed-in account (isPreviewDemoMode is false there).
 */
import type { WholesaleMyStatus, WholesaleSellerOverview } from '@/lib/wholesale';

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 864e5).toISOString();

const PRODUCTS: WholesaleSellerOverview['products'] = [
  { id: 'pp1', name: 'Heavyweight tee', image: null, variants: [{ id: 'pv1', label: 'M / Black', priceCents: 4_800 }] },
  { id: 'pp2', name: 'Canvas tote', image: null, variants: [{ id: 'pv2', label: 'One size', priceCents: 3_200 }] },
  { id: 'pp3', name: 'Wool beanie', image: null, variants: [{ id: 'pv3', label: 'One size', priceCents: 2_800 }] },
  { id: 'pp4', name: 'Fleece hoodie', image: null, variants: [{ id: 'pv4', label: 'L / Grey', priceCents: 8_900 }] },
];

export const PREVIEW_WHOLESALE_OVERVIEW: WholesaleSellerOverview = {
  settings: { enabled: true, minOrderCents: 25_000, defaultPercentOff: 40 },
  prices: [
    { id: 'pr1', productId: 'pp2', variantId: null, priceCents: 1_500, minQuantity: 12 },
    { id: 'pr2', productId: 'pp4', variantId: null, priceCents: null, minQuantity: 6 },
  ],
  products: PRODUCTS,
  buyers: [
    { id: 'pb1', buyerId: 'u1', status: 'pending', businessName: 'Corner Goods', createdAt: iso(1), name: 'Corner Goods', username: 'cornergoods', avatarUrl: null },
    { id: 'pb2', buyerId: 'u2', status: 'pending', businessName: 'North Pop-up', createdAt: iso(2), name: 'North Pop-up', username: 'northpopup', avatarUrl: null },
    { id: 'pb3', buyerId: 'u3', status: 'approved', businessName: 'Harbor Supply', createdAt: iso(9), name: 'Harbor Supply', username: 'harborsupply', avatarUrl: null },
  ],
};

export const PREVIEW_WHOLESALE_ME: WholesaleMyStatus = {
  enabled: true,
  status: 'approved',
  businessName: 'Harbor Supply',
  minOrderCents: 25_000,
  priceList: [
    { ...PRODUCTS[0], variants: [{ ...PRODUCTS[0].variants[0], wholesaleCents: 2_880, minQuantity: 1 }] },
    { ...PRODUCTS[1], variants: [{ ...PRODUCTS[1].variants[0], wholesaleCents: 1_500, minQuantity: 12 }] },
    { ...PRODUCTS[3], variants: [{ ...PRODUCTS[3].variants[0], wholesaleCents: 5_340, minQuantity: 6 }] },
  ],
};
