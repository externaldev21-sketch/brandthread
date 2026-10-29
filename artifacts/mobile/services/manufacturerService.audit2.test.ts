import { beforeEach, describe, expect, it, vi } from 'vitest';

const { serviceRequest } = vi.hoisted(() => ({ serviceRequest: vi.fn() }));

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest }));

import { SampleReviewNotPostedError, submitSampleReview } from './manufacturerService';
import { isStaleManufacturerWrite } from './manufacturerWriteRecovery';

const review = {
  decision: 'approved' as const, overallRating: 5, qualityRating: 5, fitRating: 5, materialRating: 5,
  colorRating: 5, printRating: 5, packagingRating: 5, notes: '', imageUris: [],
};

describe('submitSampleReview when the review POST fails after the decision is saved', () => {
  beforeEach(() => serviceRequest.mockReset());

  it('reports that the decision was saved and carries the saved sample', async () => {
    serviceRequest
      .mockResolvedValueOnce({ id: 'sample_1', manufacturerId: 'b7d2c2d0-a3ae-4d65-90e4-d777f1f1bca1', orderType: 'sample', status: 'approved', priceCents: 1200, revision: 4, createdAt: '2026-01-01', updatedAt: '2026-01-01' })
      .mockRejectedValueOnce(new Error('Network request failed'));

    const error = await submitSampleReview('sample_1', 3, review).catch((e) => e);
    expect(error).toBeInstanceOf(SampleReviewNotPostedError);
    expect(error.message).toMatch(/decision was saved/i);
    expect(error.sample).toMatchObject({ id: 'sample_1', status: 'approved', revision: 4 });
    expect(isStaleManufacturerWrite(error)).toBe(false);
  });
});
