/**
 * Utilities for detecting 403 ROLE_REQUIRED responses from owner-gated endpoints.
 *
 * api.ts throws: new Error(`API 403: ${body}`)
 * requireRole.ts body: { code: "ROLE_REQUIRED", requiredRole, currentRole, message }
 */

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

/**
 * Returns a RoleError if the thrown error is a 403 ROLE_REQUIRED response,
 * otherwise returns null.
 */
export function parseRoleError(err: unknown): RoleError | null {
  if (!(err instanceof Error)) return null;
  const msg = err.message;
  if (!msg.startsWith('API 403:')) return null;
  try {
    const json = JSON.parse(msg.slice('API 403:'.length).trim());
    if (json?.code === 'ROLE_REQUIRED') return json as RoleError;
  } catch {
    // not JSON or unexpected shape
  }
  return null;
}
