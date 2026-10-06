import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/networkNotice', () => ({
  ApiError: class ApiError extends Error {
    constructor(public readonly status: number, message: string) { super(`API ${status}: ${message}`); }
  },
}));

import { ApiError } from '@/lib/networkNotice';
import {
  DEMO_STORE_SUBDOMAIN, EMPTY_STORE_SUBDOMAIN, canSaveSubdomain, initialSubdomainInput,
  subdomainErrorMessage,
} from '@/lib/storeSubdomain';

const unclaimed = { ...EMPTY_STORE_SUBDOMAIN, assignedSlug: 'store-1a2b', suggestion: 'atelier-noire' };
const base = { loading: false, loadFailed: false, saving: false, unavailable: false };

describe('initialSubdomainInput', () => {
  it('prefers the claimed subdomain, then the handle suggestion', () => {
    expect(initialSubdomainInput(DEMO_STORE_SUBDOMAIN)).toBe('atelier-noire');
    expect(initialSubdomainInput(unclaimed)).toBe('atelier-noire');
    expect(initialSubdomainInput(EMPTY_STORE_SUBDOMAIN)).toBe('');
    expect(initialSubdomainInput(null)).toBe('');
  });

  it('demo state is server-shaped and active (not client-verified)', () => {
    expect(DEMO_STORE_SUBDOMAIN.status).toBe('active');
    expect(DEMO_STORE_SUBDOMAIN.url).toBe('https://atelier-noire.brandthread.app');
  });
});

describe('canSaveSubdomain', () => {
  it('allows claiming the suggestion', () => {
    expect(canSaveSubdomain({ ...base, input: 'atelier-noire', state: unclaimed })).toBe(true);
  });

  it.each([
    ['while loading', { loading: true }],
    ['after a load error', { loadFailed: true }],
    ['while saving', { saving: true }],
    ['when unavailable', { unavailable: true }],
  ])('is disabled %s', (_label, overrides) => {
    expect(canSaveSubdomain({ ...base, ...overrides, input: 'atelier-noire', state: unclaimed })).toBe(false);
  });

  it('is disabled with no state, empty input, or the unchanged active name', () => {
    expect(canSaveSubdomain({ ...base, input: 'x-y-z', state: null })).toBe(false);
    expect(canSaveSubdomain({ ...base, input: '  ', state: unclaimed })).toBe(false);
    expect(canSaveSubdomain({ ...base, input: 'Atelier-Noire ', state: DEMO_STORE_SUBDOMAIN })).toBe(false);
    expect(canSaveSubdomain({ ...base, input: 'noire', state: DEMO_STORE_SUBDOMAIN })).toBe(true);
  });
});

describe('subdomainErrorMessage', () => {
  it('maps 409 to taken and passes 400 validation messages through', () => {
    expect(subdomainErrorMessage(new ApiError(409, 'x'))).toBe('That subdomain is already taken.');
    expect(subdomainErrorMessage(new ApiError(400, 'That subdomain is reserved.'))).toBe('That subdomain is reserved.');
  });

  it('falls back to a connection message', () => {
    expect(subdomainErrorMessage(new Error('Network request failed'))).toMatch(/connection/);
    expect(subdomainErrorMessage(new ApiError(500, 'boom'))).toMatch(/connection/);
  });
});
