/**
 * Client helpers for the Brandthread subdomain on app/store-domain.tsx.
 * The server (GET/PUT /api/store/subdomain) owns validation, uniqueness and
 * the subdomain's state; these helpers only shape what the screen shows.
 */
import type { StoreSubdomainState } from '@/lib/api';
import { ApiError } from '@/lib/networkNotice';

/** Demo subdomain shown only in the dev web preview with &demo=1. */
export const DEMO_STORE_SUBDOMAIN: StoreSubdomainState = {
  subdomain: 'atelier-noire',
  status: 'active',
  assignedSlug: 'atelier-noire',
  suggestion: null,
  url: 'https://atelier-noire.brandthread.app',
  claimedAt: '2026-03-14T12:00:00.000Z',
};

/** Fresh preview (no &demo=1): nothing claimed, no suggestion. */
export const EMPTY_STORE_SUBDOMAIN: StoreSubdomainState = {
  subdomain: null,
  status: 'unclaimed',
  assignedSlug: '',
  suggestion: null,
  url: null,
  claimedAt: null,
};

/** Value the subdomain input starts with: the claimed name, else the handle-based suggestion. */
export function initialSubdomainInput(state: StoreSubdomainState | null): string {
  return state?.subdomain ?? state?.suggestion ?? '';
}

export function normalizeSubdomainInput(value: string): string {
  return value.trim().toLowerCase();
}

export function canSaveSubdomain(opts: {
  loading: boolean;
  loadFailed: boolean;
  saving: boolean;
  input: string;
  state: StoreSubdomainState | null;
  unavailable: boolean;
}): boolean {
  const value = normalizeSubdomainInput(opts.input);
  if (opts.loading || opts.loadFailed || opts.saving || !opts.state || !value) return false;
  if (opts.unavailable) return false;
  return !(opts.state.status === 'active' && opts.state.subdomain === value);
}

/** Readable message from a failed claim (400 validation / 409 taken / network). */
export function subdomainErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return 'That subdomain is already taken.';
    const msg = err.message.replace(/^API\s+\d{3}:\s*/, '');
    if (err.status === 400 && msg) return msg;
  }
  return "Couldn't save your subdomain. Check your connection and try again.";
}
