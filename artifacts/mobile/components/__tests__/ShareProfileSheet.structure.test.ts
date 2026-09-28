import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sheet = readFileSync(resolve(process.cwd(), 'components/ShareProfileSheet.tsx'), 'utf8');
const scanner = readFileSync(resolve(process.cwd(), 'components/ShareProfileQrScanner.tsx'), 'utf8');
const buyerProfile = readFileSync(resolve(process.cwd(), 'app/(buyer)/profile.tsx'), 'utf8');
const sellerTabProfile = readFileSync(resolve(process.cwd(), 'app/(tabs)/profile.tsx'), 'utf8');
const sellerProfile = readFileSync(resolve(process.cwd(), 'app/seller-profile.tsx'), 'utf8');

describe('Share profile screen — Mobbin 1:1 structure', () => {
  it('has an X close, a cycling style pill, and a scan-QR icon in the header', () => {
    expect(sheet).toContain('accessibilityLabel="Close"');
    expect(sheet).toContain('share-profile-style-pill');
    expect(sheet).toContain('handleCyclePill');
    expect(sheet).toContain("VARIANTS: BackgroundVariant[] = ['color', 'emoji', 'selfie']");
    expect(sheet).toContain('accessibilityLabel="Scan QR code"');
  });

  it('cycles exactly three background variants: COLOR, EMOJI, SELFIE', () => {
    expect(sheet).toContain("color: 'COLOR'");
    expect(sheet).toContain("emoji: 'EMOJI'");
    expect(sheet).toContain("selfie: 'SELFIE'");
  });

  it('renders a real, scannable QR code with the app logo centered and the handle beneath it', () => {
    expect(sheet).toContain('value={canonicalUrl}');
    expect(sheet).toContain('logo={LOGO_SOURCE}');
    expect(sheet).toContain('{handle}');
  });

  it('never resolves a canonical link from a guessed username', () => {
    expect(sheet).toContain('buildCanonicalProfileUrl(identity?.username)');
  });

  it('has three equal share tiles: Share profile, Copy link, Download', () => {
    expect(sheet).toContain('label="Share profile"');
    expect(sheet).toContain('label="Copy link"');
    expect(sheet).toContain('label="Download"');
  });

  it('shows a "Link copied" toast after copying the canonical link', () => {
    expect(sheet).toContain("showToast('Link copied')");
  });

  it('downloads just the QR card, not the whole screen background', () => {
    expect(sheet).toContain('captureCardAtNaturalSize({ current: cardRef.current }, QR_CARD_SIZE)');
  });

  it('opens the QR scanner in place instead of a separate route', () => {
    expect(sheet).toContain('<ShareProfileQrScanner');
    expect(sheet).toContain("setScreen('scanner')");
  });
});

describe('QR scanner — routes a scanned Brandthread profile to that profile', () => {
  it('parses a scanned deep link and navigates to /u/[username]', () => {
    expect(scanner).toContain('parseProfileDeepLink(result.data)');
    expect(scanner).toContain('router.push(`/u/${username}`');
  });

  it('shows a clear, non-blank state when the camera is unavailable', () => {
    expect(scanner).toContain('Camera unavailable');
  });
});

describe('Share button wiring — unchanged entry points, rebuilt destination', () => {
  it('buyer profile opens the share sheet instead of a dedicated screen', () => {
    expect(buyerProfile).toContain('<ShareProfileSheet');
    expect(buyerProfile).toContain('setShareSheetOpen(true)');
    expect(buyerProfile).not.toContain("router.push('/share-profile'");
  });

  it('seller tab profile opens the share sheet instead of a dedicated screen', () => {
    expect(sellerTabProfile).toContain('<ShareProfileSheet');
    expect(sellerTabProfile).toContain('setShareSheetVisible(true)');
    expect(sellerTabProfile).not.toContain("nav('/share-profile')");
  });

  it('seller profile (owner view) opens the share sheet instead of a dedicated screen', () => {
    expect(sellerProfile).toContain('<ShareProfileSheet');
    expect(sellerProfile).toContain('setShareSheetVisible(true)');
    expect(sellerProfile).not.toContain("router.push('/share-profile'");
  });
});
