import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sheet = readFileSync(resolve(process.cwd(), 'components/ShareProfileSheet.tsx'), 'utf8');
const buyerProfile = readFileSync(resolve(process.cwd(), 'app/(buyer)/profile.tsx'), 'utf8');
const sellerTabProfile = readFileSync(resolve(process.cwd(), 'app/(tabs)/profile.tsx'), 'utf8');
const sellerProfile = readFileSync(resolve(process.cwd(), 'app/seller-profile.tsx'), 'utf8');

describe('Profile share sheet', () => {
  it('renders a swipeable carousel of card variants with actions', () => {
    expect(sheet).toContain("VARIANTS: ShareCardVariant[] = ['portrait', 'grid']");
    expect(sheet).toContain('pagingEnabled');
    expect(sheet).toContain('label="Instagram"');
    expect(sheet).toContain('label="Save image"');
    expect(sheet).toContain('label="Copy link"');
    expect(sheet).toContain('label="More"');
  });

  it('captures the currently visible card, not always the first one', () => {
    expect(sheet).toContain('cardRefs.current[pageIndex]');
    expect(sheet).toContain('onMomentumScrollEnd={onScrollEnd}');
  });

  it('shows a Copied! toast after copying the canonical link', () => {
    expect(sheet).toContain("showToast('Copied!')");
    expect(sheet).toContain('Clipboard.setStringAsync(canonicalUrl)');
  });

  it('falls back to the system share sheet when Instagram Stories is unavailable', () => {
    expect(sheet).toContain('shareCardToInstagramStories');
    expect(sheet).toContain("result === 'system'");
  });

  it('never resolves a canonical link from a guessed username', () => {
    expect(sheet).toContain('buildCanonicalProfileUrl(identity?.username)');
  });
});

describe('Share button wiring', () => {
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
