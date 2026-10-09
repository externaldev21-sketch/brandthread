/**
 * Native address-book access for "Find friends from contacts".
 *
 * expo-contacts is loaded lazily, inside this feature-local module only, so the
 * Expo Go / web startup graph never imports it (see
 * .agents/memory/expo-go-native-module-boundary.md). On web, or when the native
 * module is missing, everything reports 'unavailable' and the screen shows the
 * NativeOnlyFeature fallback instead of crashing.
 *
 * getContactsPermission() NEVER prompts. Only requestContactsPermission() does,
 * and the screen calls it solely from an explicit tap after the pre-permission
 * explanation.
 */
import { Platform } from 'react-native';
import type { ContactPoints, Sha256Hex } from '@/lib/contactHashing';

export type ContactsPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

type ContactsModule = typeof import('expo-contacts');

async function load(): Promise<ContactsModule | null> {
  if (Platform.OS === 'web') return null;
  try {
    return await import('expo-contacts');
  } catch {
    return null;
  }
}

function toPermission(status: string | undefined): ContactsPermission {
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

export async function getContactsPermission(): Promise<ContactsPermission> {
  const mod = await load();
  if (!mod) return 'unavailable';
  try {
    return toPermission((await mod.getPermissionsAsync()).status);
  } catch {
    return 'unavailable';
  }
}

/** Shows the OS prompt. Call only from an explicit user tap. */
export async function requestContactsPermission(): Promise<ContactsPermission> {
  const mod = await load();
  if (!mod) return 'unavailable';
  try {
    return toPermission((await mod.requestPermissionsAsync()).status);
  } catch {
    return 'unavailable';
  }
}

const PAGE_SIZE = 500;
const MAX_CONTACTS = 6000;

/** Reads only emails and phone numbers (no names, photos or notes). Stays in memory on the device. */
export async function readContactPoints(): Promise<ContactPoints> {
  const mod = await load();
  if (!mod) return { emails: [], phones: [] };
  const emails: string[] = [];
  const phones: string[] = [];
  let offset = 0;
  while (offset < MAX_CONTACTS) {
    const page = await mod.getContactsAsync({
      fields: [mod.Fields.Emails, mod.Fields.PhoneNumbers],
      pageSize: PAGE_SIZE,
      pageOffset: offset,
    });
    for (const c of page.data) {
      for (const e of c.emails ?? []) if (e.email) emails.push(e.email);
      for (const p of c.phoneNumbers ?? []) if (p.number) phones.push(p.number);
    }
    if (!page.hasNextPage || page.data.length === 0) break;
    offset += PAGE_SIZE;
  }
  return { emails, phones };
}

/** SHA-256 hex via expo-crypto (lazy, so the module is not in the startup graph). */
export const sha256Hex: Sha256Hex = async (input) => {
  const Crypto = await import('expo-crypto');
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input);
};
