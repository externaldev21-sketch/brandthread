/**
 * Manufacturer Hub — demo service layer with AsyncStorage persistence.
 * All writes persist across app restarts. Demo data seeds on first load.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { serviceRequest } from '../lib/serviceConfig';
import { centsAtPercent } from '../lib/money';
import { getEntitlementRejection } from '../lib/entitlementError';
import {
  Manufacturer, ManufacturerRelationship, ManufacturerInvitation,
  QuoteRequest, Quote, Counteroffer,
  Sample, SampleRevision, SampleReview,
  ProductionOrder, ProductionStage, ProductionUpdate, QualityControlCheck,
  ProductionIssue, ManufacturerPaymentRecord,
  ManufacturerConversation, ManufacturerMessage,
  ManufacturerThread,
  ManufacturerFile, ManufacturerPriceCard,
  PRODUCTION_STAGES, QC_CATEGORIES,
  ProductionStageKey,
} from './manufacturerTypes';

// ─── Storage keys ─────────────────────────────────────────────────────────────

const KEYS = {
  manufacturers:     'mfg:manufacturers',
  relationships:     'mfg:relationships',
  invitations:       'mfg:invitations',
  quoteRequests:     'mfg:quoteRequests',
  quotes:            'mfg:quotes',
  counteroffers:     'mfg:counteroffers',
  samples:           'mfg:samples',
  productionOrders:  'mfg:productionOrders',
  conversations:     'mfg:conversations',
  files:             'mfg:files',
  priceCards:        'mfg:priceCards',
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 11);
}

function now(): string {
  return new Date().toISOString();
}

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function multiplyCents(quantity: number, unitCents: number): number {
  if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(unitCents)) {
    throw new Error('Quote quantities and monetary amounts must be safe integers.');
  }
  const total = quantity * unitCents;
  if (!Number.isSafeInteger(total)) throw new Error('Quote total exceeds the safe integer range.');
  return total;
}

function sumCents(...amounts: number[]): number {
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  if (!Number.isSafeInteger(total)) throw new Error('Quote total exceeds the safe integer range.');
  return total;
}

// ─── Demo data ────────────────────────────────────────────────────────────────

export const DEMO_MANUFACTURERS: Manufacturer[] = [
  {
    id: 'mfg_001',
    name: 'Apex Apparel Co.',
    country: 'Portugal',
    city: 'Porto',
    description: 'Premium European cut-and-sew specialist with 20 years producing luxury streetwear and sportswear for global brands. GOTS certified, low minimums for independent designers.',
    profileImageUri: undefined,
    galleryUris: [],
    yearsInBusiness: 20,
    teamSize: '50–200',
    productionCapacity: '8,000 units/month',
    specialties: ['Cut & Sew', 'Heavy fabrics', 'Heavyweight fleece', 'Woven labels'],
    categories: ['Hoodies', 'Sweatshirts', 'T-Shirts', 'Jackets'],
    capabilities: [
      { id: 'cap_001', category: 'Cut & Sew', materials: ['French terry', 'Heavyweight fleece', '100% cotton', 'Recycled cotton'], printMethods: ['Screen print', 'DTG', 'Embroidery'] },
    ],
    certifications: [
      { id: 'cert_001', name: 'GOTS', issuer: 'Control Union', validUntil: '2026-12-31' },
      { id: 'cert_002', name: 'OEKO-TEX Standard 100', issuer: 'OEKO-TEX', validUntil: '2026-06-30' },
    ],
    materials: ['100% Cotton', 'French terry', 'Heavyweight fleece', 'Recycled cotton'],
    moq: 50,
    samplePriceMinCents: 4500, samplePriceMaxCents: 9000, unitPriceMinCents: 1800, unitPriceMaxCents: 3500,
    leadTimeDays: 35,
    responseTimeHours: 12,
    rating: 4.8,
    reviewCount: 47,
    isVerified: true,
    shippingRegions: ['Europe', 'North America', 'UK'],
    website: 'https://apexapparel.pt',
    email: 'hello@apexapparel.pt',
    createdAt: now(),
  },
  {
    id: 'mfg_002',
    name: 'Shenzhen StyleCraft',
    country: 'China',
    city: 'Shenzhen',
    description: 'Full-package manufacturer specializing in high-volume streetwear, activewear, and outerwear. State-of-the-art embroidery, screen print, and DTF printing lines.',
    profileImageUri: undefined,
    galleryUris: [],
    yearsInBusiness: 14,
    teamSize: '200–500',
    productionCapacity: '50,000 units/month',
    specialties: ['Full-package', 'Embroidery', 'All-over print', 'Reflective details'],
    categories: ['Hoodies', 'T-Shirts', 'Activewear', 'Outerwear', 'Accessories'],
    capabilities: [
      { id: 'cap_002', category: 'Full Package', materials: ['Polyester', 'Cotton blends', 'Nylon', 'Spandex'], printMethods: ['Screen print', 'DTF', 'Embroidery', 'Heat transfer'] },
    ],
    certifications: [
      { id: 'cert_003', name: 'ISO 9001', issuer: 'SGS', validUntil: '2027-03-01' },
    ],
    materials: ['100% Cotton', 'Cotton/poly blend', 'Polyester', 'Spandex', 'Nylon'],
    moq: 100,
    samplePriceMinCents: 2500, samplePriceMaxCents: 6000, unitPriceMinCents: 800, unitPriceMaxCents: 2200,
    leadTimeDays: 25,
    responseTimeHours: 6,
    rating: 4.6,
    reviewCount: 113,
    isVerified: true,
    shippingRegions: ['Worldwide'],
    website: 'https://stylecraft-sz.com',
    email: 'sales@stylecraft-sz.com',
    createdAt: now(),
  },
  {
    id: 'mfg_003',
    name: 'Lisbon Stitch Studio',
    country: 'Portugal',
    city: 'Lisbon',
    description: 'Boutique factory focused on premium basics and slow fashion. Exceptional quality control, fully transparent supply chain. Preferred partner for emerging luxury brands.',
    profileImageUri: undefined,
    galleryUris: [],
    yearsInBusiness: 8,
    teamSize: '10–50',
    productionCapacity: '2,000 units/month',
    specialties: ['Premium basics', 'Made-to-order', 'Organic fabrics', 'Hand finishing'],
    categories: ['T-Shirts', 'Polos', 'Trousers', 'Basics'],
    capabilities: [
      { id: 'cap_003', category: 'Cut & Sew', materials: ['Organic cotton', 'Linen', 'Tencel', 'Merino wool'], printMethods: ['Embroidery', 'Screen print'] },
    ],
    certifications: [
      { id: 'cert_004', name: 'GOTS', issuer: 'Control Union', validUntil: '2026-09-01' },
      { id: 'cert_005', name: 'Fair Wear', issuer: 'Fair Wear Foundation', validUntil: '2027-01-01' },
    ],
    materials: ['Organic cotton', 'Linen', 'Tencel', 'Merino wool'],
    moq: 25,
    samplePriceMinCents: 6000, samplePriceMaxCents: 12000, unitPriceMinCents: 2500, unitPriceMaxCents: 5500,
    leadTimeDays: 45,
    responseTimeHours: 24,
    rating: 4.9,
    reviewCount: 21,
    isVerified: true,
    shippingRegions: ['Europe', 'UK'],
    website: 'https://lisbonstitch.com',
    email: 'hello@lisbonstitch.com',
    createdAt: now(),
  },
  {
    id: 'mfg_004',
    name: 'LA Cut Studio',
    country: 'United States',
    city: 'Los Angeles, CA',
    description: 'Domestic US manufacturer with fast turnaround for small runs. No overseas shipping wait. Perfect for brands prioritizing speed-to-market and "Made in USA" label.',
    profileImageUri: undefined,
    galleryUris: [],
    yearsInBusiness: 11,
    teamSize: '10–50',
    productionCapacity: '3,000 units/month',
    specialties: ['Small-batch', 'Quick turn', 'Made in USA', 'Cut & Sew'],
    categories: ['T-Shirts', 'Hoodies', 'Shorts', 'Sweats'],
    capabilities: [
      { id: 'cap_004', category: 'Cut & Sew', materials: ['100% Cotton', 'Cotton fleece', 'French terry'], printMethods: ['Screen print', 'DTG'] },
    ],
    certifications: [],
    materials: ['100% Cotton', 'Cotton fleece', 'French terry'],
    moq: 24,
    samplePriceMinCents: 8500, samplePriceMaxCents: 15000, unitPriceMinCents: 2200, unitPriceMaxCents: 4800,
    leadTimeDays: 14,
    responseTimeHours: 4,
    rating: 4.7,
    reviewCount: 38,
    isVerified: false,
    shippingRegions: ['North America'],
    website: 'https://lacutstudio.com',
    email: 'quotes@lacutstudio.com',
    createdAt: now(),
  },
  {
    id: 'mfg_005',
    name: 'Istanbul Textile Works',
    country: 'Turkey',
    city: 'Istanbul',
    description: 'Large-scale denim and woven specialist. Full wash house on-site. Expertise in distressed finishes, laser print, and reactive dye. Competitive pricing with strong EU logistics.',
    profileImageUri: undefined,
    galleryUris: [],
    yearsInBusiness: 18,
    teamSize: '200–500',
    productionCapacity: '30,000 units/month',
    specialties: ['Denim', 'Woven', 'Wash treatments', 'Laser print'],
    categories: ['Jeans', 'Jackets', 'Shirts', 'Shorts', 'Dresses'],
    capabilities: [
      { id: 'cap_005', category: 'Woven / Denim', materials: ['Denim', 'Twill', 'Chambray', 'Corduroy'], printMethods: ['Laser print', 'Screen print', 'Embroidery'] },
    ],
    certifications: [
      { id: 'cert_006', name: 'BSCI', issuer: 'Amfori', validUntil: '2026-11-01' },
    ],
    materials: ['Denim', 'Twill', 'Chambray', 'Corduroy', 'Canvas'],
    moq: 200,
    samplePriceMinCents: 3500, samplePriceMaxCents: 8000, unitPriceMinCents: 1200, unitPriceMaxCents: 3200,
    leadTimeDays: 30,
    responseTimeHours: 18,
    rating: 4.5,
    reviewCount: 82,
    isVerified: true,
    shippingRegions: ['Europe', 'Middle East', 'North America'],
    website: 'https://istanbuTextile.com',
    email: 'export@istanbuTextile.com',
    createdAt: now(),
  },
];

// ─── In-memory stores ─────────────────────────────────────────────────────────

let _initialized = false;
let _manufacturers: Manufacturer[] = [];
let _relationships: ManufacturerRelationship[] = [];
let _invitations: ManufacturerInvitation[] = [];
let _quoteRequests: QuoteRequest[] = [];
let _quotes: Quote[] = [];
let _counteroffers: Counteroffer[] = [];
let _samples: Sample[] = [];
let _productionOrders: ProductionOrder[] = [];
let _conversations: ManufacturerConversation[] = [];
let _files: ManufacturerFile[] = [];
let _priceCards: ManufacturerPriceCard[] = [];

// ─── Persistence helpers ──────────────────────────────────────────────────────

async function persistAll() {
  await AsyncStorage.multiSet([
    [KEYS.relationships,    JSON.stringify(_relationships)],
    [KEYS.invitations,      JSON.stringify(_invitations)],
    [KEYS.quoteRequests,    JSON.stringify(_quoteRequests)],
    [KEYS.quotes,           JSON.stringify(_quotes)],
    [KEYS.counteroffers,    JSON.stringify(_counteroffers)],
    [KEYS.samples,          JSON.stringify(_samples)],
    [KEYS.productionOrders, JSON.stringify(_productionOrders)],
    [KEYS.conversations,    JSON.stringify(_conversations)],
    [KEYS.files,            JSON.stringify(_files)],
    [KEYS.priceCards,       JSON.stringify(_priceCards)],
  ]);
}

async function ensureInitialized() {
  if (_initialized) return;
  _initialized = true;
  _manufacturers = DEMO_MANUFACTURERS;

  const stored = await AsyncStorage.multiGet(Object.values(KEYS));
  const map = Object.fromEntries(stored.map(([k, v]) => [k, v]));

  const parse = <T>(key: string, fallback: T[]): T[] => {
    try { return map[key] ? JSON.parse(map[key]!) : fallback; }
    catch { return fallback; }
  };

  _relationships    = parse(KEYS.relationships, []);
  _invitations      = parse(KEYS.invitations, []);
  _quoteRequests    = parse(KEYS.quoteRequests, []);
  _quotes           = parse(KEYS.quotes, []);
  _counteroffers    = parse(KEYS.counteroffers, []);
  _samples          = parse(KEYS.samples, []);
  _productionOrders = parse(KEYS.productionOrders, []);
  _conversations    = parse(KEYS.conversations, []);
  _files            = parse(KEYS.files, []);
  _priceCards       = parse(KEYS.priceCards, []);

  // Seed a demo relationship + conversation if empty
  if (_relationships.length === 0) {
    const rel: ManufacturerRelationship = {
      id: 'rel_001',
      sellerId: 'seller_001',
      manufacturerId: 'mfg_001',
      status: 'active',
      activeProductIds: [],
      lastMessageAt: now(),
      lastMessagePreview: 'We specialize in heavyweight fleece and cut-and-sew — happy to walk you through our MOQs and lead times.',
      unreadCount: 1,
      createdAt: now(),
      updatedAt: now(),
    };
    _relationships.push(rel);

    const conv: ManufacturerConversation = {
      id: 'conv_001',
      sellerId: 'seller_001',
      manufacturerId: 'mfg_001',
      manufacturerName: 'Apex Apparel Co.',
      contextLabel: 'General',
      lastMessage: 'We specialize in heavyweight fleece and cut-and-sew — happy to walk you through our MOQs and lead times.',
      lastMessageAt: now(),
      unreadCount: 1,
      messages: [
        {
          id: 'msg_001',
          conversationId: 'conv_001',
          senderId: 'mfg_001',
          senderType: 'manufacturer',
          text: 'Hey, thanks for reaching out! We specialize in heavyweight fleece, cut-and-sew hoodies, and woven-label finishes for independent streetwear labels. Happy to walk you through our MOQs, sampling process, and lead times whenever you\'re ready.',
          imageUris: [],
          fileIds: [],
          isInternalNote: false,
          createdAt: now(),
        },
      ],
      createdAt: now(),
      updatedAt: now(),
    };
    _conversations.push(conv);
    await persistAll();
  }
}

// ─── Manufacturers ────────────────────────────────────────────────────────────

function apiRowToManufacturer(row: any): Manufacturer {
  return {
    id:                 row.id,
    name:               row.businessName,
    country:            row.country,
    city:               row.city ?? '',
    specialty:          row.specialty ?? '',
    description:        row.description ?? '',
    moq:                row.moq ?? 100,
    samplePriceMinCents: 0, samplePriceMaxCents: 0,
    unitPriceMinCents: 0, unitPriceMaxCents: 0,
    leadTimeDays:       Number(String(row.bulkTurnaround ?? '').match(/\d+/)?.[0] ?? 0),
    responseTimeHours:  0,
    rating:             0,
    reviewCount:        0,
    isVerified:         !!row.verifiedAt,
    profileImageUri:    row.photos?.[0] ?? undefined,
    galleryUris:        row.photos ?? [],
    yearsInBusiness:    Number(row.yearsInBusiness ?? 0),
    teamSize:           '',
    productionCapacity: '',
    specialties:        [row.specialty ?? ''].filter(Boolean),
    categories:         [row.specialty ?? ''].filter(Boolean),
    capabilities:       [],
    certifications:     [],
    materials:          [],
    shippingRegions:    [row.country].filter(Boolean),
    website:            row.website ?? undefined,
    email:              row.contactEmail ?? undefined,
    createdAt:          row.createdAt ?? now(),
  } as unknown as Manufacturer;
}

function apiRowToQuoteRequest(row: any): QuoteRequest {
  return {
    id:              row.id,
    sellerId:        row.sellerId,
    manufacturerId:  row.manufacturerId,
    productName:     row.productName,
    status:          row.status,
    quantity:        row.quantity ?? 100,
    materials:       [],
    colorways:       row.colorways ? [row.colorways] : [],
    sizes:           [],
    variantQuantities: {},
    hasEmbroidery:   false,
    hasWash:         false,
    hasHardware:     false,
    hasLabels:       false,
    customPackaging: false,
    fileIds:         [],
    currentStep:     3,
    isDraft:         false,
    sampleRequired:  row.type === 'sample',
    submittedAt:     row.createdAt,
    createdAt:       row.createdAt,
    updatedAt:       row.updatedAt,
  } as unknown as QuoteRequest;
}

export async function searchManufacturers(opts: {
  query?: string;
  country?: string;
  category?: string;
  moqMax?: number;
  unitPriceMaxCents?: number;
  leadTimeDaysMax?: number;
  verifiedOnly?: boolean;
  ratingMin?: number;
  material?: string;
}): Promise<Manufacturer[]> {
  const params: Record<string, string> = {};
  if (opts.query)    params.q         = opts.query;
  if (opts.country)  params.country   = opts.country;
  if (opts.category) params.specialty = opts.category;

  const qs = Object.keys(params).length
    ? '?' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
    : '';
  const apiRows = await serviceRequest<any[]>(`/api/manufacturers/public${qs}`);
  let results = apiRows.map(apiRowToManufacturer);
  const q = opts.query?.toLowerCase().trim() ?? '';
  if (q) {
    results = results.filter(m =>
      m.name.toLowerCase().includes(q) ||
      m.country.toLowerCase().includes(q) ||
      m.city.toLowerCase().includes(q) ||
      m.categories.some(c => c.toLowerCase().includes(q)) ||
      m.specialties.some(s => s.toLowerCase().includes(q)) ||
      m.certifications.some(c => c.name.toLowerCase().includes(q)) ||
      m.materials.some(mat => mat.toLowerCase().includes(q))
    );
  }
  if (opts.country) results = results.filter(m => m.country === opts.country);
  if (opts.category) results = results.filter(m => m.categories.some(c => c.toLowerCase().includes(opts.category!.toLowerCase())));
  if (opts.moqMax !== undefined) results = results.filter(m => m.moq <= opts.moqMax!);
  if (opts.unitPriceMaxCents !== undefined) results = results.filter(m => m.unitPriceMinCents <= opts.unitPriceMaxCents!);
  if (opts.leadTimeDaysMax !== undefined) results = results.filter(m => m.leadTimeDays <= opts.leadTimeDaysMax!);
  if (opts.verifiedOnly) results = results.filter(m => m.isVerified);
  if (opts.ratingMin !== undefined) results = results.filter(m => m.rating >= opts.ratingMin!);
  if (opts.material) results = results.filter(m => m.materials.some(mat => mat.toLowerCase().includes(opts.material!.toLowerCase())));
  return results;
}

export async function getManufacturer(id: string): Promise<Manufacturer | undefined> {
  try {
    return apiRowToManufacturer(await serviceRequest<any>(`/api/manufacturers/public/${encodeURIComponent(id)}`));
  } catch {
    return undefined;
  }
}

// ─── Favorite Manufacturers (server-authoritative, seller-scoped) ─────────────

export async function getFavoriteManufacturerIds(): Promise<string[]> {
  const rows = await serviceRequest<Array<{ manufacturerId: string }>>('/api/manufacturers/favorites');
  if (!Array.isArray(rows)) throw new Error('Invalid favorite manufacturers response');
  return rows.map(row => row.manufacturerId);
}

export async function favoriteManufacturer(manufacturerId: string): Promise<void> {
  await serviceRequest('/api/manufacturers/favorites', {
    method: 'POST',
    body: JSON.stringify({ manufacturerId }),
  });
}

export async function unfavoriteManufacturer(manufacturerId: string): Promise<void> {
  await serviceRequest(`/api/manufacturers/favorites/${encodeURIComponent(manufacturerId)}`, {
    method: 'DELETE',
  });
}

// ─── Relationships ────────────────────────────────────────────────────────────

export async function getRelationships(): Promise<ManufacturerRelationship[]> {
  await ensureInitialized();
  return [..._relationships];
}

export async function getRelationship(manufacturerId: string): Promise<ManufacturerRelationship | undefined> {
  await ensureInitialized();
  return _relationships.find(r => r.manufacturerId === manufacturerId);
}

export async function saveManufacturer(manufacturerId: string): Promise<ManufacturerRelationship> {
  await ensureInitialized();
  const existing = _relationships.find(r => r.manufacturerId === manufacturerId);
  if (existing) {
    existing.status = existing.status === 'archived' ? 'saved' : existing.status;
    existing.updatedAt = now();
    await persistAll();
    return existing;
  }
  const rel: ManufacturerRelationship = {
    id: 'rel_' + uid(),
    sellerId: 'seller_001',
    manufacturerId,
    status: 'saved',
    activeProductIds: [],
    unreadCount: 0,
    createdAt: now(),
    updatedAt: now(),
  };
  _relationships.push(rel);
  await persistAll();
  return rel;
}

export async function unsaveManufacturer(manufacturerId: string): Promise<void> {
  await ensureInitialized();
  _relationships = _relationships.filter(r => r.manufacturerId !== manufacturerId);
  await persistAll();
}

export async function updateRelationshipStatus(
  manufacturerId: string,
  status: ManufacturerRelationship['status']
): Promise<void> {
  await ensureInitialized();
  const rel = _relationships.find(r => r.manufacturerId === manufacturerId);
  if (rel) { rel.status = status; rel.updatedAt = now(); await persistAll(); }
}

// ─── Invitations ──────────────────────────────────────────────────────────────

export async function getInvitations(): Promise<ManufacturerInvitation[]> {
  await ensureInitialized();
  return [..._invitations];
}

export async function createInvitation(data: Omit<ManufacturerInvitation, 'id' | 'sellerId' | 'status' | 'createdAt'>): Promise<ManufacturerInvitation> {
  // Try real API first
  try {
    const result = await serviceRequest<any>('/api/manufacturers/invite-tokens', {
      method: 'POST',
      body: JSON.stringify({
        companyName:  data.companyName,
        contactName:  data.contactName,
        contactEmail: data.email,
        notes:        data.notes,
      }),
    });
    // Normalise to ManufacturerInvitation shape
    return {
      id:          result.id,
      sellerId:    result.sellerId,
      status:      'pending',
      companyName: result.companyName ?? data.companyName,
      contactName: result.contactName ?? data.contactName,
      email:       data.email,
      inviteLink:  result.inviteUrl ?? `https://brandthread.app/manufacturer-onboard?token=${result.token}`,
      createdAt:   result.createdAt ?? now(),
    } as any;
  } catch (error) {
    // Authorization failures must never be replaced with a fake successful
    // invitation. Let the screen present the real upgrade path.
    if (getEntitlementRejection(error)) throw error;
  }

  await ensureInitialized();
  const inv: ManufacturerInvitation = {
    id: 'inv_' + uid(),
    sellerId: 'seller_001',
    status: 'pending',
    inviteLink: 'https://brandthread.app/join/inv_' + uid(),
    ...data,
    createdAt: now(),
  };
  _invitations.push(inv);
  await persistAll();
  return inv;
}

// ─── Quote Requests ───────────────────────────────────────────────────────────

export async function getQuoteRequests(): Promise<QuoteRequest[]> {
  try {
    const rows = await serviceRequest<any[]>('/api/seller-hub/quote-requests');
    const apiRequests = rows.map(apiRowToQuoteRequest);
    // Merge API results with any local-only drafts
    const apiIds = new Set(apiRequests.map(r => r.id));
    await ensureInitialized();
    const localDrafts = _quoteRequests.filter(r => r.isDraft && !apiIds.has(r.id));
    return [...apiRequests, ...localDrafts];
  } catch { /* fall through to local */ }
  await ensureInitialized();
  return [..._quoteRequests];
}

export async function getQuoteRequest(id: string): Promise<QuoteRequest | undefined> {
  await ensureInitialized();
  return _quoteRequests.find(q => q.id === id);
}

export async function saveQuoteRequestDraft(data: Partial<QuoteRequest> & { manufacturerId: string; productName: string }): Promise<QuoteRequest> {
  await ensureInitialized();
  const existing = data.id ? _quoteRequests.find(q => q.id === data.id) : undefined;
  if (existing) {
    Object.assign(existing, data, { updatedAt: now() });
    await persistAll();
    return existing;
  }
  const resolvedId = data.id ?? ('qr_' + uid());
  const qr: QuoteRequest = {
    status: 'draft',
    quantity: 100,
    sampleRequired: true,
    materials: [],
    colorways: [],
    sizes: [],
    variantQuantities: {},
    hasEmbroidery: false,
    hasWash: false,
    hasHardware: false,
    hasLabels: false,
    customPackaging: false,
    fileIds: [],
    currentStep: 1,
    isDraft: true,
    ...data,
    id: resolvedId,
    sellerId: 'seller_001',
    manufacturerId: data.manufacturerId,
    productName: data.productName,
    createdAt: data.createdAt ?? now(),
    updatedAt: now(),
  };
  _quoteRequests.push(qr);
  await persistAll();
  return qr;
}

export async function submitQuoteRequest(id: string): Promise<QuoteRequest | undefined> {
  await ensureInitialized();
  const qr = _quoteRequests.find(q => q.id === id);
  if (!qr) return undefined;
  qr.status = 'sent';
  qr.isDraft = false;
  qr.submittedAt = now();
  qr.expiresAt = futureDate(30);
  qr.updatedAt = now();
  // Also persist to server (fire-and-forget)
  serviceRequest('/api/seller-hub/quote-requests', {
    method: 'POST',
    body: JSON.stringify({
      manufacturerId: qr.manufacturerId,
      type:          qr.sampleRequired ? 'sample' : 'quote',
      productName:   qr.productName,
      productType:   'apparel',
      quantity:      qr.quantity,
      colorways:     qr.colorways?.join(', '),
      details:       qr.notes,
    }),
  }).catch(() => { /* non-fatal */ });
  await persistAll();

  // Auto-generate a demo quote response after a brief delay
  setTimeout(async () => {
    const mfg = _manufacturers.find(m => m.id === qr.manufacturerId);
    if (!mfg) return;
    const unitPriceCents = mfg.unitPriceMinCents + Math.floor(Math.random() * (mfg.unitPriceMaxCents - mfg.unitPriceMinCents + 1));
    const quote: Quote = {
      id: 'q_' + uid(),
      quoteRequestId: id,
      manufacturerId: qr.manufacturerId,
      sellerId: qr.sellerId,
      productName: qr.productName,
      quantity: qr.quantity,
      unitPriceCents,
      sampleCostCents: mfg.samplePriceMinCents,
      setupCostCents: 15000,
      packagingCostCents: centsAtPercent(unitPriceCents, 5),
      shippingEstimateCents: 38000,
      totalEstimateCents: sumCents(
        multiplyCents(qr.quantity, unitPriceCents),
        mfg.samplePriceMinCents,
        15000,
        centsAtPercent(unitPriceCents, 5),
        38000,
      ),
      moq: mfg.moq,
      leadTimeDays: mfg.leadTimeDays,
      productionDays: Math.round(mfg.leadTimeDays * 0.7),
      paymentTerms: '30% deposit, 70% before shipment',
      validUntil: futureDate(30),
      status: 'quote_received',
      lineItems: [],
      receivedAt: now(),
      updatedAt: now(),
    };
    _quotes.push(quote);
    qr.status = 'quote_received';
    qr.updatedAt = now();
    await persistAll();
  }, 1500);

  return qr;
}

// ─── Quotes ───────────────────────────────────────────────────────────────────

export async function getQuotes(): Promise<Quote[]> {
  await ensureInitialized();
  return [..._quotes];
}

export async function getQuote(id: string): Promise<Quote | undefined> {
  await ensureInitialized();
  return _quotes.find(q => q.id === id);
}

export async function getQuotesForRequest(quoteRequestId: string): Promise<Quote[]> {
  await ensureInitialized();
  return _quotes.filter(q => q.quoteRequestId === quoteRequestId);
}

export async function acceptQuote(quoteId: string): Promise<Quote | undefined> {
  await ensureInitialized();
  const q = _quotes.find(x => x.id === quoteId);
  if (q) { q.status = 'accepted'; q.updatedAt = now(); await persistAll(); }
  return q;
}

export async function declineQuote(quoteId: string): Promise<void> {
  await ensureInitialized();
  const q = _quotes.find(x => x.id === quoteId);
  if (q) { q.status = 'declined'; q.updatedAt = now(); await persistAll(); }
}

export async function submitCounteroffer(quoteId: string, data: Omit<Counteroffer, 'id' | 'quoteId' | 'sellerId' | 'status' | 'createdAt'>): Promise<Counteroffer> {
  await ensureInitialized();
  const co: Counteroffer = {
    id: 'co_' + uid(),
    quoteId,
    sellerId: 'seller_001',
    status: 'pending',
    ...data,
    createdAt: now(),
  };
  _counteroffers.push(co);
  const q = _quotes.find(x => x.id === quoteId);
  if (q) { q.status = 'counteroffer_sent'; q.updatedAt = now(); }
  await persistAll();
  return co;
}

export async function getCounteroffersForQuote(quoteId: string): Promise<Counteroffer[]> {
  await ensureInitialized();
  return _counteroffers.filter(c => c.quoteId === quoteId);
}

// ─── Samples ──────────────────────────────────────────────────────────────────

/**
 * Extracts an HTTP status from a serviceRequest error, if present.
 * serviceRequest throws `Error("API <status>: <body>")`; "Services not
 * configured" (no token wired) is treated as "not available" (status 0).
 */
function errorStatus(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("Services not configured")) return 0;
  const m = /^API (\d+):/.exec(msg);
  return m ? Number(m[1]) : null;
}

/**
 * Request a presigned PUT URL for uploading a sample image directly to GCS.
 * The server validates ownership + MIME/size and returns both the upload URL
 * and the normalized objectPath (client never parses the signed URL).
 */
export async function uploadSampleImage(
  sampleOrderId: string,
  contentType: string,
  bytes: Uint8Array,
): Promise<string[]> {
  const result = await serviceRequest<{ imageUrls: string[] }>(
    `/api/sample-orders/${sampleOrderId}/images/upload`,
    {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: bytes as unknown as BodyInit,
    },
  );
  return result.imageUrls ?? [];
}

/** Fetch the order's images as short-lived signed GET URLs. */
export async function getSampleImageUrls(sampleOrderId: string): Promise<string[]> {
  const result = await serviceRequest<{ imageUrls: string[] }>(
    `/api/sample-orders/${sampleOrderId}/images`,
  );
  return result.imageUrls ?? [];
}

export async function getSamples(): Promise<Sample[]> {
  const rows = await serviceRequest<any[]>('/api/sample-orders');
  if (!Array.isArray(rows)) throw new Error('Sample orders response was invalid.');
  return rows.map(row => mapSampleOrder(row));
}

export async function getSample(id: string): Promise<Sample | undefined> {
  const row = await serviceRequest<any>(`/api/sample-orders/${id}`);
  if (!row?.id) return undefined;
  const imageUris = await getSampleImageUrls(id);
  return mapSampleOrder(row, imageUris);
}

function mapSampleOrder(row: any, imageUris: string[] = []): Sample {
  let detail: { quoteId?: string; review?: SampleReview; revisions?: SampleRevision[] } = {};
  try { detail = JSON.parse(row.notes ?? '{}'); } catch { /* legacy freeform notes */ }
  const statusMap: Record<string, Sample['status']> = {
    payment_received: 'paid', processing: 'in_development',
    cut_and_sew: 'in_development', packing: 'in_development',
  };
  return {
    id:             row.id,
    sellerId:       row.sellerId,
    manufacturerId: row.manufacturerId ?? '',
    quoteId:        detail.quoteId,
    productName:    row.title ?? '',
    type:           'proto',
    status:         statusMap[row.status] ?? row.status ?? 'requested',
    costCents:      Number(row.priceCents ?? 0),
    paymentStatus:  row.status === 'payment_received' ? 'paid' : 'pending',
    imageUris,
    fileIds:        [],
    revisions:      detail.revisions ?? [],
    review:         detail.review,
    notes:          row.notes ?? undefined,
    createdAt:      row.createdAt ?? now(),
    updatedAt:      row.updatedAt ?? now(),
    threadId:       row.threadId ?? undefined,
    orderType:      row.orderType ?? 'sample',
    manufacturerName: row.manufacturerName ?? undefined,
    manufacturerCountry: row.manufacturerCountry ?? undefined,
    quantity:       Number(row.quantity ?? 1),
  } as Sample;
}

export async function createSample(data: {
  manufacturerId: string;
  quoteId?: string;
  productId?: string;
  productName: string;
  type?: Sample['type'];
  costCents: number;
}): Promise<Sample> {
  const row = await serviceRequest<any>('/api/sample-orders', {
    method: 'POST',
    body: JSON.stringify({
      manufacturerId: data.manufacturerId,
      orderType: 'sample',
      title: data.productName,
      quantity: 1,
      priceCents: Math.max(1, data.costCents),
      notes: JSON.stringify({ quoteId: data.quoteId }),
    }),
  });
  return mapSampleOrder(row);
}

export interface SampleCheckoutSession {
  sessionId: string;
  url: string | null;
  paymentStatus: string;
}
export interface BulkWalletOption {
  id: string;
  dropId: string;
  availableCents: number;
  eligible: boolean;
}

export async function createSampleCheckoutSession(sampleOrderId: string, returnUrl: string): Promise<SampleCheckoutSession> {
  return serviceRequest<SampleCheckoutSession>(`/api/sample-orders/${encodeURIComponent(sampleOrderId)}/checkout-session`, {
    method: 'POST', body: JSON.stringify({ returnUrl }),
  });
}

export async function confirmSamplePayment(sampleOrderId: string): Promise<Sample> {
  const row = await serviceRequest<any>(`/api/sample-orders/${encodeURIComponent(sampleOrderId)}/pay`, {
    method: 'POST', body: JSON.stringify({}),
  });
  return mapSampleOrder(row);
}

export async function getBulkWalletOptions(orderId: string): Promise<{ requiredCents: number; wallets: BulkWalletOption[] }> {
  return serviceRequest<{ orderId: string; requiredCents: number; wallets: BulkWalletOption[] }>(
    `/api/sample-orders/${encodeURIComponent(orderId)}/payment-options`,
  );
}

export async function payBulkOrderFromWallet(orderId: string, walletId: string): Promise<ProductionOrder> {
  const row = await serviceRequest<any>(`/api/sample-orders/${encodeURIComponent(orderId)}/pay-from-wallet`, {
    method: 'POST', body: JSON.stringify({ walletId }),
  });
  return mapBulkOrder(row);
}

export async function updateSampleStatus(id: string, status: Sample['status']): Promise<Sample | undefined> {
  const row = await serviceRequest<any>(`/api/sample-orders/${id}/sample-detail`, {
    method: 'PATCH', body: JSON.stringify({ status }),
  });
  return mapSampleOrder(row);
}

export async function submitSampleReview(sampleId: string, review: Omit<SampleReview, 'id' | 'sampleId' | 'sellerId' | 'createdAt'>): Promise<Sample | undefined> {
  const stored = { id: 'rev_' + uid(), sampleId, sellerId: 'seller_001', ...review, createdAt: now() };
  const status = review.decision === 'approved' ? 'approved' : review.decision === 'rejected' ? 'rejected' : 'revision_requested';
  const row = await serviceRequest<any>(`/api/sample-orders/${sampleId}/sample-detail`, {
    method: 'PATCH', body: JSON.stringify({ status, review: stored }),
  });
  return mapSampleOrder(row);
}

export async function addSampleRevision(sampleId: string, rev: Omit<SampleRevision, 'id' | 'sampleId' | 'sellerId' | 'status' | 'createdAt'>): Promise<Sample | undefined> {
  const revision: SampleRevision = { id: 'svr_' + uid(), sampleId, sellerId: 'seller_001', status: 'pending', ...rev, createdAt: now() };
  const row = await serviceRequest<any>(`/api/sample-orders/${sampleId}/sample-detail`, {
    method: 'PATCH', body: JSON.stringify({ status: 'revision_requested', revision }),
  });
  return mapSampleOrder(row);
}

// ─── Production Orders ────────────────────────────────────────────────────────

export async function getProductionOrders(): Promise<ProductionOrder[]> {
  const rows = await serviceRequest<any[]>('/api/sample-orders');
  if (!Array.isArray(rows)) throw new Error('Production orders response was invalid.');
  return rows.filter(row => row.orderType === 'bulk').map(mapBulkOrder);
}

export async function getProductionOrder(id: string): Promise<ProductionOrder | undefined> {
  const row = await serviceRequest<any>(`/api/sample-orders/${encodeURIComponent(id)}`);
  if (!row?.id || row.orderType !== 'bulk') return undefined;
  return mapBulkOrder(row);
}

function mapBulkOrder(row: any): ProductionOrder {
  const stageMap: Record<string, ProductionStageKey> = {
    pending_payment: 'deposit_pending', payment_received: 'deposit_paid',
    processing: 'materials_sourcing', cut_and_sew: 'sewing', packing: 'packaging',
    shipped: 'shipped', delivered: 'delivered',
  };
  const currentStage = stageMap[row.status] ?? 'quote_accepted';
  const currentIndex = PRODUCTION_STAGES.findIndex(stage => stage.key === currentStage);
  return {
    id: row.id, sellerId: row.sellerId, manufacturerId: row.manufacturerId,
    quoteId: '', productName: row.title ?? '', status: row.status === 'delivered' ? 'completed' : row.status === 'pending_payment' ? 'pending' : 'active',
    quantity: Number(row.quantity ?? 1), variants: {},
    totalCostCents: Number(row.priceCents ?? 0), depositAmountCents: row.status === 'pending_payment' ? 0 : Number(row.priceCents ?? 0),
    remainingBalanceCents: row.status === 'pending_payment' ? Number(row.priceCents ?? 0) : 0,
    currentStage,
    stages: PRODUCTION_STAGES.map((stage, index) => ({ ...stage, completedAt: index < currentIndex ? row.updatedAt : undefined })),
    updates: [], qcChecklist: [], issues: [], payments: [], fileIds: [],
    trackingNumber: row.trackingNumber ?? undefined, trackingCarrier: row.carrier ?? undefined,
    deliveredDate: row.deliveredAt ?? undefined, notes: row.description ?? row.notes ?? undefined,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
    estimatedCompletionDate: undefined,
    threadId: row.threadId, manufacturerName: row.manufacturerName,
    walletPaymentState: row.walletPaymentState ?? null,
  } as ProductionOrder;
}

export async function createProductionOrder(data: {
  manufacturerId: string;
  quoteId: string;
  sampleId?: string;
  productId?: string;
  productName: string;
  quantity: number;
  variants?: Record<string, number>;
  totalCostCents: number;
  depositAmountCents: number;
}): Promise<ProductionOrder> {
  await ensureInitialized();
  const stages: ProductionStage[] = PRODUCTION_STAGES.map(s => ({ key: s.key, label: s.label }));
  stages[0].completedAt = now(); // quote_accepted already done

  const qcChecklist: QualityControlCheck[] = ['Measurements', 'Stitching', 'Fabric', 'Color', 'Print', 'Embroidery', 'Hardware', 'Labels', 'Packaging', 'Quantity', 'Damage check'].map(cat => ({
    id: 'qc_' + uid(),
    category: cat,
    label: cat,
    imageUris: [],
  }));

  const payments: ManufacturerPaymentRecord[] = [
    { id: 'pay_' + uid(), productionOrderId: '', type: 'deposit', amountCents: data.depositAmountCents, currency: 'USD', status: 'due', dueDate: futureDate(7), createdAt: now() },
    { id: 'pay_' + uid(), productionOrderId: '', type: 'final', amountCents: data.totalCostCents - data.depositAmountCents, currency: 'USD', status: 'pending', dueDate: futureDate(data.quantity > 100 ? 60 : 45), createdAt: now() },
  ];

  const order: ProductionOrder = {
    id: 'prod_' + uid(),
    sellerId: 'seller_001',
    manufacturerId: data.manufacturerId,
    quoteId: data.quoteId,
    sampleId: data.sampleId,
    productId: data.productId,
    productName: data.productName,
    status: 'active',
    quantity: data.quantity,
    variants: data.variants ?? {},
    totalCostCents: data.totalCostCents,
    depositAmountCents: data.depositAmountCents,
    remainingBalanceCents: data.totalCostCents - data.depositAmountCents,
    startDate: now(),
    estimatedCompletionDate: futureDate(45),
    currentStage: 'deposit_pending',
    stages,
    updates: [],
    qcChecklist,
    issues: [],
    payments: payments.map(p => ({ ...p, productionOrderId: 'prod_placeholder' })),
    fileIds: [],
    createdAt: now(),
    updatedAt: now(),
  };
  // fix productionOrderId references
  order.payments = order.payments.map(p => ({ ...p, productionOrderId: order.id }));
  _productionOrders.push(order);
  await persistAll();
  return order;
}

export async function advanceProductionStage(orderId: string): Promise<ProductionOrder | undefined> {
  await ensureInitialized();
  const order = _productionOrders.find(p => p.id === orderId);
  if (!order) return undefined;
  const stageKeys = PRODUCTION_STAGES.map(s => s.key);
  const currentIdx = stageKeys.indexOf(order.currentStage);
  if (currentIdx < stageKeys.length - 1) {
    order.stages[currentIdx].completedAt = now();
    order.currentStage = stageKeys[currentIdx + 1];
    order.updates.push({
      id: 'upd_' + uid(),
      productionOrderId: orderId,
      stage: order.currentStage,
      message: 'Stage advanced to: ' + PRODUCTION_STAGES[currentIdx + 1].label,
      imageUris: [],
      fileIds: [],
      isDelayNotice: false,
      createdAt: now(),
      createdBy: 'system',
    });
    if (order.currentStage === 'delivered') {
      order.status = 'completed';
      order.actualCompletionDate = now();
    }
    order.updatedAt = now();
    await persistAll();
  }
  return order;
}

export async function addProductionUpdate(orderId: string, update: {
  message: string;
  stage?: ProductionStageKey;
  imageUris?: string[];
  isDelayNotice?: boolean;
  newEstimatedDate?: string;
}): Promise<ProductionOrder | undefined> {
  await ensureInitialized();
  const order = _productionOrders.find(p => p.id === orderId);
  if (!order) return undefined;
  order.updates.unshift({
    id: 'upd_' + uid(),
    productionOrderId: orderId,
    message: update.message,
    stage: update.stage,
    imageUris: update.imageUris ?? [],
    fileIds: [],
    isDelayNotice: update.isDelayNotice ?? false,
    newEstimatedDate: update.newEstimatedDate,
    createdAt: now(),
    createdBy: 'seller',
  });
  if (update.newEstimatedDate) order.estimatedCompletionDate = update.newEstimatedDate;
  order.updatedAt = now();
  await persistAll();
  return order;
}

export async function updateQcCheck(orderId: string, checkId: string, result: QualityControlCheck['result'], notes?: string): Promise<void> {
  await ensureInitialized();
  const order = _productionOrders.find(p => p.id === orderId);
  if (!order) return;
  const check = order.qcChecklist.find(c => c.id === checkId);
  if (check) { check.result = result; if (notes) check.notes = notes; }
  order.updatedAt = now();
  await persistAll();
}

export async function reportProductionIssue(orderId: string, issue: Omit<ProductionIssue, 'id' | 'productionOrderId' | 'status' | 'createdAt' | 'updatedAt'>): Promise<ProductionIssue> {
  await ensureInitialized();
  const order = _productionOrders.find(p => p.id === orderId);
  const newIssue: ProductionIssue = {
    id: 'iss_' + uid(),
    productionOrderId: orderId,
    status: 'open',
    ...issue,
    createdAt: now(),
    updatedAt: now(),
  };
  order?.issues.push(newIssue);
  if (order) order.updatedAt = now();
  await persistAll();
  return newIssue;
}

export async function resolveProductionIssue(orderId: string, issueId: string, notes: string): Promise<void> {
  await ensureInitialized();
  const order = _productionOrders.find(p => p.id === orderId);
  const issue = order?.issues.find(i => i.id === issueId);
  if (issue) { issue.status = 'resolved'; issue.resolvedAt = now(); issue.resolvedNotes = notes; issue.updatedAt = now(); }
  if (order) order.updatedAt = now();
  await persistAll();
}

export async function confirmDelivery(orderId: string): Promise<void> {
  await ensureInitialized();
  const order = _productionOrders.find(p => p.id === orderId);
  if (order) {
    order.currentStage = 'delivered';
    order.status = 'completed';
    order.deliveredDate = now();
    order.actualCompletionDate = now();
    order.updatedAt = now();
    await persistAll();
  }
}

// ─── Messaging ────────────────────────────────────────────────────────────────

export async function getConversations(): Promise<ManufacturerConversation[]> {
  const rows = await serviceRequest<ManufacturerThread[]>('/api/manufacturers/threads');
  return rows.map(row => ({
    id: row.id, sellerId: '', manufacturerId: row.manufacturerId,
    manufacturerName: row.manufacturerName, contextLabel: row.subject,
    lastMessage: row.lastMessage ?? undefined, lastMessageAt: row.lastMessageAt,
    unreadCount: row.unreadCount, messages: [], createdAt: row.createdAt,
    updatedAt: row.lastMessageAt,
  }));
}

export async function getOrCreateConversation(manufacturerId: string, opts?: {
  productId?: string; quoteId?: string; sampleId?: string; productionId?: string; contextLabel?: string;
}): Promise<ManufacturerConversation> {
  const row = await serviceRequest<any>('/api/manufacturers/threads', {
    method: 'POST',
    body: JSON.stringify({ manufacturerId, subject: opts?.contextLabel ?? 'General' }),
  });
  return {
    id: row.id, sellerId: row.buyerClerkId ?? '', manufacturerId,
    manufacturerName: row.manufacturerName ?? 'Manufacturer',
    contextLabel: row.subject ?? opts?.contextLabel ?? 'General',
    unreadCount: row.sellerUnreadCount ?? 0, messages: [],
    lastMessage: row.lastMessage, lastMessageAt: row.lastMessageAt,
    createdAt: row.createdAt, updatedAt: row.lastMessageAt,
  };
}

export async function sendMessage(conversationId: string, data: {
  text: string;
  imageUris?: string[];
  attachmentType?: ManufacturerMessage['attachmentType'];
  attachmentId?: string;
  attachmentLabel?: string;
  isInternalNote?: boolean;
}): Promise<ManufacturerMessage> {
  await ensureInitialized();
  const conv = _conversations.find(c => c.id === conversationId);
  if (!conv) throw new Error('Conversation not found');
  const msg: ManufacturerMessage = {
    id: 'msg_' + uid(),
    conversationId,
    senderId: 'seller_001',
    senderType: 'seller',
    text: data.text,
    imageUris: data.imageUris ?? [],
    fileIds: [],
    attachmentType: data.attachmentType,
    attachmentId: data.attachmentId,
    attachmentLabel: data.attachmentLabel,
    isInternalNote: data.isInternalNote ?? false,
    createdAt: now(),
  };
  conv.messages.push(msg);
  conv.lastMessage = data.text;
  conv.lastMessageAt = now();
  conv.updatedAt = now();
  await persistAll();
  return msg;
}

export async function markConversationRead(conversationId: string): Promise<void> {
  await ensureInitialized();
  const conv = _conversations.find(c => c.id === conversationId);
  if (conv) { conv.unreadCount = 0; conv.messages.forEach(m => { if (!m.readAt) m.readAt = now(); }); }
  await persistAll();
}

// ─── Files ────────────────────────────────────────────────────────────────────

export async function getFiles(opts?: { manufacturerId?: string; productId?: string; quoteId?: string }): Promise<ManufacturerFile[]> {
  await ensureInitialized();
  let results = [..._files];
  if (opts?.manufacturerId) results = results.filter(f => f.manufacturerId === opts.manufacturerId);
  if (opts?.productId) results = results.filter(f => f.productId === opts.productId);
  if (opts?.quoteId) results = results.filter(f => f.quoteId === opts.quoteId);
  return results;
}

export async function addFile(data: Omit<ManufacturerFile, 'id' | 'sellerId' | 'createdAt'>): Promise<ManufacturerFile> {
  await ensureInitialized();
  const file: ManufacturerFile = { id: 'file_' + uid(), sellerId: 'seller_001', ...data, createdAt: now() };
  _files.push(file);
  await persistAll();
  return file;
}

export async function deleteFile(fileId: string): Promise<void> {
  await ensureInitialized();
  _files = _files.filter(f => f.id !== fileId);
  await persistAll();
}

// ─── Hub stats (for seller home integration) ──────────────────────────────────

export async function getHubStats(): Promise<{
  activeQuotes: number;
  quotesDueToExpire: number;
  samplesNeedingReview: number;
  activeProduction: number;
  productionIssues: number;
  unreadMessages: number;
}> {
  await ensureInitialized();
  const sevenDays = futureDate(7);
  return {
    activeQuotes: _quotes.filter(q => !['declined','cancelled','accepted'].includes(q.status)).length,
    quotesDueToExpire: _quotes.filter(q => q.validUntil <= sevenDays && !['declined','cancelled','accepted'].includes(q.status)).length,
    samplesNeedingReview: _samples.filter(s => s.status === 'review_needed' || s.status === 'delivered').length,
    activeProduction: _productionOrders.filter(p => p.status === 'active').length,
    productionIssues: _productionOrders.flatMap(p => p.issues).filter(i => i.status === 'open').length,
    unreadMessages: _conversations.reduce((sum, c) => sum + c.unreadCount, 0),
  };
}
