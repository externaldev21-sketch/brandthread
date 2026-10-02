/**
 * Manufacturer Hub demo directory — `?bt_preview=seller&demo=1`.
 *
 * The public manufacturer directory (`GET /api/manufacturers/public`) sits
 * behind `requireAuth`, and the dev-web preview never signs in via Clerk
 * (see lib/devPreview.ts). Calling it unconditionally 401'd on every load,
 * which the caller (app/manufacturer-hub.tsx) surfaced as a broken
 * "Directory unavailable" error state for every preview visitor, seller or
 * demo reviewer alike.
 *
 * Real accounts are unaffected (they have a token), so this fixture exists
 * purely so `&demo=1` has something realistic to show; `isSellerDevPreview()`
 * gates it exactly like every other lib/preview*.ts fixture in this app —
 * dead code in production and native builds.
 *
 * No profileImageUri: matches what a real manufacturer's card looks like
 * before they've uploaded factory photos (ManufacturerCard's own fallback,
 * a colored initial), rather than inventing placeholder photos this repo
 * has no bundled assets or CDN convention for.
 */
import type { Manufacturer } from '@/services/manufacturerTypes';
import type { ManufacturerProduct } from '@/services/manufacturerCatalog';

function iso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString();
}

export const PREVIEW_MANUFACTURERS: Manufacturer[] = [
  {
    id: 'preview-mfg-porto-knit',
    name: 'Porto Knit Collective', country: 'Portugal', city: 'Porto',
    description: 'Family-run cut & sew for premium fleece and heavyweight jersey.',
    galleryUris: [], yearsInBusiness: 22, teamSize: '50–200', productionCapacity: '18,000 units/month',
    specialties: ['Hoodies', 'Heavyweight Tees', 'Fleece'], categories: ['Cut & Sew', 'Knitwear'],
    capabilities: [{ id: 'cap-1', category: 'Cut & Sew', materials: ['Cotton fleece', 'French terry'] }],
    certifications: [{ id: 'cert-1', name: 'OEKO-TEX', issuer: 'OEKO-TEX Association' }],
    materials: ['Cotton fleece', 'French terry', 'Organic cotton'],
    moq: 150, samplePriceMinCents: 3500, samplePriceMaxCents: 8500,
    unitPriceMinCents: 1400, unitPriceMaxCents: 2600, leadTimeDays: 28, responseTimeHours: 6,
    rating: 4.9, reviewCount: 87, reviews: [], isVerified: true,
    shippingRegions: ['EU', 'US', 'UK'], website: 'https://portoknit.example',
    isPublicDirectory: true, priceRangeLabel: '$14–$26', sampleTurnaround: '10 days', bulkTurnaround: '28 days',
    createdAt: iso(400),
  },
  {
    id: 'preview-mfg-la-garment',
    name: 'LA Garment Works', country: 'USA', city: 'Los Angeles',
    description: 'Domestic small-batch production with an on-site dye house.',
    galleryUris: [], yearsInBusiness: 11, teamSize: '20–50', productionCapacity: '6,000 units/month',
    specialties: ['Garment Dye', 'Tees', 'Sweatpants'], categories: ['Cut & Sew'],
    capabilities: [{ id: 'cap-2', category: 'Garment Dye', materials: ['Cotton'] }],
    certifications: [], materials: ['Cotton', 'Cotton/poly blends'],
    moq: 50, samplePriceMinCents: 2500, samplePriceMaxCents: 6000,
    unitPriceMinCents: 1100, unitPriceMaxCents: 1900, leadTimeDays: 21, responseTimeHours: 4,
    rating: 4.7, reviewCount: 142, reviews: [], isVerified: true,
    shippingRegions: ['US'], isPublicDirectory: true,
    priceRangeLabel: '$11–$19', sampleTurnaround: '7 days', bulkTurnaround: '21 days',
    createdAt: iso(300),
  },
  {
    id: 'preview-mfg-harbour',
    name: 'Harbour Outerwear', country: 'Vietnam', city: 'Ho Chi Minh City',
    description: 'Technical shells and outerwear, full-package development.',
    galleryUris: [], yearsInBusiness: 15, teamSize: '200–500', productionCapacity: '40,000 units/month',
    specialties: ['Outerwear', 'Shell Jackets', 'Embroidery'], categories: ['Cut & Sew', 'Embroidery'],
    capabilities: [{ id: 'cap-3', category: 'Embroidery', materials: ['Nylon', 'Polyester'], printMethods: ['Flat embroidery', '3D puff'] }],
    certifications: [{ id: 'cert-2', name: 'ISO 9001', issuer: 'ISO' }],
    materials: ['Nylon', 'Polyester', 'GORE-TEX'],
    moq: 300, samplePriceMinCents: 6000, samplePriceMaxCents: 15000,
    unitPriceMinCents: 1800, unitPriceMaxCents: 4200, leadTimeDays: 35, responseTimeHours: 12,
    rating: 4.6, reviewCount: 64, reviews: [], isVerified: true,
    shippingRegions: ['Global'], isPublicDirectory: true,
    priceRangeLabel: '$18–$42', sampleTurnaround: '14 days', bulkTurnaround: '35 days',
    createdAt: iso(500),
  },
  {
    id: 'preview-mfg-tiruppur',
    name: 'Tiruppur Cotton Co.', country: 'India', city: 'Tiruppur',
    description: 'Organic cotton jersey, GOTS certified.',
    galleryUris: [], yearsInBusiness: 9, teamSize: '50–200', productionCapacity: '25,000 units/month',
    specialties: ['Organic Tees', 'Knitwear'], categories: ['Knitwear'],
    capabilities: [{ id: 'cap-4', category: 'Knitwear', materials: ['Organic cotton'] }],
    certifications: [{ id: 'cert-3', name: 'GOTS', issuer: 'Global Organic Textile Standard' }],
    materials: ['Organic cotton'],
    moq: 200, samplePriceMinCents: 2000, samplePriceMaxCents: 4500,
    unitPriceMinCents: 600, unitPriceMaxCents: 1200, leadTimeDays: 30, responseTimeHours: 10,
    rating: 4.8, reviewCount: 53, reviews: [], isVerified: true,
    shippingRegions: ['Global'], isPublicDirectory: true,
    priceRangeLabel: '$6–$12', sampleTurnaround: '9 days', bulkTurnaround: '30 days',
    createdAt: iso(600),
  },
  {
    id: 'preview-mfg-oaxaca',
    name: 'Oaxaca Leather Studio', country: 'Mexico', city: 'Oaxaca',
    description: 'Hand-finished leather goods and footwear uppers.',
    galleryUris: [], yearsInBusiness: 18, teamSize: '20–50', productionCapacity: '3,000 units/month',
    specialties: ['Footwear', 'Leather Goods'], categories: ['Leather', 'Footwear'],
    capabilities: [{ id: 'cap-5', category: 'Leather', materials: ['Full-grain leather'] }],
    certifications: [], materials: ['Full-grain leather', 'Suede'],
    moq: 100, samplePriceMinCents: 4500, samplePriceMaxCents: 9500,
    unitPriceMinCents: 2200, unitPriceMaxCents: 4800, leadTimeDays: 40, responseTimeHours: 8,
    rating: 4.9, reviewCount: 38, reviews: [], isVerified: true,
    shippingRegions: ['US', 'Mexico'], isPublicDirectory: true,
    priceRangeLabel: '$22–$48', sampleTurnaround: '12 days', bulkTurnaround: '40 days',
    createdAt: iso(700),
  },
  {
    id: 'preview-mfg-quiet-print',
    name: 'Quiet Print House', country: 'Portugal', city: 'Braga',
    description: 'Screen printing and small-batch graphic tees, fast turnaround.',
    galleryUris: [], yearsInBusiness: 6, teamSize: '<20', productionCapacity: '9,000 units/month',
    specialties: ['Screen Printing', 'Graphic Tees'], categories: ['Screen Printing'],
    capabilities: [{ id: 'cap-6', category: 'Screen Printing', materials: ['Cotton'], printMethods: ['Water-based', 'Plastisol'] }],
    certifications: [], materials: ['Cotton', 'Tri-blend'],
    moq: 25, samplePriceMinCents: 1500, samplePriceMaxCents: 3000,
    unitPriceMinCents: 500, unitPriceMaxCents: 950, leadTimeDays: 10, responseTimeHours: 2,
    rating: 4.5, reviewCount: 29, reviews: [], isVerified: false,
    shippingRegions: ['EU'], isPublicDirectory: true,
    priceRangeLabel: '$5–$9.50', sampleTurnaround: '4 days', bulkTurnaround: '10 days',
    createdAt: iso(200),
  },
];

export function getPreviewManufacturers(): Manufacturer[] {
  return PREVIEW_MANUFACTURERS;
}

const PREVIEW_MANUFACTURER_PRODUCTS: ManufacturerProduct[] = [
  {
    id: 'preview-mfg-product-porto-crew',
    manufacturerId: 'preview-mfg-porto-knit',
    name: 'Heavyweight French Terry Crew',
    description: 'A midweight, loopback French terry crewneck with a relaxed fit.',
    category: 'Sweatshirts',
    images: [],
    moq: 150,
    leadTimeDays: 28,
    samplePriceCents: 6500,
    samplePriceLabel: '$65 sample',
    customizationOptions: ['Custom colors', 'Woven label', 'Embroidery'],
    status: 'active',
    priceTiers: [
      { id: 'preview-tier-porto-150', minQuantity: 150, maxQuantity: 499, unitPriceCents: 2600 },
      { id: 'preview-tier-porto-500', minQuantity: 500, maxQuantity: null, unitPriceCents: 2200 },
    ],
    createdAt: iso(120),
    updatedAt: iso(30),
  },
  {
    id: 'preview-mfg-product-porto-hoodie',
    manufacturerId: 'preview-mfg-porto-knit',
    name: 'Organic Cotton Pullover Hoodie',
    description: 'An organic cotton fleece hoodie with a two-panel hood.',
    category: 'Hoodies',
    images: [],
    moq: 200,
    leadTimeDays: 32,
    samplePriceCents: 8200,
    samplePriceLabel: '$82 sample',
    customizationOptions: ['Custom colors', 'Screen print', 'Embroidery'],
    status: 'active',
    priceTiers: [
      { id: 'preview-tier-hoodie-200', minQuantity: 200, maxQuantity: 499, unitPriceCents: 3400 },
      { id: 'preview-tier-hoodie-500', minQuantity: 500, maxQuantity: null, unitPriceCents: 2950 },
    ],
    createdAt: iso(90),
    updatedAt: iso(21),
  },
];

export function getPreviewManufacturer(id: string): Manufacturer | undefined {
  return PREVIEW_MANUFACTURERS.find((manufacturer) => manufacturer.id === id);
}

export function getPreviewManufacturerProducts(manufacturerId: string): ManufacturerProduct[] {
  return PREVIEW_MANUFACTURER_PRODUCTS.filter((product) => product.manufacturerId === manufacturerId);
}

export function getPreviewManufacturerProduct(manufacturerId: string, productId: string): ManufacturerProduct | undefined {
  return PREVIEW_MANUFACTURER_PRODUCTS.find((product) => (
    product.manufacturerId === manufacturerId && product.id === productId
  ));
}
