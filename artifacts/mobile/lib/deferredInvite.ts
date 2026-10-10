/**
 * Deferred invite links (BT-312): an invite code that survives the App Store.
 *
 * A friend taps https://brandthread.app/invite/CODE without the app. The web
 * invite page's "Download for iOS / Android" button copies that same link to
 * the clipboard (the page says so) and opens the store. On the app's FIRST
 * launch, signed out, the app reads it back once and opens /invite/CODE, which
 * already carries the code into onboarding (referralInviteePath).
 *
 * Reading only happens when the OS reports a URL / text on the clipboard
 * without reading it (hasUrlAsync / hasStringAsync never prompt); the read
 * itself shows iOS's "Allow Paste" prompt, which is the consent. One check per
 * install. EXPO_PUBLIC_DEFERRED_INVITE=0 switches it off.
 *
 * Pure helpers here; the effect lives in components/DeferredInviteCapture.tsx.
 */
export const DEFERRED_INVITE_CHECKED_KEY = 'bt_deferred_invite_checked_v1';

const INVITE_URL_RE = /^https:\/\/(?:www\.)?brandthread\.app\/invite\/([A-Za-z0-9]{4,12})\/?(?:[?#].*)?$/;

export function deferredInviteEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.EXPO_PUBLIC_DEFERRED_INVITE ?? '').trim() !== '0';
}

/** The invite code inside a copied invite link, or null for anything else. */
export function inviteCodeFromHandoff(text: string | null | undefined): string | null {
  if (!text || typeof text !== 'string' || text.length > 200) return null;
  const m = INVITE_URL_RE.exec(text.trim());
  return m ? m[1].toUpperCase() : null;
}

export function shouldCheckDeferredInvite(input: {
  platform: string;
  isLoaded: boolean;
  isSignedIn: boolean;
  alreadyChecked: boolean;
  enabled: boolean;
}): boolean {
  return input.enabled
    && (input.platform === 'ios' || input.platform === 'android')
    && input.isLoaded
    && !input.isSignedIn
    && !input.alreadyChecked;
}

/** Store pages for the "Download" buttons; unset until the apps are listed. */
export function appStoreLinks(env: Record<string, string | undefined> = process.env): { ios: string | null; android: string | null } {
  const pick = (v: string | undefined) => {
    const s = (v ?? '').trim();
    return /^https:\/\/\S+$/i.test(s) ? s : null;
  };
  return { ios: pick(env.EXPO_PUBLIC_APP_STORE_URL), android: pick(env.EXPO_PUBLIC_PLAY_STORE_URL) };
}

/** Which store button a mobile browser should get (desktop gets both). */
export function storeForUserAgent(ua: string): 'ios' | 'android' | null {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return null;
}
