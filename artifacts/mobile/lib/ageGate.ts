/**
 * Client side of the age gate. The date of birth lives only in memory here,
 * between the birthday screen and the authenticated POST /api/auth/age call,
 * and is never written to storage. The server derives and stores just the band.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/lib/api';

export type AgeBand = 'under_13' | '13_17' | '18_plus';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const MONTH_NAMES: readonly string[] = MONTHS;
export const MAX_AGE_YEARS = 120;

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

export function formatDob(year: number, month1: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Whole years completed on `now` (UTC calendar date); Feb 29 counts on Mar 1. Null for future/implausible. */
export function ageInYears(dob: string, now: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  if (d > daysInMonth(y, mo) || mo < 1 || mo > 12 || d < 1) return null;
  const ny = now.getUTCFullYear(); const nm = now.getUTCMonth() + 1; const nd = now.getUTCDate();
  if (y > ny || (y === ny && (mo > nm || (mo === nm && d > nd)))) return null;
  let age = ny - y;
  if (nm < mo || (nm === mo && nd < d)) age -= 1;
  return age > MAX_AGE_YEARS ? null : age;
}

export function bandFromAge(age: number): AgeBand {
  return age < 13 ? 'under_13' : age < 18 ? '13_17' : '18_plus';
}

export function bandMaySell(band: string | null | undefined): boolean {
  return band !== '13_17' && band !== 'under_13';
}

// ── transient in-memory DOB ───────────────────────────────────────────────────
let pendingDob: string | null = null;
export function setPendingDob(dob: string | null) { pendingDob = dob; }
export function peekPendingDob(): string | null { return pendingDob; }
export function takePendingDob(): string | null { const v = pendingDob; pendingDob = null; return v; }

export const DOB_PLACEHOLDER = 'MM/DD/YYYY';

/** Keeps digits only and inserts the slashes as the person types (MM/DD/YYYY). */
export function formatDobInput(text: string): string {
  const d = text.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

export type DobCheck = { ok: true; dob: string; band: AgeBand } | { ok: false; error: string };

/** Validates the typed date and the age rules for the current context. Nothing is stored here. */
export function checkDobInput(text: string, opts: { seller?: boolean } = {}, now: Date = new Date()): DobCheck {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!m) return { ok: false, error: 'Enter your date of birth.' };
  const dob = `${m[3]}-${m[1]}-${m[2]}`;
  const age = ageInYears(dob, now);
  if (age === null) return { ok: false, error: 'Enter a valid date of birth.' };
  const band = bandFromAge(age);
  if (band === 'under_13') return { ok: false, error: 'You must be at least 13 to create an account.' };
  if (band === '13_17' && opts.seller) return { ok: false, error: 'You must be 18 or older to sell.' };
  return { ok: true, dob, band };
}

/** Sends the birthday entered at sign-up once the account exists; the server keeps only the band. Best effort. */
export async function submitPendingAge(api: { ageGate: { submit: (dob: string) => Promise<unknown> } }): Promise<void> {
  const dob = takePendingDob();
  if (!dob) return;
  try { await api.ageGate.submit(dob); } catch { /* the inline ask at the first sell action covers a miss */ }
}

// ── seller restriction status ─────────────────────────────────────────────────
const bandCache = new Map<string, AgeBand | null>();
export type AgeStatus = 'unknown' | 'restricted' | 'ok';

function statusFor(band: AgeBand | null | undefined): AgeStatus {
  if (band === '13_17' || band === 'under_13') return 'restricted';
  return band === '18_plus' ? 'ok' : 'unknown';
}

/**
 * Age status of the signed-in account. 'unknown' = legacy account with no band yet
 * (asked inline at the first sell / go-live / payout action); 'restricted' = 13-17.
 * Signed-out or not-yet-loaded reads as 'ok' so nothing flashes or breaks.
 */
export function useAgeStatus(): { status: AgeStatus; setBand: (band: AgeBand) => void } {
  const { isSignedIn, userId } = useAuth();
  const api = useApi();
  const [status, setStatus] = useState<AgeStatus>(
    () => (userId && bandCache.has(userId) ? statusFor(bandCache.get(userId)) : 'ok'),
  );
  useEffect(() => {
    if (!isSignedIn || !userId) return;
    let cancelled = false;
    api.auth.me()
      .then((profile) => {
        const band = (profile.ageBand ?? null) as AgeBand | null;
        bandCache.set(userId, band);
        if (!cancelled) setStatus(statusFor(band));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [api, isSignedIn, userId]);
  const setBand = (band: AgeBand) => {
    if (userId) bandCache.set(userId, band);
    setStatus(statusFor(band));
  };
  return { status, setBand };
}

export const AGE_RESTRICTED_COPY = 'You must be 18 or older to sell, go live, or receive payouts.';
