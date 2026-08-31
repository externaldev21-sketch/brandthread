import { describe, expect, it } from 'vitest';
import { cancellationReasonLabel } from './orderTypes';

describe('buyer cancellation labels', () => {
  it('uses a friendly label for buyer-requested cancellations', () => {
    expect(cancellationReasonLabel('buyer_requested')).toBe('You requested the cancellation');
  });

  it('uses the shared label mapping for seller cancellation reasons', () => {
    expect(cancellationReasonLabel('out_of_stock')).toBe('Out of stock');
  });
});