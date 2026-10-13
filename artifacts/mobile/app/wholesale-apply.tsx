/**
 * Buyer: a store's wholesale pricing. Apply with a business name, see the
 * request status, and once approved see the wholesale price and minimum
 * quantity of each product plus the order minimum. Wholesale prices are
 * applied by the server at checkout (lib/pricing/wholesale.ts).
 * Pushed from the store's ••• menu ("Wholesale pricing").
 *
 * Reference: Shopify B2B (catalog prices shown to an approved company
 * buyer), with the apply step reduced to the one field a seller needs.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LoadingSkeleton } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui';
import { RetryRow } from '@/components/ui/RetryRow';
import { CheckoutField, CheckoutSection, GUTTER, useCheckoutColors, type CheckoutColors } from '@/components/checkout/CheckoutPrimitives';
import { useApi } from '@/lib/api';
import { ApiError } from '@/lib/networkNotice';
import { formatCents } from '@/lib/money';
import { COMP, FONT, FS, SP } from '@/lib/theme';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { hapticMedium, hapticSuccess } from '@/lib/haptics';
import { isBuyerDevPreview, isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { PREVIEW_WHOLESALE_ME } from '@/lib/wholesalePreview';
import type { WholesaleMyStatus } from '@/lib/wholesale';

const NOT_APPLIED: WholesaleMyStatus = { enabled: true, status: 'none', businessName: null, minOrderCents: 0, priceList: [] };

export default function WholesaleApplyScreen() {
  const router = useRouter();
  const api = useApi();
  const insets = useSafeAreaInsets();
  const { isSignedIn } = useAuth();
  const ck = useCheckoutColors();
  const s = useMemo(() => makeStyles(ck), [ck]);
  const params = useLocalSearchParams<{ sellerId?: string; name?: string }>();
  const sellerId = typeof params.sellerId === 'string' ? params.sellerId : '';
  const storeName = typeof params.name === 'string' && params.name ? params.name : 'This store';
  const preview = isBuyerDevPreview() || isSellerDevPreview();
  const [me, setMe] = useState<WholesaleMyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    if (preview) {
      // Signed-out preview never calls the API. Sample data only with &demo=1.
      setMe(isPreviewDemoMode() ? PREVIEW_WHOLESALE_ME : NOT_APPLIED);
      setLoading(false);
      return;
    }
    if (!sellerId || !isSignedIn) { setMe(null); setLoading(false); return; }
    try {
      setMe(await api.wholesale.me(sellerId));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [api, isSignedIn, preview, sellerId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function apply() {
    const name = businessName.trim();
    if (name.length < 2) { setError('Enter your business name'); return; }
    hapticMedium();
    if (preview) { setMe(m => (m ? { ...m, status: 'pending', businessName: name } : m)); return; }
    setApplying(true);
    setError(null);
    try {
      await api.wholesale.apply(sellerId, name);
      hapticSuccess();
      await load();
    } catch (err) {
      setError(err instanceof ApiError && err.status < 500 ? err.message : 'Couldn’t send your request. Try again.');
    } finally {
      setApplying(false);
    }
  }

  const header = <ScreenHeader title="Wholesale pricing" onBack={() => goBackOr(router)} />;

  if (loading) {
    return <View style={s.root}>{header}<View style={{ padding: GUTTER, gap: SP.sm }}><LoadingSkeleton height={72} /><LoadingSkeleton height={120} /></View></View>;
  }
  if (!preview && !isSignedIn) {
    return <View style={s.root}>{header}<View style={{ padding: GUTTER }}><Text style={s.body}>Sign in to apply for wholesale pricing.</Text></View></View>;
  }
  if (failed || !me) {
    return <View style={s.root}>{header}<View style={{ padding: GUTTER }}><RetryRow label="Couldn’t load wholesale pricing" onRetry={() => void load()} /></View></View>;
  }
  if (!me.enabled) {
    return <View style={s.root}>{header}<View style={{ padding: GUTTER }}><Text style={s.body}>{storeName} doesn’t offer wholesale pricing right now.</Text></View></View>;
  }

  if (me.status === 'approved') {
    return (
      <View style={s.root}>
        {header}
        <FlatList
          data={me.priceList}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: Math.max(insets.bottom, SP.md) + COMP.tabBarH + SP.md }}
          ListHeaderComponent={(
            <View style={{ paddingTop: SP.md, paddingBottom: SP.sm }}>
              <Text style={s.title}>You’re approved</Text>
              <Text style={s.fine}>
                {me.minOrderCents > 0
                  ? `Wholesale prices apply at checkout on orders of ${formatCents(me.minOrderCents)} or more.`
                  : 'Wholesale prices apply at checkout.'}
              </Text>
            </View>
          )}
          ListEmptyComponent={<Text style={s.fine}>{storeName} hasn’t set wholesale prices yet.</Text>}
          renderItem={({ item }) => {
            const v = item.variants.find(x => x.wholesaleCents != null) ?? item.variants[0];
            return (
              <View style={s.row}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.title} numberOfLines={1}>{item.name}</Text>
                  <Text style={s.fine} numberOfLines={1}>
                    {v.minQuantity > 1 ? `Min. ${v.minQuantity} · ` : ''}Retail {formatCents(v.priceCents)}
                  </Text>
                </View>
                <Text style={s.price}>{v.wholesaleCents != null ? formatCents(v.wholesaleCents) : formatCents(v.priceCents)}</Text>
              </View>
            );
          }}
        />
      </View>
    );
  }

  return (
    <View style={s.root}>
      {header}
      <View style={{ paddingHorizontal: GUTTER, paddingTop: SP.md }}>
        {me.status === 'pending' ? (
          <>
            <Text style={s.title}>Request sent</Text>
            <Text style={s.fine}>{storeName} reviews requests from {me.businessName ?? 'your business'}. Wholesale prices show here once you’re approved.</Text>
          </>
        ) : (
          <CheckoutSection first>
            <Text style={s.title}>Buy wholesale from {storeName}</Text>
            <Text style={[s.fine, { marginBottom: SP.md }]}>
              {me.status === 'declined' ? 'Your last request wasn’t approved. You can apply again.' : 'Approved businesses pay wholesale prices at checkout.'}
            </Text>
            <CheckoutField label="Business name" value={businessName} onChangeText={setBusinessName} placeholder="Enter business name" autoCapitalize="words" returnKeyType="send" onSubmitEditing={() => void apply()} />
            {error ? <Text style={s.error}>{error}</Text> : null}
            <Button label="Apply" onPress={() => void apply()} loading={applying} fullWidth />
          </CheckoutSection>
        )}
      </View>
    </View>
  );
}

function makeStyles(ck: CheckoutColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: ck.bg },
    row: { flexDirection: 'row', alignItems: 'center', gap: SP.md, minHeight: 60, paddingVertical: SP.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: ck.divider },
    title: { fontFamily: FONT.semibold, fontSize: FS.base, color: ck.text },
    body: { fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 21, color: ck.text },
    fine: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, color: ck.muted, marginTop: 2 },
    price: { fontFamily: FONT.semibold, fontSize: FS.base, color: ck.text },
    error: { fontFamily: FONT.medium, fontSize: FS.sm, color: ck.text, marginBottom: SP.sm },
  });
}
