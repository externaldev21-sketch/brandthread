/**
 * Manufacturer Hub — demo service layer with AsyncStorage persistence.
 * All writes persist across app restarts. Demo data seeds on first load.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { serviceRequest } from '../lib/serviceConfig';
import {
  Manufacturer, ManufacturerRelationship, ManufacturerInvitation,
  QuoteRequest, Quote, Counteroffer,
  Sample, SampleRevision, SampleReview,
  ProductionOrder, ProductionStage, ProductionUpdate, QualityControlCheck,
  ProductionIssue, ManufacturerPaymentRecord,
  ManufacturerConversation, ManufacturerMessage,
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
    samplePriceMin: 45,
    samplePriceMax: 90,
    unitPriceMin: 18,
    unitPriceMax: 35,
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
    samplePriceMin: 25,
    samplePriceMax: 60,
    unitPriceMin: 8,
    unitPriceMax: 22,
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
    samplePriceMin: 60,
    samplePriceMax: 120,
    unitPriceMin: 25,
    unitPriceMax: 55,
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
    samplePriceMin: 85,
    samplePriceMax: 150,
    unitPriceMin: 22,
    unitPriceMax: 48,
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
    samplePriceMin: 35,
    samplePriceMax: 80,
    unitPriceMin: 12,
    unitPriceMax: 32,
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
      lastMessagePreview: 'Looking forward to working with you!',
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
      lastMessage: 'Looking forward to working with you!',
      lastMessageAt: now(),
      unreadCount: 1,
      messages: [
        {
          id: 'msg_001',
          conversationId: 'conv_001',
          senderId: 'mfg_001',
          senderType: 'manufacturer',
          text: 'Hi! Thank you for connecting. Looking forward to working with you!',
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
    city:               '',
    specialty:          row.specialty ?? '',
    description:        row.description ?? '',
    moq:                row.moq ?? 100,
    samplePriceMin:     50,
    samplePriceMax:     150,
    unitPriceMin:       8,
    unitPriceMax:       30,
    leadTimeDays:       30,
    responseTimeHours:  24,
    rating:             0,
    reviewCount:        0,
    isVerified:         !!row.verifiedAt,
    profileImageUri:    row.photos?.[0] ?? undefined,
    galleryUris:        row.photos ?? [],
    yearsInBusiness:    0,
    teamSize:           '',
    productionCapacity: '',
    specialties:        [row.specialty ?? ''].filter(Boolean),
    categories:         [row.specialty ?? ''].filter(Boolean),
    capabilities:       [],
    certifications:     [],
    materials:          [],
    shippingRegions:    [row.country].filter(Boolean),
    website:            row.website ?? undefined,
    email:              undefined,
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
  unitPriceMax?: number;
  leadTimeDaysMax?: number;
  verifiedOnly?: boolean;
  ratingMin?: number;
  material?: string;
}): Promise<Manufacturer[]> {
  // Try real public directory API first
  try {
    const params: Record<string, string> = {};
    if (opts.query)    params.q         = opts.query;
    if (opts.country)  params.country   = opts.country;
    if (opts.category) params.specialty = opts.category;

    const qs = Object.keys(params).length
      ? '?' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
      : '';
    const apiRows = await serviceRequest<any[]>(`/api/manufacturers/public${qs}`);
    if (apiRows.length > 0) {
      const apiMfgs = apiRows.map(apiRowToManufacturer);
      const apiIds  = new Set(apiMfgs.map(m => m.id));
      const demoOnly = DEMO_MANUFACTURERS.filter(m => !apiIds.has(m.id));
      _manufacturers = [...apiMfgs, ...demoOnly];
    }
  } catch { /* fall through to demo */ }
  await ensureInitialized();
  let results = [..._manufacturers];
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
  if (opts.unitPriceMax !== undefined) results = results.filter(m => m.unitPriceMin <= opts.unitPriceMax!);
  if (opts.leadTimeDaysMax !== undefined) results = results.filter(m => m.leadTimeDays <= opts.leadTimeDaysMax!);
  if (opts.verifiedOnly) results = results.filter(m => m.isVerified);
  if (opts.ratingMin !== undefined) results = results.filter(m => m.rating >= opts.ratingMin!);
  if (opts.material) results = results.filter(m => m.materials.some(mat => mat.toLowerCase().includes(opts.material!.toLowerCase())));
  return results;
}

export async function getManufacturer(id: string): Promise<Manufacturer | undefined> {
  await ensureInitialized();
  return _manufacturers.find(m => m.id === id);
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
  } catch { /* fall through to demo */ }

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
    const unitPrice = +(mfg.unitPriceMin + Math.random() * (mfg.unitPriceMax - mfg.unitPriceMin)).toFixed(2);
    const quote: Quote = {
      id: 'q_' + uid(),
      quoteRequestId: id,
      manufacturerId: qr.manufacturerId,
      sellerId: qr.sellerId,
      productName: qr.productName,
      quantity: qr.quantity,
      unitPrice,
      sampleCost: mfg.samplePriceMin,
      setupCost: 150,
      packagingCost: +(unitPrice * 0.05).toFixed(2),
      shippingEstimate: 380,
      totalEstimate: +(qr.quantity * unitPrice + mfg.samplePriceMin + 150 + 380).toFixed(2),
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

export async function getSamples(): Promise<Sample[]> {
  await ensureInitialized();
  return [..._samples];
}

export async function getSample(id: string): Promise<Sample | undefined> {
  await ensureInitialized();
  return _samples.find(s => s.id === id);
}

export async function createSample(data: {
  manufacturerId: string;
  quoteId?: string;
  productId?: string;
  productName: string;
  type?: Sample['type'];
  cost: number;
}): Promise<Sample> {
  await ensureInitialized();
  const sample: Sample = {
    id: 'smp_' + uid(),
    sellerId: 'seller_001',
    manufacturerId: data.manufacturerId,
    quoteId: data.quoteId,
    productId: data.productId,
    productName: data.productName,
    type: data.type ?? 'proto',
    status: 'requested',
    cost: data.cost,
    paymentStatus: 'pending',
    estimatedCompletionDate: futureDate(21),
    imageUris: [],
    fileIds: [],
    revisions: [],
    createdAt: now(),
    updatedAt: now(),
  };
  _samples.push(sample);
  await persistAll();
  return sample;
}

export async function updateSampleStatus(id: string, status: Sample['status']): Promise<Sample | undefined> {
  await ensureInitialized();
  const s = _samples.find(x => x.id === id);
  if (s) {
    s.status = status;
    if (status === 'shipped') s.shippedDate = now();
    if (status === 'delivered') s.deliveredDate = now();
    s.updatedAt = now();
    await persistAll();
  }
  return s;
}

export async function submitSampleReview(sampleId: string, review: Omit<SampleReview, 'id' | 'sampleId' | 'sellerId' | 'createdAt'>): Promise<Sample | undefined> {
  await ensureInitialized();
  const s = _samples.find(x => x.id === sampleId);
  if (!s) return undefined;
  s.review = { id: 'rev_' + uid(), sampleId, sellerId: 'seller_001', ...review, createdAt: now() };
  s.status = review.decision === 'approved' ? 'approved' : review.decision === 'rejected' ? 'rejected' : 'revision_requested';
  s.updatedAt = now();
  await persistAll();
  return s;
}

export async function addSampleRevision(sampleId: string, rev: Omit<SampleRevision, 'id' | 'sampleId' | 'sellerId' | 'status' | 'createdAt'>): Promise<Sample | undefined> {
  await ensureInitialized();
  const s = _samples.find(x => x.id === sampleId);
  if (!s) return undefined;
  const revision: SampleRevision = { id: 'svr_' + uid(), sampleId, sellerId: 'seller_001', status: 'pending', ...rev, createdAt: now() };
  s.revisions.push(revision);
  s.status = 'revision_requested';
  s.updatedAt = now();
  await persistAll();
  return s;
}

// ─── Production Orders ────────────────────────────────────────────────────────

export async function getProductionOrders(): Promise<ProductionOrder[]> {
  await ensureInitialized();
  return [..._productionOrders];
}

export async function getProductionOrder(id: string): Promise<ProductionOrder | undefined> {
  await ensureInitialized();
  return _productionOrders.find(p => p.id === id);
}

export async function createProductionOrder(data: {
  manufacturerId: string;
  quoteId: string;
  sampleId?: string;
  productId?: string;
  productName: string;
  quantity: number;
  variants?: Record<string, number>;
  totalCost: number;
  depositAmount: number;
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
    { id: 'pay_' + uid(), productionOrderId: '', type: 'deposit', amount: data.depositAmount, currency: 'USD', status: 'due', dueDate: futureDate(7), createdAt: now() },
    { id: 'pay_' + uid(), productionOrderId: '', type: 'final', amount: data.totalCost - data.depositAmount, currency: 'USD', status: 'pending', dueDate: futureDate(data.quantity > 100 ? 60 : 45), createdAt: now() },
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
    totalCost: data.totalCost,
    depositAmount: data.depositAmount,
    remainingBalance: data.totalCost - data.depositAmount,
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
  await ensureInitialized();
  return [..._conversations].sort((a, b) =>
    (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '')
  );
}

export async function getOrCreateConversation(manufacturerId: string, opts?: {
  productId?: string; quoteId?: string; sampleId?: string; productionId?: string; contextLabel?: string;
}): Promise<ManufacturerConversation> {
  await ensureInitialized();
  const mfg = _manufacturers.find(m => m.id === manufacturerId);
  let conv = _conversations.find(c => c.manufacturerId === manufacturerId &&
    c.quoteId === opts?.quoteId && c.productionId === opts?.productionId);
  if (!conv) {
    conv = {
      id: 'conv_' + uid(),
      sellerId: 'seller_001',
      manufacturerId,
      manufacturerName: mfg?.name ?? 'Manufacturer',
      productId: opts?.productId,
      quoteId: opts?.quoteId,
      sampleId: opts?.sampleId,
      productionId: opts?.productionId,
      contextLabel: opts?.contextLabel ?? 'General',
      unreadCount: 0,
      messages: [],
      createdAt: now(),
      updatedAt: now(),
    };
    _conversations.push(conv);
    await persistAll();
  }
  return conv;
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
