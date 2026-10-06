import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

import { PREVIEW_BUYER_IDENTITY, previewBuyerIdentity, profileShareUrl } from './previewBuyerIdentity';

describe('previewBuyerIdentity', () => {
  it('returns the demo identity only in demo mode', () => {
    expect(previewBuyerIdentity(true)).toEqual(PREVIEW_BUYER_IDENTITY);
    expect(previewBuyerIdentity(false)).toBeNull();
  });

  it('is never active outside a dev preview (default args under tests)', () => {
    expect(previewBuyerIdentity()).toBeNull();
  });
});

describe('profileShareUrl', () => {
  it('builds the canonical profile link from a username', () => {
    expect(profileShareUrl('Ava')).toBe('https://brandthread.app/u/ava');
    expect(profileShareUrl('@jo.doe_1 ')).toBe('https://brandthread.app/u/jodoe_1');
  });

  it('returns null when there is no usable username', () => {
    expect(profileShareUrl('')).toBeNull();
    expect(profileShareUrl(undefined)).toBeNull();
    expect(profileShareUrl('@')).toBeNull();
    expect(profileShareUrl('!!!')).toBeNull();
  });
});
