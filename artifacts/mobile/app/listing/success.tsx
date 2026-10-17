/**
 * "Listed!" — Vestiaire's "Item submitted" screen: close X top-right, check,
 * headline and one line, the item row (cover, title, price and what you
 * earn) between hairlines, then stacked full-width buttons at the bottom.
 * Ref: mobbin.com/flows/af2aced0-b3e0-4894-ad95-079d050b1de2 (last frame).
 */
import React from 'react';
import { Image, Share, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { SuccessCheck } from '@/components/ui/SuccessCheck';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { buildProductUrl } from '@/lib/shareLinks';
import { FONT, FS, SP } from '@/lib/theme';
import { useHideTabBar } from '@/lib/tabBarVisibility';

export default function ListingSuccessScreen() {
  useHideTabBar();
  const { theme } = useAppTheme();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const p = useLocalSearchParams<{ id?: string; kind?: string; title?: string; price?: string; earn?: string; cover?: string; videoFailed?: string }>();
  const updated = p.kind === 'updated';
  const price = Number(p.price) || 0;
  const earn = p.earn ? Number(p.earn) : null;
  const url = buildProductUrl(p.id);

  // Pops this screen and the form under it.
  const close = () => router.dismiss(2);

  async function share() {
    if (!url) return;
    try {
      await Share.share({ message: `${p.title ?? 'My listing'} on Brandthread ${url}`, url });
    } catch { /* dismissed */ }
  }

  return (
    <View style={s.screen} testID="listing-success-screen">
      <ScreenHeader title="" variant="modal" onBack={close} backAccessibilityLabel="Close" backTestID="listing-success-close" />
      <View style={s.body}>
        <View style={s.hero}>
          <SuccessCheck size={56} iconSize={28} />
          <Text style={s.headline} accessibilityRole="header">{updated ? 'Changes saved' : 'Listed!'}</Text>
          <Text style={s.sub}>
            {updated ? 'Your listing is up to date.' : 'Your item is live in your store and in search.'}
          </Text>
          {p.videoFailed ? <Text style={s.warn}>Your video didn’t upload. Add it again from Edit listing.</Text> : null}
        </View>

        <View style={s.item}>
          {p.cover ? <Image source={{ uri: p.cover }} style={s.thumb} /> : <View style={[s.thumb, { backgroundColor: theme.surface }]} />}
          <View style={s.itemText}>
            <Text style={s.itemTitle} numberOfLines={2}>{p.title}</Text>
            <Text style={s.itemPrice}>
              {formatCents(price)}
              {earn !== null ? <Text style={s.itemEarn}>{`  (You earn ${formatCents(earn)})`}</Text> : null}
            </Text>
          </View>
        </View>
      </View>

      <View style={[s.actions, { paddingBottom: Math.max(insets.bottom, SP.md) }]}>
        <Button label="Share listing" icon="share" onPress={() => { void share(); }} fullWidth disabled={!url} testID="listing-success-share" />
        {updated ? null : (
          <Button
            label="List another item"
            variant="secondary"
            fullWidth
            // The form underneath was already reset after posting.
            onPress={() => router.dismiss(1)}
            testID="listing-success-another"
          />
        )}
        <Button
          label="View listing"
          variant="secondary"
          fullWidth
          disabled={!p.id}
          onPress={() => { router.dismiss(2); router.push(`/product-detail?id=${encodeURIComponent(p.id ?? '')}` as never); }}
          testID="listing-success-view"
        />
      </View>
    </View>
  );
}

function makeStyles(t: AppThemePreset) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.background },
    body: { flex: 1, paddingHorizontal: SP.md },
    hero: { alignItems: 'center', paddingTop: SP.md, paddingBottom: SP.lg, gap: SP.sm },
    headline: { fontSize: FS.xl, fontFamily: FONT.bold, color: t.text, marginTop: SP.sm },
    sub: { fontSize: FS.base, lineHeight: 22, fontFamily: FONT.regular, color: t.muted, textAlign: 'center' },
    warn: { fontSize: FS.sm, fontFamily: FONT.regular, color: t.error, textAlign: 'center' },
    item: {
      flexDirection: 'row', gap: SP.md, alignItems: 'center', paddingVertical: SP.md,
      borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.border,
    },
    thumb: { width: 64, height: 80, borderRadius: 4 },
    itemText: { flex: 1, gap: 4 },
    itemTitle: { fontSize: FS.base, fontFamily: FONT.semibold, color: t.text },
    itemPrice: { fontSize: FS.base, fontFamily: FONT.semibold, color: t.text },
    itemEarn: { fontFamily: FONT.regular, color: t.muted },
    actions: { paddingHorizontal: SP.md, gap: SP.sm },
  });
}
