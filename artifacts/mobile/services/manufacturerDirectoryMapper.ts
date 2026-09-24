import { Manufacturer } from './manufacturerTypes';

function parseMoneyRange(value: unknown): [number, number] {
  const values = String(value ?? '').match(/\d+(?:\.\d{1,2})?/g)?.map(Number) ?? [];
  if (!values.length) return [0, 0];
  const cents = values.map((amount) => Math.round(amount * 100));
  return [cents[0], cents[1] ?? cents[0]];
}

function parseDays(value: unknown): number {
  return Number(String(value ?? '').match(/\d+/)?.[0] ?? 0);
}

export function mapPublicManufacturer(row: any): Manufacturer {
  const [unitPriceMinCents, unitPriceMaxCents] = parseMoneyRange(row.priceRange);
  const specialties = String(row.specialty ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  return {
    id: row.id, name: row.businessName ?? 'Manufacturer', country: row.country ?? '', city: row.city ?? '',
    description: row.description ?? '', profileImageUri: row.photos?.[0] ?? undefined,
    galleryUris: Array.isArray(row.photos) ? row.photos : [], yearsInBusiness: Number(row.yearsInBusiness ?? 0),
    teamSize: '', productionCapacity: '', specialties, categories: specialties, capabilities: [], certifications: [],
    materials: [], moq: Number(row.moq ?? 0), samplePriceMinCents: 0, samplePriceMaxCents: 0,
    unitPriceMinCents, unitPriceMaxCents, leadTimeDays: parseDays(row.bulkTurnaround),
    responseTimeHours: parseDays(row.responseTime), rating: Number(row.rating ?? 0), reviewCount: Number(row.reviewCount ?? 0),
    reviews: Array.isArray(row.reviews) ? row.reviews.map((review: any) => ({
      id: review.id,
      sellerId: review.sellerId ?? '',
      sellerName: review.sellerName ?? 'Verified seller',
      rating: Number(review.rating),
      qualityRating: Number(review.qualityRating),
      communicationRating: Number(review.communicationRating),
      deliveryRating: Number(review.deliveryRating),
      comment: review.comment ?? '',
      createdAt: review.createdAt,
    })) : [],
    isVerified: row.isVerified === true || !!row.verifiedAt, shippingRegions: row.country ? [row.country] : [],
    website: row.website ?? undefined, email: row.contactEmail ?? undefined, phone: row.contactPhone ?? undefined,
    timeZone: row.timeZone ?? null, isPublicDirectory: row.isPublicDirectory !== false,
    priceRangeLabel: row.priceRange || undefined, sampleTurnaround: row.sampleTurnaround || undefined,
    bulkTurnaround: row.bulkTurnaround || undefined,
    createdAt: row.createdAt ?? new Date().toISOString(),
  };
}