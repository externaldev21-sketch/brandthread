/**
 * Preview — the listing as buyers will see it, laid out like Vinted's item
 * page (full-width photos, title, "size · condition · brand" line, price,
 * description, then the item-details table), reached the way Vestiaire's
 * "Review before submitting" is. "Post listing" (Depop's label) publishes
 * to the API; edits say "Save changes".
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@clerk/expo';
import { useProductLimitSheet } from '@/components/products/ProductLimitSheet';
import { isFirstStoreLive, storeLiveSeenKey, type OwnProductRow } from '@/lib/storeLive';
import { ActivityIndicator, Alert, Image, NativeScrollEvent, NativeSyntheticEvent, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ListingBottomBar, SectionGap } from '@/components/listing/ListingRows';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useFeeSchedule } from '@/hooks/useFeeSchedule';
import { useApi } from '@/lib/api';
import { quoteFromSchedule } from '@/lib/feeSchedule';
import { hapticSuccessAction } from '@/lib/haptics';
import { formatCents, parseDecimalToCents } from '@/lib/money';
import { FONT, FS, SP } from '@/lib/theme';
import { useHideTabBar } from '@/lib/tabBarVisibility';
import { deleteDraft } from '@/services/productService';
import { resetListing, totalQuantity, useListing } from '@/lib/listing/listingStore';
import { publishListing } from '@/lib/listing/publishListing';
import { categoryPath, conditionLabel, parcelLabel } from '@/lib/listing/taxonomy';

export default function ListingPreviewScreen() {
  useHideTabBar();
  const { theme } = useAppTheme();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const api = useApi();
  const { userId } = useAuth();
  const productLimit = useProductLimitSheet();
  const form = useListing();
  const schedule = useFeeSchedule();
  const { width } = useWindowDimensions();
  const [page, setPage] = React.useState(0);
  const [posting, setPosting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const cents = parseDecimalToCents(form.priceStr) ?? 0;
  const earn = schedule && cents > 0 ? quoteFromSchedule(schedule, cents).sellerNetCents : null;
  const photoW = Math.min(width, 600);
  const sizeText = form.sizes.map(sz => sz.size).join(', ');
  const meta = [sizeText, conditionLabel(form.condition), form.brand].filter(Boolean).join(' · ');
  const isEdit = !!form.editProductId;

  const details: [string, string | undefined][] = [
    ['Category', categoryPath(form.department, form.category, form.subcategory)],
    ['Brand', form.brand],
    ['Size', sizeText],
    ['Condition', conditionLabel(form.condition)],
    ['Colours', form.colors.join(', ')],
    ['Material', form.material],
    ['Quantity', String(totalQuantity(form))],
    ['Parcel size', parcelLabel(form.parcelSize)],
  ];

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    setPage(Math.round(e.nativeEvent.contentOffset.x / photoW));
  }

  async function openStoreLiveIfFirst(productId: string): Promise<boolean> {
    if (!userId) return false;
    try {
      const key = storeLiveSeenKey(userId);
      if ((await AsyncStorage.getItem(key)) === '1') return false;
      const rows = (await api.products.list()) as OwnProductRow[];
      if (!isFirstStoreLive(rows ?? [], productId, false)) return false;
      await AsyncStorage.setItem(key, '1');
      router.replace({ pathname: '/store-live', params: { productId } } as never);
      return true;
    } catch {
      return false;
    }
  }

  async function post() {
    if (posting) return;
    setError(null);
    setPosting(true);
    try {
      const result = await publishListing(api, form, cents);
      await deleteDraft(form.draftId);
      hapticSuccessAction();
      const cover = form.photos[0]?.uri ?? '';
      const title = form.title.trim();
      resetListing();
      const q = new URLSearchParams({
        id: result.productId,
        kind: result.kind,
        title,
        price: String(cents),
        ...(earn !== null ? { earn: String(earn) } : {}),
        ...(cover ? { cover } : {}),
        ...(result.videoFailed ? { videoFailed: '1' } : {}),
      });
      if (result.kind === 'created' && await openStoreLiveIfFirst(result.productId)) return;
      router.replace(`/listing/success?${q.toString()}` as never);
    } catch (err) {
      if (productLimit.showFor(err)) return;
      const code = (err as { code?: string; status?: number })?.code;
      const message = code === 'PLAN_LIMIT_REACHED'
        ? 'You’ve reached your plan’s product limit. Upgrade to list more.'
        : 'Couldn’t post your listing. Check your connection and try again.';
      setError(message);
      if (Platform.OS !== 'web') Alert.alert('Not posted', message);
    } finally {
      setPosting(false);
    }
  }

  return (
    <View style={s.screen} testID="listing-preview-screen">
      <ScreenHeader title="Preview" />
      {productLimit.sheet}
      <ScrollView contentContainerStyle={s.content}>
        <View>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onScroll}
            onScroll={Platform.OS === 'web' ? onScroll : undefined}
            scrollEventThrottle={64}
          >
            {form.photos.map((p, i) => (
              <Image key={p.id} source={{ uri: p.uri }} style={{ width: photoW, height: photoW * 1.2 }} accessibilityLabel={`Photo ${i + 1} of ${form.photos.length}`} />
            ))}
          </ScrollView>
          {form.photos.length > 1 ? (
            <View style={s.dots} pointerEvents="none">
              {form.photos.map((p, i) => (
                <View key={p.id} style={[s.dot, { backgroundColor: i === page ? theme.text : `${theme.text}66` }]} />
              ))}
            </View>
          ) : null}
        </View>

        <View style={s.info}>
          <Text style={s.title}>{form.title.trim()}</Text>
          {meta ? <Text style={s.meta}>{meta}</Text> : null}
          <Text style={s.price}>{formatCents(cents)}</Text>
          <Text style={s.shipping}>{form.shippingPayer === 'seller' ? 'Free shipping' : '+ shipping'}</Text>
        </View>

        {form.description.trim() ? (
          <>
            <SectionGap />
            <View style={s.block}>
              <Text style={s.blockLabel}>Description</Text>
              <Text style={s.body}>{form.description.trim()}</Text>
            </View>
          </>
        ) : null}

        <SectionGap />
        <View style={s.block}>
          {details.filter(([, v]) => !!v).map(([label, value]) => (
            <View key={label} style={s.detailRow}>
              <Text style={s.detailLabel}>{label}</Text>
              <Text style={s.detailValue} numberOfLines={2}>{value}</Text>
            </View>
          ))}
        </View>

        {earn !== null ? (
          <>
            <SectionGap />
            <View style={[s.block, s.detailRow]}>
              <Text style={s.earnLabel}>You earn</Text>
              <Text style={s.earnValue} testID="listing-preview-earn">{formatCents(earn)}</Text>
            </View>
          </>
        ) : null}

        {error ? <Text style={s.error} accessibilityRole="alert" testID="listing-preview-error">{error}</Text> : null}
      </ScrollView>
      <ListingBottomBar
        secondaryLabel="Edit"
        onSecondary={() => router.back()}
        primaryLabel={isEdit ? 'Save changes' : 'Post listing'}
        onPrimary={() => { void post(); }}
        primaryLoading={posting}
        primaryTestID="listing-post"
      />
      {posting ? <View style={s.blocker}><ActivityIndicator color={theme.text} /></View> : null}
    </View>
  );
}

function makeStyles(t: AppThemePreset) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.background },
    content: { paddingBottom: SP.xl },
    dots: { position: 'absolute', bottom: 12, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
    dot: { width: 6, height: 6, borderRadius: 3 },
    info: { paddingHorizontal: SP.md, paddingTop: SP.md, paddingBottom: SP.md, gap: 4 },
    title: { fontSize: FS.md, fontFamily: FONT.semibold, color: t.text },
    meta: { fontSize: FS.sm, fontFamily: FONT.regular, color: t.muted },
    price: { fontSize: FS.lg, fontFamily: FONT.bold, color: t.text, marginTop: SP.sm },
    shipping: { fontSize: FS.sm, fontFamily: FONT.regular, color: t.muted },
    block: { paddingHorizontal: SP.md, paddingVertical: SP.md },
    blockLabel: { fontSize: FS.sm, fontFamily: FONT.regular, color: t.muted, marginBottom: SP.sm },
    body: { fontSize: FS.base, lineHeight: 22, fontFamily: FONT.regular, color: t.text },
    detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: SP.md, paddingVertical: 6 },
    detailLabel: { fontSize: FS.base, fontFamily: FONT.regular, color: t.muted },
    detailValue: { flexShrink: 1, textAlign: 'right', fontSize: FS.base, fontFamily: FONT.regular, color: t.text },
    earnLabel: { fontSize: FS.base, fontFamily: FONT.semibold, color: t.text },
    earnValue: { fontSize: FS.base, fontFamily: FONT.semibold, color: t.text },
    error: { fontSize: FS.sm, fontFamily: FONT.regular, color: t.error, paddingHorizontal: SP.md, paddingTop: SP.md },
    blocker: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: `${t.background}66` },
  });
}
