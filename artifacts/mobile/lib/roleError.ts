/**
 * Utilities for detecting 403 ROLE_REQUIRED responses from owner-gated endpoints.
 *
 * api.ts throws ApiError instances whose message is human-readable, while the
 * response body keeps the structured role metadata. Older callers may still
 * throw an Error containing the serialized response after `API 403:`.
 */

import { ApiError } from '@/lib/networkNotice';

export type TeamRole = 'owner' | 'manager' | 'staff';

export interface RoleError {
  code: 'ROLE_REQUIRED';
  requiredRole: string;
  currentRole: string;
  message: string;
}

export function isTeamRole(role: unknown): role is TeamRole {
  return role === 'owner' || role === 'manager' || role === 'staff';
}

/** Managers can inspect billing data but cannot change owner-only settings. */
export function isManagerRole(role?: string | null): boolean {
  return role === 'manager';
}

function toRoleError(value: unknown): RoleError | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Record<string, unknown>;
  const body = payload.error && typeof payload.error === 'object'
    ? payload.error as Record<string, unknown>
    : payload;
  if (body.code !== 'ROLE_REQUIRED') return null;

  const details = body.details && typeof body.details === 'object'
    ? body.details as Record<string, unknown>
    : {};
  return {
    code: 'ROLE_REQUIRED',
    requiredRole: typeof body.requiredRole === 'string'
      ? body.requiredRole
      : typeof details.requiredRole === 'string'
        ? details.requiredRole
        : 'owner',
    currentRole: typeof body.currentRole === 'string'
      ? body.currentRole
      : typeof details.currentRole === 'string'
        ? details.currentRole
        : 'unknown',
    message: typeof body.message === 'string'
      ? body.message
      : 'Owner access is required.',
  };
}

/**
 * Returns a RoleError if the thrown error is a 403 ROLE_REQUIRED response,
 * otherwise returns null.
 */
export function parseRoleError(err: unknown): RoleError | null {
  if (!(err instanceof Error)) return null;

  if (err instanceof ApiError) {
    if (err.status !== 403 || err.code !== 'ROLE_REQUIRED') return null;
    try {
      return toRoleError(JSON.parse(err.body));
    } catch {
      return null;
    }
  }

  const msg = err.message;
  if (!msg.startsWith('API 403:')) return null;
  try {
    return toRoleError(JSON.parse(msg.slice('API 403:'.length).trim()));
  } catch {
    // not JSON or unexpected shape
  }
  return null;
}
