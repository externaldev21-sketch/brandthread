/**
 * IP takedowns — the seller's listings removed after a copyright / trademark
 * report (GET /api/ip-cases/seller/mine), each with its counter-notice state
 * and a "File counter-notice" action while one can still be filed.
 * Reached from Settings → Legal.
 */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ListRow } from '@/components/ui/ListRow';
import { EmptyState } from '@/components/BrandthreadUI';
import { counterNoticeStatusLabel, type SellerIpCase } from '@/lib/counterNotice';
import { FONT, FS, SP } from '@/lib/theme';

export default function SellerIpCasesScreen() {
  const api = useApi();
  const router = useRouter();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [cases, setCases] = useState<SellerIpCase[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.ipCases.mine();
      setCases(res.cases ?? []);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [api]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: c.background }} testID="seller-ip-cases">
      <ScreenHeader title="IP takedowns" />
      {failed && !cases ? (
        <EmptyState icon="wifi-off" title="Couldn't load your cases" description="Check your connection and try again."
          action={{ label: 'Try again', onPress: () => { void load(); } }} />
      ) : !cases ? (
        <ActivityIndicator color={c.foreground} style={{ marginTop: 40 }} />
      ) : cases.length === 0 ? (
        <EmptyState icon="shield" title="No takedowns" description="None of your listings have been removed after an intellectual-property report." />
      ) : (
        <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 40 }}>
          <Text style={[styles.note, { color: c.mutedForeground }]}>
            If a listing was removed by mistake, you can file a counter-notice once per case. Our team reviews it, and under the DMCA it may be shared with the person who reported the listing, including your contact details.
          </Text>
          {cases.map((item) => (
            <ListRow
              key={item.caseReference}
              icon="shield"
              title={item.listingName ?? 'Removed listing'}
              subtitle={`${item.caseReference} · ${item.rightsType} · ${counterNoticeStatusLabel(item)}`}
              subtitleNumberOfLines={2}
              chevron={item.canFileCounterNotice}
              value={item.canFileCounterNotice ? 'Respond' : undefined}
              onPress={item.canFileCounterNotice ? () => router.push({
                pathname: '/seller-counter-notice',
                params: {
                  reference: item.caseReference,
                  listingName: item.listingName ?? '',
                  listingProductId: item.listingProductId ?? '',
                },
              } as never) : undefined}
              testID={`ip-case-${item.caseReference}`}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  note: { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 20, marginBottom: SP.md },
});
