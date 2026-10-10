/**
 * The seller's store link with its three actions — copy, share, save QR —
 * for the Store link card (Share store, the Add Product publish sheet).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, Share } from 'react-native';
import * as Haptics from 'expo-haptics';

import { useApi } from '@/lib/api';
import { isSellerDevPreview } from '@/lib/devPreview';
import { PREVIEW_SELLER_IDENTITY } from '@/lib/previewIdentity';
import { saveImageToCameraRoll } from '@/lib/aiToolMedia';
import { storeQrDataUri } from '@/lib/storeQr';
import { sellerStoreLink } from '@/lib/storeShare';

export interface StoreLinkState {
  loading: boolean;
  url: string | null;
  brandName: string | null;
  username: string | null;
  copied: boolean;
  saved: boolean;
  copy: () => Promise<void>;
  share: () => Promise<void>;
  saveQr: () => Promise<void>;
}

async function writeClipboard(text: string): Promise<void> {
  if (Platform.OS === 'web') {
    await navigator?.clipboard?.writeText?.(text);
    return;
  }
  const Clipboard = await import('expo-clipboard');
  await Clipboard.setStringAsync(text);
}

export function useStoreLink(): StoreLinkState {
  const api = useApi();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<{ username: string | null; brandName: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    let cancelled = false;
    // The signed-out web preview can't call the API; it shows the one preview
    // identity every other seller screen uses (lib/previewIdentity).
    if (isSellerDevPreview()) {
      setProfile({ username: PREVIEW_SELLER_IDENTITY.username, brandName: PREVIEW_SELLER_IDENTITY.brandName });
      setLoading(false);
      return;
    }
    api.seller.getProfile()
      .then((p) => {
        if (!cancelled) setProfile({ username: p.username ?? null, brandName: p.brandName ?? p.displayName ?? null });
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api]);

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const url = sellerStoreLink(profile?.username);
  const flash = (set: (v: boolean) => void) => {
    set(true);
    timers.current.push(setTimeout(() => set(false), 2000));
  };

  const copy = useCallback(async () => {
    if (!url) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    try {
      await writeClipboard(url);
      flash(setCopied);
    } catch {
      Alert.alert("Couldn't copy the link", 'Try again.');
    }
  }, [url]);

  const share = useCallback(async () => {
    if (!url) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      const name = profile?.brandName ?? (profile?.username ? `@${profile.username}` : 'my store');
      await Share.share({ message: `Shop ${name} on Brandthread: ${url}`, url });
    } catch {
      // dismissed or unavailable
    }
  }, [profile, url]);

  const saveQr = useCallback(async () => {
    if (!url) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const result = await saveImageToCameraRoll(storeQrDataUri(url), 'brandthread-store-qr');
    if (result.ok) {
      flash(setSaved);
      return;
    }
    Alert.alert(
      result.reason === 'permission' ? 'Photos access is off' : "Couldn't save the QR code",
      result.reason === 'permission' ? 'Allow Photos access in Settings to save your QR code.' : 'Try again.',
    );
  }, [url]);

  return {
    loading, url, brandName: profile?.brandName ?? null, username: profile?.username ?? null,
    copied, saved, copy, share, saveQr,
  };
}
