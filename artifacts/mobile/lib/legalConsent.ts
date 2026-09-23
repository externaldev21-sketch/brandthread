/**
 * Records agreement to the current legal documents on the account.
 *
 * Sign-up happens before the account exists on our server, so the checkbox
 * stores a pending agreement on the device; LegalAcceptanceGate flushes it to
 * POST /api/auth/legal-acceptance once the person is signed in. Anyone signed
 * in without an agreement for LEGAL_VERSION (existing accounts, OAuth sign-ups
 * from the sign-in screen, or after a version bump) is asked to agree before
 * continuing.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LEGAL_VERSION } from '@/content/legal';

export const PENDING_CONSENT_KEY = 'bt:legal-consent:pending:v1';

export async function rememberPendingConsent(version = LEGAL_VERSION): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_CONSENT_KEY, JSON.stringify({ version, agreedAt: new Date().toISOString() }));
  } catch {
    // If storage fails the gate simply asks again after sign-up.
  }
}

export async function readPendingConsent(): Promise<{ version: string; agreedAt: string } | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { version?: unknown; agreedAt?: unknown };
    return typeof parsed.version === 'string' && typeof parsed.agreedAt === 'string'
      ? { version: parsed.version, agreedAt: parsed.agreedAt }
      : null;
  } catch {
    return null;
  }
}

export async function clearPendingConsent(): Promise<void> {
  try { await AsyncStorage.removeItem(PENDING_CONSENT_KEY); } catch { /* best effort */ }
}

/** True when the account's recorded agreement covers the current documents. */
export function hasAcceptedCurrentTerms(termsVersion: string | null | undefined, current = LEGAL_VERSION): boolean {
  return typeof termsVersion === 'string' && termsVersion >= current;
}
