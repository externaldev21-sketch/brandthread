import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(), setItem: vi.fn() } }));

import {
  COOKIE_CONSENT_VERSION, canUseAnalytics, isConsentRegion, isCurrentChoice, nextStoredConsent,
  parseStoredConsent, shouldShowConsentCard,
} from '@/lib/cookieConsent';
import { isAnyCoachVisible, resetCoachPresence, setCoachVisible } from '@/lib/coachPresence';

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');
const base = {
  platform: 'web', loaded: true, read: { kind: 'none' } as const, inConsentRegion: true,
  coachVisible: false, suppressedRoute: false, captureMode: false,
};
const choice = (version = COOKIE_CONSENT_VERSION, analytics = false) =>
  ({ version, timestamp: 1, necessary: true as const, analytics, marketing: false });

describe('where the consent card is shown', () => {
  it('EU/EEA, UK and Swiss time zones (and an unknown zone) are asked; others are not', () => {
    for (const tz of ['Europe/Berlin', 'Europe/London', 'Europe/Zurich', 'Atlantic/Canary', 'Asia/Nicosia', null]) {
      expect(isConsentRegion(tz), String(tz)).toBe(true);
    }
    for (const tz of ['America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Australia/Sydney']) {
      expect(isConsentRegion(tz), tz).toBe(false);
    }
  });

  it('never on native', () => {
    expect(shouldShowConsentCard({ ...base, platform: 'ios' })).toBe(false);
    expect(shouldShowConsentCard({ ...base, platform: 'android' })).toBe(false);
  });

  it('shows once on web in a consent region, then never again for the same version', () => {
    expect(shouldShowConsentCard(base)).toBe(true);
    expect(shouldShowConsentCard({ ...base, read: { kind: 'choice', consent: choice() } })).toBe(false);
    expect(shouldShowConsentCard({ ...base, inConsentRegion: false })).toBe(false);
  });

  it('is queued (not dropped) while a first-run coach is on screen', () => {
    expect(shouldShowConsentCard({ ...base, coachVisible: true })).toBe(false);
    expect(shouldShowConsentCard({ ...base, coachVisible: false })).toBe(true);
  });

  it('fails closed on unreadable storage: no card, optional storage stays off', () => {
    expect(parseStoredConsent('{not json')).toEqual({ kind: 'error' });
    expect(shouldShowConsentCard({ ...base, read: { kind: 'error' } })).toBe(false);
    expect(canUseAnalytics(null)).toBe(false);
  });

  it('waits for the stored choice to load, and stays off pre-auth routes and in capture mode', () => {
    expect(shouldShowConsentCard({ ...base, loaded: false })).toBe(false);
    expect(shouldShowConsentCard({ ...base, suppressedRoute: true })).toBe(false);
    expect(shouldShowConsentCard({ ...base, captureMode: true })).toBe(false);
  });
});

describe('never downgrade', () => {
  it('keeps a newer build\'s version when this build saves', () => {
    const newer = choice(COOKIE_CONSENT_VERSION + 1, true);
    expect(nextStoredConsent(newer, { analytics: false, marketing: false }, 5).version).toBe(COOKIE_CONSENT_VERSION + 1);
    expect(nextStoredConsent(null, { analytics: true, marketing: false }, 5)).toEqual(
      { version: COOKIE_CONSENT_VERSION, timestamp: 5, necessary: true, analytics: true, marketing: false });
  });

  it('a newer build\'s choice still counts here; an older one asks again', () => {
    expect(isCurrentChoice(choice(COOKIE_CONSENT_VERSION + 1))).toBe(true);
    expect(canUseAnalytics(choice(COOKIE_CONSENT_VERSION + 1, true))).toBe(true);
    expect(isCurrentChoice(choice(COOKIE_CONSENT_VERSION - 1))).toBe(false);
  });
});

describe('first-run coach presence', () => {
  beforeEach(() => resetCoachPresence());
  it('tracks every registered coach', () => {
    setCoachVisible('feed-gesture-guide', true);
    setCoachVisible('tip', true);
    setCoachVisible('feed-gesture-guide', false);
    expect(isAnyCoachVisible()).toBe(true);
    setCoachVisible('tip', false);
    expect(isAnyCoachVisible()).toBe(false);
  });

  it('the Watching Threads coach and the full-screen guide tip register themselves', () => {
    expect(read('components/FeedGestureGuide.tsx')).toMatch(/useRegisterCoach\('feed-gesture-guide', visible\)/);
    expect(read('components/first-run-tips/FullScreenGuideTip.tsx')).toMatch(/useRegisterCoach\(/);
  });
});

describe('the card is an overlay: the tab bar never moves', () => {
  const src = read('contexts/CookieConsentContext.tsx');

  it('renders in an absolute, touch-through full-screen layer at the root', () => {
    expect(src).toMatch(/<View pointerEvents="box-none" style=\{styles\.layer\}/);
    expect(src).toMatch(/layer: \{\s*position: 'absolute',\s*top: 0,\s*right: 0,\s*bottom: 0,\s*left: 0,/);
    expect(src).toMatch(/card: \{\s*position: 'absolute',/);
  });

  it('publishes no clearance and touches no safe-area inset', () => {
    expect(src).not.toMatch(/noticeClearance/);
    expect(src).not.toMatch(/useSafeAreaInsets|SafeAreaView|insets\./);
  });

  it('nothing in the app lays itself out around the consent card', () => {
    for (const f of ['components/buyer-nav/BuyerTabBar.tsx', 'components/SellerGlobalTabBar.tsx', 'app/_layout.tsx']) {
      expect(read(f), f).not.toMatch(/useCookieConsent|noticeClearance/);
    }
  });

  it('matches Dev\'s spec: short copy, two equal buttons, Settings link', () => {
    expect(src).toContain('We use necessary storage to run Brandthread. Analytics stay off unless you allow them.');
    expect(src).toMatch(/<View style=\{styles\.action\}>\s*<Button label="Only necessary" variant="secondary"[^>]*fullWidth/);
    expect(src).toMatch(/<View style=\{styles\.action\}>\s*<Button label="Allow all" variant="primary"[^>]*fullWidth/);
    expect(src).toMatch(/action: \{ flex: 1 \}/);
    expect(src).toMatch(/>Settings</);
    expect(src).toMatch(/borderRadius: RADII\.sheet/);
  });
});
