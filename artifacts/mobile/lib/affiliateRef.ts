/**
 * Creator link capture. A link like https://brandthread.app/...?aff=CODE is
 * remembered on the device, recorded as a click (public endpoint), and - once
 * the person is signed in - attached to their account so the server can credit
 * the creator for the program's attribution window. The server owns the window
 * and the self-referral rule; this file only carries the code.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'bt_affiliate_ref';
const VISITOR_KEY = 'bt_affiliate_visitor';

export function parseAffiliateCode(url: string | null | undefined): string | null {
  if (!url) return null;
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1).split('#')[0] : '';
  const raw = new URLSearchParams(query).get('aff');
  const code = raw?.trim().toUpperCase() ?? '';
  return /^[A-Z0-9][A-Z0-9-]{2,23}$/.test(code) ? code : null;
}

export async function readPendingAffiliateCode(): Promise<string | null> {
  try { return await AsyncStorage.getItem(KEY); } catch { return null; }
}

export async function savePendingAffiliateCode(code: string): Promise<void> {
  try { await AsyncStorage.setItem(KEY, code); } catch { /* best effort */ }
}

export async function clearPendingAffiliateCode(): Promise<void> {
  try { await AsyncStorage.removeItem(KEY); } catch { /* best effort */ }
}

export async function affiliateVisitorId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(VISITOR_KEY);
    if (existing) return existing;
    const made = `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
    await AsyncStorage.setItem(VISITOR_KEY, made);
    return made;
  } catch {
    return `v${Math.random().toString(36).slice(2, 14)}`;
  }
}
