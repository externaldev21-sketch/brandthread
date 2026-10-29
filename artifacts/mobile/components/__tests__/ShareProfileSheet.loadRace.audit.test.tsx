/**
 * Audit regression: opening Share profile before the caller's own profile
 * (and so its username) had loaded starts an auth.me() lookup. When the
 * username prop then arrives, load() shows the QR straight from it — but the
 * older lookup could still settle afterwards and replace that with its own
 * failure ("Couldn't load profile") even though the username was known.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { me, api } = vi.hoisted(() => {
  const me = vi.fn();
  // Stable, like the real useApi() — a fresh object per render would re-run load().
  return { me, api: { auth: { me } } };
});

vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: 'u1' }) }));
vi.mock('@/lib/api', () => ({ useApi: () => api }));
vi.mock('@/hooks/useHeaderTopInset', () => ({ useHeaderTopInset: () => 0 }));
vi.mock('react-native-qrcode-svg', () => ({ default: () => null }));
vi.mock('@/components/ShareProfileQrScanner', () => ({ ShareProfileQrScanner: () => null }));
vi.mock('@/components/share-cards/BuyerShareCard', () => ({ BuyerShareCard: () => null }));
vi.mock('@/components/share-cards/SellerShareCard', () => ({ SellerShareCard: () => null }));
vi.mock('@/lib/shareCard', () => ({
  captureCardAtNaturalSize: vi.fn(), saveCardImageToLibrary: vi.fn(), triggerWebImageDownload: vi.fn(),
  captureShareCard: vi.fn(), shareStoryCardImage: vi.fn(),
}));

const { ShareProfileSheet } = await import('../ShareProfileSheet');

function texts(r: ReactTestRenderer): string[] {
  return r.root.findAll((n) => (n.type as unknown) === 'Text').map((n) => [n.props.children].flat().join(''));
}

describe('ShareProfileSheet — late username', () => {
  it('keeps the QR from the username prop when the earlier lookup fails afterwards', async () => {
    let rejectMe!: (e: unknown) => void;
    me.mockReturnValue(new Promise((_, reject) => { rejectMe = reject; }));
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<ShareProfileSheet visible onClose={() => {}} profileUsername={null} />); });
    expect(me).toHaveBeenCalledTimes(1);
    // The caller's profile arrives with the username.
    await act(async () => { r.update(<ShareProfileSheet visible onClose={() => {}} profileUsername="maya" />); });
    expect(r.root.findAll((n) => n.props.testID === 'share-profile-qr-card').length).toBeGreaterThan(0);
    // The stale lookup now fails.
    await act(async () => { rejectMe(new Error('offline')); await Promise.resolve(); });
    expect(texts(r)).not.toContain("Couldn't load profile");
    expect(texts(r)).toContain('@maya');
    r.unmount();
  });
});
