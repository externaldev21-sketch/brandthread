/**
 * "Add to Apple Wallet" for a pre-order (iOS only). Hidden unless the
 * server has its Apple Wallet keys (GET /api/wallet/status), so it never
 * shows as a dead button. Tapping asks for a 10-minute signed link and opens
 * it in Safari, which downloads the pass and shows Apple's Add to Wallet
 * sheet.
 *
 * Styled after Apple's black "Add to Apple Wallet" badge. Before App Store
 * review, swap in the official badge artwork from developer.apple.com/wallet
 * (needs Dev's Apple Developer sign-in).
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { PressableScale } from '@/components/BrandthreadUI';
import { useApi } from '@/hooks/useApi';
import { API_BASE_URL } from '@/lib/api';
import { hapticError, hapticLight } from '@/lib/haptics';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
const WALLET_FOREGROUND = '#FFFFFF'; // theme-exempt: Apple Wallet brandmark foreground on its prescribed black badge


let cachedEnabled: boolean | null = null;

export function AddToWalletButton({ orderId }: { orderId: string }) {
  const api = useApi();
  const { theme } = useAppTheme();
  const [enabled, setEnabled] = useState<boolean>(cachedEnabled ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'ios' || cachedEnabled !== null) return;
    let alive = true;
    api.wallet.status()
      .then((r) => { cachedEnabled = !!r?.enabled; if (alive) setEnabled(cachedEnabled); })
      .catch(() => {});
    return () => { alive = false; };
  }, [api]);

  if (Platform.OS !== 'ios' || !enabled) return null;

  const onPress = async () => {
    if (busy) return;
    hapticLight();
    setBusy(true);
    setError(null);
    try {
      const { path } = await api.wallet.passLink(orderId);
      await Linking.openURL(`${API_BASE_URL}${path}`);
    } catch {
      hapticError();
      setError("Couldn't make the pass. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <PressableScale
        onPress={onPress}
        disabled={busy}
        style={[styles.badge, { borderColor: theme.border }]}
        accessibilityRole="button"
        accessibilityLabel="Add to Apple Wallet"
        testID="add-to-apple-wallet"
      >
        {busy ? (
          <ActivityIndicator color={WALLET_FOREGROUND} />
        ) : (
          <>
            <Feather name="credit-card" size={20} color={WALLET_FOREGROUND} />
            <Text style={styles.label}>Add to Apple Wallet</Text>
          </>
        )}
      </PressableScale>
      {error ? <Text style={[styles.error, { color: theme.error }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: SP.md },
  badge: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: '#000000', // theme-exempt: Apple Wallet badge is black on every theme
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.sm,
  },
  label: { fontFamily: FONT.semibold, fontSize: FS.md, color: '#FFFFFF' }, // theme-exempt: Apple Wallet badge text
  error: { fontFamily: FONT.medium, fontSize: FS.sm, marginTop: SP.sm, textAlign: 'center' },
});
