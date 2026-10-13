export const COOKIE_CONSENT_VERSION = 1;
export type CookieConsent = { version: number; timestamp: number; necessary: true; analytics: boolean; marketing: boolean };
export const canUseAnalytics = (value: CookieConsent | null | undefined) =>
  (value?.version ?? 0) >= COOKIE_CONSENT_VERSION && value?.analytics === true;
export const canUseMarketing = (value: CookieConsent | null | undefined) =>
  (value?.version ?? 0) >= COOKIE_CONSENT_VERSION && value?.marketing === true;
// ─── Where the consent card is shown ─────────────────────────────────────────

/** Time zones of the EU/EEA, the UK and Switzerland — where the ePrivacy
 *  rules (and UK PECR / Swiss FADP) require asking before optional storage.
 *  Read locally from the browser; nothing is sent anywhere. */
const CONSENT_REGION_ZONES = new Set([
  'Atlantic/Azores', 'Atlantic/Canary', 'Atlantic/Faroe', 'Atlantic/Madeira', 'Atlantic/Reykjavik',
  'Africa/Ceuta', 'Asia/Nicosia', 'Asia/Famagusta', 'Arctic/Longyearbyen',
]);

/**
 * Whether a visitor in `timeZone` must be asked before optional storage.
 * Every `Europe/*` zone counts (EU/EEA, UK, Switzerland and neighbours), plus
 * the EU's Atlantic/African/Cypriot zones. An unknown zone counts too, so a
 * browser that hides its zone is still asked.
 */
export function isConsentRegion(timeZone: string | null | undefined): boolean {
  if (!timeZone) return true;
  return timeZone.startsWith('Europe/') || CONSENT_REGION_ZONES.has(timeZone);
}

export function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

export type StoredConsentRead =
  | { kind: 'none' }
  | { kind: 'choice'; consent: CookieConsent }
  /** Unreadable storage: fail closed. Optional storage stays off and the card
   *  is not shown again on every launch. */
  | { kind: 'error' };

export function parseStoredConsent(raw: string | null | undefined): StoredConsentRead {
  if (raw == null) return { kind: 'none' };
  try {
    const parsed = JSON.parse(raw) as CookieConsent;
    if (parsed && parsed.necessary === true && typeof parsed.version === 'number') return { kind: 'choice', consent: parsed };
    return { kind: 'none' };
  } catch {
    return { kind: 'error' };
  }
}

/** A stored choice still applies if it was made for the current (or a newer)
 *  consent version. A newer version's purposes need asking again. */
export function isCurrentChoice(consent: CookieConsent | null | undefined): consent is CookieConsent {
  return !!consent && consent.necessary === true && consent.version >= COOKIE_CONSENT_VERSION;
}

/** Never downgrade: a choice saved by a newer build is never overwritten by
 *  this build's older version number. */
export function nextStoredConsent(existing: CookieConsent | null, choices: Pick<CookieConsent, 'analytics' | 'marketing'>, now: number): CookieConsent {
  return {
    version: Math.max(COOKIE_CONSENT_VERSION, existing?.version ?? 0),
    timestamp: now,
    necessary: true,
    analytics: choices.analytics === true,
    marketing: choices.marketing === true,
  };
}

export function shouldShowConsentCard(input: {
  platform: string;
  loaded: boolean;
  read: StoredConsentRead;
  inConsentRegion: boolean;
  coachVisible: boolean;
  suppressedRoute: boolean;
  captureMode: boolean;
}): boolean {
  if (input.platform !== 'web') return false; // native: no cookies; see the PR / docs/app-store/privacy-labels.md
  if (!input.loaded || input.captureMode || input.suppressedRoute) return false;
  if (!input.inConsentRegion) return false;
  if (input.read.kind === 'error') return false;
  if (input.read.kind === 'choice' && isCurrentChoice(input.read.consent)) return false;
  // Queued, not dropped: shows as soon as the first-run coach is dismissed.
  return !input.coachVisible;
}
