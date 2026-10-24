/**
 * Account & security screens: structure checks for the audit fixes
 * (docs/audit/buyer-settings.md) — verified identifiers stay read-only,
 * change-email/phone echo what was really sent to Clerk, and failures are
 * surfaced instead of swallowed.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('personal details: phone is the Clerk number, changed only through /change-phone', () => {
  const src = read('app/buyer-personal-details.tsx');
  it('renders phone read-only from Clerk and links the row to the verified flow', () => {
    expect(src).toMatch(/key: 'phone',[^\n]*editable: false/);
    expect(src).toContain('user?.primaryPhoneNumber?.phoneNumber');
    expect(src).toContain("router.push('/change-phone' as never)");
  });
  it('never keeps a device-only phone copy', () => {
    expect(src).toContain("phone: ''");
  });
});

describe('change email / phone', () => {
  const src = read('components/security/ChangeIdentifier.tsx');
  it('echoes the normalized value sent to Clerk, not the raw input', () => {
    expect(src).toContain('setSentTo(entered)');
    expect(src).not.toContain('value.trim()}.');
    expect(src).toContain('we sent to {sentTo}');
  });
  it('surfaces a failed removal of the old identifier', () => {
    expect(src).not.toMatch(/catch \{ \/\* the new one is already primary \*\/ \}/);
    expect(src).toContain('showAlert(');
    expect(src).toContain('is still on your account');
  });
  it('titles the screen "Add …" when the account has none yet', () => {
    expect(read('app/change-phone.tsx')).toContain("'Add phone number'");
    expect(read('app/change-email.tsx')).toContain("'Add email'");
  });
});

describe('password and security (buyer)', () => {
  const src = read('app/buyer-security.tsx');
  it('shows two-factor on/off from Clerk', () => {
    expect(src).toContain('user?.twoFactorEnabled');
    expect(src).toContain("value={twoFactorOn ? 'On' : 'Off'}");
  });
  it('login activity links buyers to Password and security, sellers to Login methods', () => {
    const activity = read('components/security/LoginActivity.tsx');
    expect(activity).toContain("role === 'seller' ? '/login-methods' : '/buyer-security'");
  });
});

describe('load failures show a retry instead of a fake default', () => {
  it('store language does not silently fall back to English', () => {
    const src = read('app/languages.tsx');
    expect(src).not.toMatch(/catch \{\s*setStoreLanguage\('en'\)/);
    expect(src).toContain('<ErrorState message={loadError}');
  });
  it('profiles screen shows an error state and a role-aware back fallback', () => {
    const src = read('app/account-type-settings.tsx');
    expect(src).toContain('<ErrorState');
    expect(src).toContain("currentRole === 'seller' ? '/seller-settings' : '/buyer-settings-menu'");
  });
});

describe('notification channels: per-key optimistic updates', () => {
  it('uses functional state updates so a second toggle is not rolled back', () => {
    const src = read('app/notification-channels.tsx');
    expect(src).not.toContain('const prior = channels;');
    expect(src).toContain('setChannelKey(channel, key, prior)');
  });
});

describe('app lock: a failed save never leaves the spinner on', () => {
  it('resets busy in finally', () => {
    const src = read('app/biometric-unlock.tsx');
    expect(src).toMatch(/finally \{\s*setBusy\(false\);/);
  });
});
