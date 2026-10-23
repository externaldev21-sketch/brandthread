import { describe, expect, it } from 'vitest';
import { resolvePreviewRole } from '../previewRoleSelection';

describe('development preview role selection', () => {
  it('defaults to the buyer side without a selection', () => {
    expect(resolvePreviewRole('', null)).toBe('buyer');
  });

  it('remembers the buyer side after navigation removes the query', () => {
    expect(resolvePreviewRole('', 'buyer')).toBe('buyer');
    expect(resolvePreviewRole('?other=value', 'buyer')).toBe('buyer');
  });

  it('lets an explicit URL selection override the current demo side', () => {
    expect(resolvePreviewRole('?bt_preview=buyer', 'seller')).toBe('buyer');
    expect(resolvePreviewRole('?bt_preview=seller', 'buyer')).toBe('seller');
  });

  it('remembers an explicit seller choice and ignores invalid stored roles', () => {
    expect(resolvePreviewRole('', 'seller')).toBe('seller');
    expect(resolvePreviewRole('', 'admin')).toBe('buyer');
  });

  it('keeps guest testing selected until an explicit role overrides it', () => {
    expect(resolvePreviewRole('?bt_preview=guest', 'buyer')).toBe(null);
    expect(resolvePreviewRole('?bt_preview=guest', 'seller')).toBe(null);
    expect(resolvePreviewRole('', 'guest')).toBe(null);
    expect(resolvePreviewRole('?bt_preview=buyer', 'guest')).toBe('buyer');
    expect(resolvePreviewRole('?bt_preview=seller', 'guest')).toBe('seller');
  });
});