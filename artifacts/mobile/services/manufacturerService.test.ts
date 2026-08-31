import { describe, expect, it } from 'vitest';
import { mapPublicManufacturer } from './manufacturerDirectoryMapper';

describe('mapPublicManufacturer', () => {
  it('keeps persisted directory rating and response time', () => {
    const manufacturer = mapPublicManufacturer({
      id: 'b7d2c2d0-a3ae-4d65-90e4-d777f1f1bca1',
      businessName: 'Verified Factory',
      country: 'Portugal',
      specialty: 'Knitwear',
      yearsInBusiness: 12,
      moq: 50,
      priceRange: '$12–$20',
      bulkTurnaround: '18 days',
      sampleTurnaround: '8 days',
      photos: [],
      isVerified: true,
      rating: 4.7,
      reviewCount: 3,
      reviews: [{
        id: 'review-1',
        sellerId: 'seller-1',
        sellerName: 'Studio One',
        rating: 5,
        qualityRating: 5,
        communicationRating: 4,
        deliveryRating: 5,
        comment: 'Accurate sample.',
        createdAt: '2026-01-01T00:00:00.000Z',
      }],
      responseTime: '6 hours',
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    expect(manufacturer.rating).toBe(4.7);
    expect(manufacturer.responseTimeHours).toBe(6);
    expect(manufacturer.reviewCount).toBe(3);
    expect(manufacturer.reviews).toHaveLength(1);
  });
});