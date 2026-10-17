/**
 * Pure helpers for the authenticator-app (TOTP) setup flow.
 *
 * Clerk only returns backup codes once: on the resource returned by
 * `user.verifyTOTP()` (not `createTOTP()`), or from `user.createBackupCode()`.
 * The setup flow must show them before it lets the user finish.
 */
import { mapSecurityError, type SecurityErrorContext } from '@/lib/accountSecurityErrors';

/**
 * Known Clerk codes get the shared friendly copy; anything else shows the
 * real Clerk / runtime message instead of a vague "try again".
 */
export function describeTwoFactorError(err: unknown, context: SecurityErrorContext = 'twoFactor'): string {
  const mapped = mapSecurityError(err, context);
  if (mapped.kind !== 'unknown') return mapped.message;
  const e = err as { message?: unknown; errors?: Array<{ longMessage?: unknown; message?: unknown }> } | null | undefined;
  const first = Array.isArray(e?.errors) ? e!.errors[0] : undefined;
  const candidates = [first?.longMessage, first?.message, e?.message];
  for (const c of candidates) if (typeof c === 'string' && c.trim()) return c.trim();
  return mapped.message;
}

/** Pulls backup codes off a Clerk TOTP / BackupCode resource (either shape). */
export function extractBackupCodes(resource: unknown): string[] {
  if (!resource || typeof resource !== 'object') return [];
  const r = resource as { backupCodes?: unknown; codes?: unknown };
  const raw = Array.isArray(r.backupCodes) ? r.backupCodes : Array.isArray(r.codes) ? r.codes : [];
  const seen = new Set<string>();
  for (const code of raw) {
    if (typeof code !== 'string') continue;
    const trimmed = code.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

/** Plain-text body used for copy and share. */
export function formatBackupCodesForShare(codes: string[]): string {
  return [
    'Brandthread backup codes',
    'Each code can be used once to sign in if you lose access to your authenticator app.',
    '',
    ...codes,
  ].join('\n');
}

/** Setup can only finish once codes exist and the user confirmed saving them. */
export function canFinishTwoFactorSetup(input: { codes: string[]; acknowledged: boolean }): boolean {
  return input.codes.length > 0 && input.acknowledged;
}
