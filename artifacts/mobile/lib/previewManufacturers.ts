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
import type { Manufacturer, ManufacturerReview } from '@/services/manufacturerTypes';
import type { ManufacturerProduct } from '@/services/manufacturerCatalog';

function iso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString();
}

/**
 * The latest few reviews behind each fixture's `reviewCount`. Without them the
 * profile hero said "4.9 (87 reviews)" while its Reviews section said
 * "No reviews yet".
 */
function previewReviews(
  manufacturerId: string,
  rows: readonly [sellerName: string, rating: number, comment: string, daysAgo: number][],
): ManufacturerReview[] {
  return rows.map(([sellerName, rating, comment, daysAgo], i) => ({
    id: `${manufacturerId}-review-${i + 1}`,
    sellerId: `preview-seller-${i + 1}`,
    sellerName,
    rating,
    qualityRating: rating,
    communicationRating: Math.min(5, rating + (i % 2)),
    deliveryRating: Math.max(1, rating - (i === 2 ? 1 : 0)),
    comment,
    createdAt: iso(daysAgo),
  }));
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
    rating: 4.9, reviewCount: 87,
    reviews: previewReviews('preview-mfg-porto-knit', [
      ['Northline Studio', 5, 'Fleece came back exactly to spec. Great communication on the colour lab dips.', 6],
      ['Saltwater Supply', 5, 'Second run with them; sizing was consistent across the whole order.', 19],
      ['Common Thread Co.', 4, 'Excellent quality. Bulk shipped a few days after the quoted date.', 41],
    ]), isVerified: true,
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
    rating: 4.7, reviewCount: 142,
    reviews: previewReviews('preview-mfg-la-garment', [
      ['Pacific Basics', 5, 'Garment dye shades matched our swatches on the first try.', 4],
      ['Low Tide Label', 4, 'Fast samples and easy to reach. One carton was short two units, fixed quickly.', 23],
      ['Desert Bloom', 5, 'Small-batch run was clean and on time.', 58],
    ]), isVerified: true,
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
    rating: 4.6, reviewCount: 64,
    reviews: previewReviews('preview-mfg-harbour', [
      ['Ridge & Range', 5, 'Shell jackets passed our water test. Seams are well taped.', 9],
      ['Urban Fjord', 4, 'Great development team. Embroidery needed one revision.', 33],
      ['Coastline Goods', 4, 'Solid quality. Lead time ran a week over.', 72],
    ]), isVerified: true,
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
    rating: 4.8, reviewCount: 53,
    reviews: previewReviews('preview-mfg-tiruppur', [
      ['Good Cotton Club', 5, 'GOTS paperwork came with the shipment. Tees feel great.', 11],
      ['Plain Folk', 5, 'Very responsive and the jersey weight is spot on.', 27],
      ['Kinfolk Basics', 4, 'Good quality. Freight booking took a few extra days.', 64],
    ]), isVerified: true,
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
    rating: 4.9, reviewCount: 38,
    reviews: previewReviews('preview-mfg-oaxaca', [
      ['Mesa Footwear', 5, 'Beautiful hand finishing on the uppers.', 8],
      ['Field Day Goods', 5, 'They caught a pattern issue before cutting. Saved us a run.', 30],
      ['Adobe & Co.', 4, 'Lovely leather. Samples took a little longer than quoted.', 55],
    ]), isVerified: true,
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
    rating: 4.5, reviewCount: 29,
    reviews: previewReviews('preview-mfg-quiet-print', [
      ['Weekend Club', 5, 'Prints were crisp and turnaround was four days, as promised.', 3],
      ['Static Radio', 4, 'Good water-based prints. One colour ran slightly light.', 17],
      ['Paper Moon', 4, 'Easy to work with for a small run.', 46],
    ]), isVerified: false,
    shippingRegions: ['EU'], isPublicDirectory: true,
    priceRangeLabel: '$5–$9.50', sampleTurnaround: '4 days', bulkTurnaround: '10 days',
    createdAt: iso(200),
  },
  // ── Denim, dye & wash, embroidery and more knit/print shops, so every
  // "Find a manufacturer" category has someone in it in the demo. ─────────
  {
    id: 'preview-mfg-okayama-denim',
    name: 'Okayama Denim Works', country: 'Japan', city: 'Kurashiki',
    description: 'Selvedge denim cut and sewn on vintage chain-stitch machines.',
    galleryUris: [], yearsInBusiness: 31, teamSize: '50–200', productionCapacity: '8,000 units/month',
    specialties: ['Selvedge Denim', 'Jeans', 'Chore Jackets'], categories: ['Denim'],
    capabilities: [{ id: 'cap-7', category: 'Denim', materials: ['Selvedge denim', 'Sashiko'] }],
    certifications: [], materials: ['Selvedge denim', 'Sashiko', 'Cotton twill'],
    moq: 120, samplePriceMinCents: 9000, samplePriceMaxCents: 16000,
    unitPriceMinCents: 4200, unitPriceMaxCents: 7800, leadTimeDays: 45, responseTimeHours: 14,
    rating: 4.9, reviewCount: 46,
    reviews: previewReviews('preview-mfg-okayama-denim', [
      ['Indigo Supply', 5, 'Chain-stitched hems and perfect selvedge lines. Worth the lead time.', 12],
      ['Field Notes', 5, 'They walked us through every weight option before sampling.', 37],
      ['Ten Mile', 4, 'Beautiful jeans. Freight from Japan adds a week.', 80],
    ]), isVerified: true,
    shippingRegions: ['Global'], isPublicDirectory: true,
    priceRangeLabel: '$42–$78', sampleTurnaround: '18 days', bulkTurnaround: '45 days',
    createdAt: iso(800),
  },
  {
    id: 'preview-mfg-medina-denim',
    name: 'Medina Denim Mills', country: 'Tunisia', city: 'Monastir',
    description: 'Five-pocket jeans and denim jackets with an in-house laundry for stone and enzyme washes.',
    galleryUris: [], yearsInBusiness: 14, teamSize: '200–500', productionCapacity: '30,000 units/month',
    specialties: ['Jeans', 'Denim Jackets', 'Stone Wash'], categories: ['Denim', 'Dye & Wash'],
    capabilities: [{ id: 'cap-8', category: 'Denim', materials: ['Rigid denim', 'Stretch denim'] }],
    certifications: [{ id: 'cert-4', name: 'BSCI', issuer: 'amfori' }],
    materials: ['Rigid denim', 'Stretch denim'],
    moq: 300, samplePriceMinCents: 4000, samplePriceMaxCents: 7000,
    unitPriceMinCents: 1300, unitPriceMaxCents: 2400, leadTimeDays: 32, responseTimeHours: 9,
    rating: 4.6, reviewCount: 71,
    reviews: previewReviews('preview-mfg-medina-denim', [
      ['Coastal Club', 5, 'Wash standards matched our reference within a shade.', 10],
      ['North Fork', 4, 'Good fits. Second sample round needed for the rise.', 44],
      ['Blue Hour', 4, 'Reliable and well priced for the volume.', 90],
    ]), isVerified: true,
    shippingRegions: ['EU', 'UK', 'US'], isPublicDirectory: true,
    priceRangeLabel: '$13–$24', sampleTurnaround: '12 days', bulkTurnaround: '32 days',
    createdAt: iso(450),
  },
  {
    id: 'preview-mfg-istanbul-wash',
    name: 'Bosphorus Wash House', country: 'Turkey', city: 'Istanbul',
    description: 'Garment dyeing, pigment dye and enzyme wash on finished blanks.',
    galleryUris: [], yearsInBusiness: 12, teamSize: '50–200', productionCapacity: '20,000 units/month',
    specialties: ['Garment Dye', 'Pigment Dye', 'Enzyme Wash', 'Tie-Dye'], categories: ['Dye & Wash'],
    capabilities: [{ id: 'cap-9', category: 'Dye & Wash', materials: ['Cotton', 'Linen'] }],
    certifications: [{ id: 'cert-5', name: 'OEKO-TEX', issuer: 'OEKO-TEX Association' }],
    materials: ['Cotton', 'Linen'],
    moq: 100, samplePriceMinCents: 1500, samplePriceMaxCents: 3500,
    unitPriceMinCents: 250, unitPriceMaxCents: 700, leadTimeDays: 14, responseTimeHours: 5,
    rating: 4.7, reviewCount: 58,
    reviews: previewReviews('preview-mfg-istanbul-wash', [
      ['Sun Faded', 5, 'Pigment dye came out exactly as soft and faded as we wanted.', 5],
      ['Olive Grove', 5, 'Lab dips in three days. Very fast.', 26],
      ['Studio Nine', 4, 'Great colour. A few pieces shrank more than the rest.', 60],
    ]), isVerified: true,
    shippingRegions: ['EU', 'US'], isPublicDirectory: true,
    priceRangeLabel: '$2.50–$7 / piece', sampleTurnaround: '5 days', bulkTurnaround: '14 days',
    createdAt: iso(350),
  },
  {
    id: 'preview-mfg-stitch-lane',
    name: 'Stitch Lane Embroidery', country: 'USA', city: 'New York',
    description: 'Flat and 3D puff embroidery, chenille patches and woven badges.',
    galleryUris: [], yearsInBusiness: 8, teamSize: '<20', productionCapacity: '12,000 pieces/month',
    specialties: ['Embroidery', 'Chenille Patches', '3D Puff'], categories: ['Embroidery'],
    capabilities: [{ id: 'cap-10', category: 'Embroidery', materials: ['Cotton', 'Fleece', 'Twill'], printMethods: ['Flat embroidery', '3D puff', 'Chenille'] }],
    certifications: [], materials: ['Cotton', 'Fleece', 'Twill'],
    moq: 24, samplePriceMinCents: 2000, samplePriceMaxCents: 4500,
    unitPriceMinCents: 400, unitPriceMaxCents: 1100, leadTimeDays: 9, responseTimeHours: 3,
    rating: 4.8, reviewCount: 112,
    reviews: previewReviews('preview-mfg-stitch-lane', [
      ['Corner Store', 5, 'Puff embroidery on our hats looks incredible.', 2],
      ['Late Night', 5, 'Digitizing was free and the stitch-out was clean.', 15],
      ['Parade', 4, 'Great work. A couple of patches had loose threads.', 49],
    ]), isVerified: true,
    shippingRegions: ['US', 'Canada'], isPublicDirectory: true,
    priceRangeLabel: '$4–$11 / piece', sampleTurnaround: '4 days', bulkTurnaround: '9 days',
    createdAt: iso(250),
  },
  {
    id: 'preview-mfg-highland-knit',
    name: 'Highland Knit Mill', country: 'United Kingdom', city: 'Hawick',
    description: 'Fully fashioned merino and lambswool sweaters, cardigans and beanies.',
    galleryUris: [], yearsInBusiness: 40, teamSize: '50–200', productionCapacity: '5,000 units/month',
    specialties: ['Sweaters', 'Merino Knits', 'Beanies'], categories: ['Knitwear'],
    capabilities: [{ id: 'cap-11', category: 'Knitwear', materials: ['Merino', 'Lambswool', 'Cashmere'] }],
    certifications: [], materials: ['Merino', 'Lambswool', 'Cashmere'],
    moq: 80, samplePriceMinCents: 7500, samplePriceMaxCents: 14000,
    unitPriceMinCents: 3800, unitPriceMaxCents: 9500, leadTimeDays: 50, responseTimeHours: 20,
    rating: 4.9, reviewCount: 34,
    reviews: previewReviews('preview-mfg-highland-knit', [
      ['Moorland', 5, 'The merino crew is the best knit we have ever produced.', 20],
      ['Quiet Hours', 5, 'Small minimums for a mill of this quality.', 52],
      ['Woolly Co.', 4, 'Lovely product, long lead time — plan ahead.', 95],
    ]), isVerified: true,
    shippingRegions: ['UK', 'EU', 'US'], isPublicDirectory: true,
    priceRangeLabel: '$38–$95', sampleTurnaround: '21 days', bulkTurnaround: '50 days',
    createdAt: iso(900),
  },
  {
    id: 'preview-mfg-ink-yard',
    name: 'Ink Yard Printworks', country: 'USA', city: 'Austin',
    description: 'Screen printing and DTG on tees and hoodies, water-based and discharge inks.',
    galleryUris: [], yearsInBusiness: 10, teamSize: '20–50', productionCapacity: '25,000 prints/month',
    specialties: ['Screen Printing', 'DTG', 'Discharge Ink'], categories: ['Screen Printing'],
    capabilities: [{ id: 'cap-12', category: 'Screen Printing', materials: ['Cotton', 'Fleece'], printMethods: ['Water-based', 'Discharge', 'DTG'] }],
    certifications: [], materials: ['Cotton', 'Fleece'],
    moq: 36, samplePriceMinCents: 1800, samplePriceMaxCents: 3500,
    unitPriceMinCents: 450, unitPriceMaxCents: 1200, leadTimeDays: 8, responseTimeHours: 2,
    rating: 4.7, reviewCount: 203,
    reviews: previewReviews('preview-mfg-ink-yard', [
      ['Good Times', 5, 'Discharge prints feel like nothing. Exactly what we wanted.', 1],
      ['Lone Star Goods', 5, 'Turned a rush order around in five days.', 13],
      ['Wild Oak', 4, 'Strong prints. Mockup approval took a day longer than expected.', 40],
    ]), isVerified: true,
    shippingRegions: ['US'], isPublicDirectory: true,
    priceRangeLabel: '$4.50–$12 / print', sampleTurnaround: '3 days', bulkTurnaround: '8 days',
    createdAt: iso(150),
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
