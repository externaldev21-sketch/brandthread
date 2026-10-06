import { describe, expect, it } from 'vitest';
import { billingAccess } from './billingAccess';

const base = { isSellerPreview: false, isLoadingRole: false, currentRole: 'owner' as string | null, roleError: false };

describe('billing access (QA-0048 / QA-0049)', () => {
  it('shows billing to the store owner', () => {
    expect(billingAccess(base)).toBe('owner');
  });
  it('shows the owner layout in the signed-out seller preview (demo or fresh) without locking', () => {
    expect(billingAccess({ ...base, isSellerPreview: true, currentRole: null })).toBe('preview');
  });
  it('offers a retry, not a lock, when the role could not be loaded', () => {
    expect(billingAccess({ ...base, currentRole: null, roleError: true })).toBe('retry');
    expect(billingAccess({ ...base, currentRole: null })).toBe('retry');
  });
  it('keeps managers read-only and locks other team roles', () => {
    expect(billingAccess({ ...base, currentRole: 'manager' })).toBe('read_only');
    expect(billingAccess({ ...base, currentRole: 'staff' })).toBe('locked');
  });
  it('waits for the role', () => {
    expect(billingAccess({ ...base, isLoadingRole: true, currentRole: null })).toBe('loading');
  });
});
