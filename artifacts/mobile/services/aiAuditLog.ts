/**
 * Brandthread AI Brain — Audit Log Service
 *
 * Private per-device log of all AI-suggested and AI-applied actions.
 * Maximum 200 entries. Never stores prompt content.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuditEntry } from './aiTypes';

const AUDIT_KEY  = 'bt:ai:audit:v1';
const MAX_ENTRIES = 200;

// ─── Load ─────────────────────────────────────────────────────────────────────

export async function getAuditLog(): Promise<AuditEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(AUDIT_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as AuditEntry[];
  } catch {
    return [];
  }
}

// ─── Add ──────────────────────────────────────────────────────────────────────

export async function addAuditEntry(entry: Omit<AuditEntry, 'id' | 'ts'>): Promise<void> {
  try {
    const log = await getAuditLog();
    const newEntry: AuditEntry = {
      ...entry,
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      ts: Date.now(),
    };
    const updated = [newEntry, ...log].slice(0, MAX_ENTRIES);
    await AsyncStorage.setItem(AUDIT_KEY, JSON.stringify(updated));
  } catch {}
}

// ─── Mark undone ──────────────────────────────────────────────────────────────

export async function markAuditEntryUndone(id: string): Promise<void> {
  try {
    const log = await getAuditLog();
    const updated = log.map(e => e.id === id ? { ...e, eventType: 'undone' as const } : e);
    await AsyncStorage.setItem(AUDIT_KEY, JSON.stringify(updated));
  } catch {}
}

// ─── Clear ────────────────────────────────────────────────────────────────────

export async function clearAuditLog(): Promise<void> {
  await AsyncStorage.removeItem(AUDIT_KEY);
}
