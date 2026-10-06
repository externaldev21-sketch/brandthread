import { describe, expect, it } from 'vitest';
import { statusBadgeRepeatsHeadline } from './buyerOrderCardStatus';

describe('statusBadgeRepeatsHeadline', () => {
  it('drops the pill when the headline already says delivered / refunded', () => {
    expect(statusBadgeRepeatsHeadline({ status: 'delivered', hasHeadline: true, autoRefunded: false })).toBe(true);
    expect(statusBadgeRepeatsHeadline({ status: 'refunded', hasHeadline: true, autoRefunded: false })).toBe(true);
    expect(statusBadgeRepeatsHeadline({ status: 'shipped', hasHeadline: true, autoRefunded: true })).toBe(true);
  });

  it('keeps the pill when the headline says something different or is absent', () => {
    expect(statusBadgeRepeatsHeadline({ status: 'shipped', hasHeadline: true, autoRefunded: false })).toBe(false);
    expect(statusBadgeRepeatsHeadline({ status: 'processing', hasHeadline: true, autoRefunded: false })).toBe(false);
    expect(statusBadgeRepeatsHeadline({ status: 'delivered', hasHeadline: false, autoRefunded: false })).toBe(false);
    expect(statusBadgeRepeatsHeadline({ status: 'cancelled', hasHeadline: false, autoRefunded: false })).toBe(false);
  });
});
