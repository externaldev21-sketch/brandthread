import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const dashboard = readFileSync(resolve(process.cwd(), 'components/SellerHomeCommerceDashboard.tsx'), 'utf8');

/**
 * Dev: on the same row as the "Dashboard" title, show the seller's real
 * public store URL (using the one existing URL builder, not a new one) plus
 * a small copy icon. Tapping either copies to the clipboard instantly with
 * a light haptic; the icon swaps to a checkmark for ~1.2s — no toast, no
 * wording. Truncates the middle if long, never wraps. Shows even before the
 * store is published.
 */
describe('Dashboard: store URL + copy icon row next to the title', () => {
  it('uses the existing public-store-URL builder, not a new one', () => {
    expect(dashboard).toContain("import { buildCanonicalProfileUrl } from '@/lib/shareProfile';");
    expect(dashboard).toContain('setStoreUrl(buildCanonicalProfileUrl(profile.username));');
  });

  it('shows the URL unconditionally once fetched — no "published" gate', () => {
    const fetchBlock = dashboard.slice(dashboard.indexOf('api.seller.getProfile().then((profile) => {', dashboard.indexOf('const [storeUrl, setStoreUrl]')), dashboard.indexOf('}).catch(() => {});', dashboard.indexOf('const [storeUrl, setStoreUrl]')));
    expect(fetchBlock).not.toContain('published');
    expect(fetchBlock).not.toContain('storeIsLive');
  });

  it('copying fires a light haptic, writes to the clipboard, and flips a checkmark for ~1.2s — no toast', () => {
    const fnBody = dashboard.slice(dashboard.indexOf('const handleCopyStoreUrl = useCallback'), dashboard.indexOf('}, [storeUrl]);'));
    expect(fnBody).toContain('Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)');
    expect(fnBody).toContain('Clipboard.setStringAsync(storeUrl)');
    expect(fnBody).toContain('navigator?.clipboard?.writeText?.(storeUrl)');
    expect(fnBody).toContain('setStoreUrlCopied(true)');
    expect(fnBody).toContain('setTimeout(() => setStoreUrlCopied(false), 1200)');
    expect(fnBody).not.toContain('showToast');
    expect(fnBody).not.toContain('Alert.alert');
  });

  it('sits on the same row as the Dashboard title, baseline-aligned, and both tapping the URL text and the icon copy', () => {
    expect(dashboard).toContain('titleRow: { flex: 1, flexDirection: \'row\', alignItems: \'baseline\'');
    const rowBlock = dashboard.slice(dashboard.indexOf('style={styles.titleRow}'), dashboard.indexOf('<ActivityBellButton'));
    expect(rowBlock).toContain('Dashboard</Text>');
    expect(rowBlock).toContain('onPress={handleCopyStoreUrl}');
    expect(rowBlock).toContain('testID="seller-dashboard-store-url"');
    expect(rowBlock).toContain("name={storeUrlCopied ? 'check' : 'copy'}");
  });

  it('truncates the middle and never wraps — numberOfLines=1 + ellipsizeMode="middle", flexShrink on the text', () => {
    expect(dashboard).toContain('numberOfLines={1} ellipsizeMode="middle"');
    expect(dashboard).toContain('storeUrlText: { flexShrink: 1');
  });
});
