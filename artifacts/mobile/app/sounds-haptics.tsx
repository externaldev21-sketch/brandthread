/**
 * Settings › Sounds & haptics — the on/off switch every haptic in the app
 * respects (lib/haptics.ts), plus the seller's New order sound (the order
 * chime on new-order pushes; see lib/newOrderAlert.ts). Modeled on iOS
 * Settings › Sounds & Haptics: one grouped card, a switch per row, same
 * header as the rest of Settings.
 */
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { ScreenHeader } from '@/components/ScreenHeader';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { ListRow } from '@/components/ui';
import { Card } from '@/components/ui/Card';
import { SPACING } from '@/constants/spacing';
import { useApi } from '@/hooks/useApi';
import { useColors } from '@/hooks/useColors';
import { isBuyerDevPreview, isSellerDevPreview } from '@/lib/devPreview';
import { useHapticsEnabled } from '@/lib/hapticsPreference';
import { NEW_ORDER_SOUND_PREF } from '@/lib/newOrderAlert';

export default function SoundsHapticsScreen() {
  const router = useRouter();
  const api = useApi();
  const colors = useColors();
  const { isSignedIn } = useAuth();
  const [hapticsOn, setHapticsOn] = useHapticsEnabled();
  const sellerPreview = isSellerDevPreview();
  const preview = sellerPreview || isBuyerDevPreview();
  const [isSeller, setIsSeller] = useState(sellerPreview);
  const [orderSound, setOrderSound] = useState(true);

  // The order sound lives with the seller's notification preferences so
  // background pushes respect it. Signed-out previews never call the API.
  useEffect(() => {
    if (preview || !isSignedIn) return;
    let active = true;
    api.notificationPrefs.get()
      .then((data) => {
        if (!active) return;
        setIsSeller(data.role === 'seller');
        setOrderSound(data.categories[NEW_ORDER_SOUND_PREF] ?? true);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [api, isSignedIn, preview]);

  async function toggleOrderSound(next: boolean) {
    setOrderSound(next);
    if (preview) return;
    try {
      const result = await api.notificationPrefs.update({ categories: { [NEW_ORDER_SOUND_PREF]: next } });
      setOrderSound(result.categories[NEW_ORDER_SOUND_PREF] ?? next);
    } catch {
      setOrderSound(!next);
    }
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Sounds & haptics" divider={false} onBack={() => goBackOr(router, '/(tabs)/more')} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Card style={isSeller ? styles.listCard : undefined}>
            <ListRow
              icon="smartphone"
              title="Haptics"
              toggle={{ value: hapticsOn, onChange: setHapticsOn }}
              testID="haptics-toggle"
            />
            {isSeller ? (
              <>
                <View style={[styles.rowDivider, { backgroundColor: colors.border }]} />
                <ListRow
                  icon="shopping-bag"
                  title="New order sound"
                  toggle={{ value: orderSound, onChange: toggleOrderSound }}
                  testID="new-order-sound-toggle"
                />
              </>
            ) : null}
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  section: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.md + 2 },
  listCard: { padding: SPACING.sm },
  rowDivider: { height: StyleSheet.hairlineWidth },
});
