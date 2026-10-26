/**
 * Client half of the Settings functional sweep (the server half is
 * api-server src/routes/__tests__/settings-sweep.integration.test.ts): each
 * screen sends what the server accepts and reads back what it saved.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8');

describe('Notifications category page', () => {
  const src = read('app/notification-settings-page.tsx');

  it('saves Saved items alerts and Login alerts as categories (pushTypes rejects them)', () => {
    expect(src).toContain("const CATEGORY_KEYS = ['login_alerts', 'saved_alerts'] as const;");
    expect(src).toContain('await api.notificationPrefs.update({ categories: { [key]: value !== \'off\' } });');
  });

  it('turns the sign-in email off with Login alerts too', () => {
    expect(src).toContain("if (key === 'login_alerts') await api.meSettings.update({ loginAlerts: value !== 'off' });");
  });

  it('keeps the category rows when a per-type save returns', () => {
    expect(src).toMatch(/setValues\(\(v\) => \(\{ \.\.\.\(saved\.pushTypes as Record<string, PushTypeValue>\), \.\.\.Object\.fromEntries\(CATEGORY_KEYS/);
  });
});

describe('Report a problem', () => {
  const src = read('app/buyer-problem-report.tsx');
  const service = read('services/cartService.ts');

  it('files one ticket (no second submitTicket call)', () => {
    expect(src).not.toContain('api.support.submitTicket');
  });

  it('uploads the photos and sends the uploaded paths plus device details', () => {
    expect(src).toContain('(await api.returns.uploadEvidence(photo)).objectPath');
    expect(src).toContain('diagnostics: collectAppDiagnostics(),');
    expect(service).toContain('const isRemote = (u: string) => /^(?:https:\\/\\/|\\/objects\\/)/i.test(u);');
    expect(service).toContain('...(diagnostics ? { diagnostics } : {}),');
  });
});

describe('My sizes', () => {
  it('saves the cm/in and kg/lb choice with the account and reads it back', () => {
    const src = read('app/buyer-my-sizes.tsx');
    expect(src).toContain('update({ sizes: { units: { [kind]: next } } })');
    expect(src).toContain("length: unitsOverride.length ?? sizes.units?.length ?? 'cm',");
  });
});

describe('Currency', () => {
  const src = read('app/currency.tsx');
  it('waits for the account save and says so when it fails', () => {
    expect(src).toContain('await api.fx.setDisplayCurrency(code);');
    expect(src).not.toContain('api.fx.setDisplayCurrency(code).catch(() => {})');
  });
  it('reads the account currency back', () => {
    expect(src).toContain('api.fx.getDisplayCurrency().then((r) => applyAccountCurrency(r?.displayCurrency))');
    expect(read('lib/displayCurrency.ts')).toContain('api.fx.getDisplayCurrency().then((r) => applyAccountCurrency(r?.displayCurrency))');
  });
});

describe('Shopping preferences → Preferred fit', () => {
  it('feeds the size suggestion', () => {
    expect(read('components/SizeRecommendationBadge.tsx')).toContain('preferredFit: preferredFit || null');
  });
});

describe('Edit profile (seller)', () => {
  const src = read('app/edit-profile.tsx');
  it('sends a full URL for a bare website domain', () => {
    expect(src).toContain('website:     withScheme(fields.website.trim()),');
  });
  it('saves Instagram / TikTok through the merging endpoint, not by replacing every link', () => {
    expect(src).toContain('await api.seller.saveSocialLinks({ instagram: fields.instagram.trim(), tiktok: fields.tiktok.trim() });');
    expect(src).not.toMatch(/socialLinks: \{\s*instagram:/);
  });
});

describe('Vacation mode and cancel window', () => {
  it('vacation save calls the real client (no optional chain that could skip it)', () => {
    expect(read('app/vacation-mode.tsx')).toContain('await api.seller.vacation.update({');
  });
  it('a failed cancel-window load is not shown as "Until shipped"', () => {
    expect(read('components/seller/CancelWindowSetting.tsx')).not.toContain('.catch(() => { if (alive) setHours(null); });');
  });
});

describe('Buyer settings sync', () => {
  it('never syncs disableHaptics (not a server setting)', () => {
    expect(read('lib/buyerSettings.ts')).toMatch(/LOCAL_ONLY_BUYER_SETTING_KEYS[\s\S]*'disableHaptics',[\s\S]*\];/);
  });
});
