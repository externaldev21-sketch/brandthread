/**
 * Bag sheet: every product in the current live, the one being sold right
 * now marked "Live now". "Buy" hands off to the shared Shop sheet.
 */
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SheetRise } from '@/components/motion/SheetRise';
import { Sheet } from '@/components/ui/BottomSheet';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { formatCents } from '@/lib/money';
import { TABULAR_NUMS } from '@/constants/typography';
import type { LiveProduct } from '@/lib/live/types';
import { LIVE_RED } from './LiveAvatarRing';
import { Button } from '@/components/ui/Button';
import { describeLiveCode, type LiveCode } from '@/lib/live/liveCommerce';

export function LiveProductsSheet({
  visible, hostName, products, pinnedProductId, onBuy, onClose, codes = [], appliedCode = null, onApplyCode,
}: {
  visible: boolean;
  hostName: string;
  products: LiveProduct[];
  pinnedProductId: string | null;
  onBuy: (productId: string) => void;
  onClose: () => void;
  /** Live-only codes the host shared in this live; tap to apply at checkout. */
  codes?: LiveCode[];
  appliedCode?: string | null;
  onApplyCode?: (code: string) => void;
}) {
  const { theme } = useAppTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title="Shop this live" testID="live-products-sheet">
      <Text style={[styles.sub, styles.subHeader, { color: theme.muted }]}>{products.length} {products.length === 1 ? 'piece' : 'pieces'} from {hostName}</Text>
      <View style={{ gap: SP.sm }}>
        {codes.length > 0 && onApplyCode && (
          <View style={{ gap: SP.sm }} testID="live-codes">
            {codes.map(c => {
              const applied = appliedCode?.toUpperCase() === c.code.toUpperCase();
              return (
                <View key={c.id} style={[styles.row, { borderColor: theme.border }]}>
                  <Icon name="tag" size={18} color={theme.text} style={{ marginHorizontal: 8 }} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.name, { color: theme.text }]}>{c.code}</Text>
                    <Text style={[styles.sub, { color: theme.muted }]}>
                      {describeLiveCode(c)}{c.minOrderCents > 0 ? ` over ${formatCents(c.minOrderCents)}` : ''}
                    </Text>
                  </View>
                  <Button
                    label={applied ? 'Applied' : 'Apply'}
                    variant={applied ? 'secondary' : 'primary'}
                    size="compact"
                    icon={applied ? 'check' : undefined}
                    disabled={applied}
                    onPress={() => onApplyCode(c.code)}
                    accessibilityLabel={applied ? `${c.code} applied` : `Apply code ${c.code}`}
                  />
                </View>
              );
            })}
          </View>
        )}
        {products.map((p, i) => {
          const live = p.productId === pinnedProductId;
          return (
            <View key={p.productId} style={[styles.row, { borderColor: live ? theme.text : theme.border }]}>
              <Text style={[styles.index, { color: theme.muted }, TABULAR_NUMS]}>{i + 1}</Text>
              <View style={[styles.thumb, { backgroundColor: theme.cardElevated }]}>
                {p.imageUri ? <CachedImage source={{ uri: p.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Icon name="shopping-bag" size={18} color={theme.muted} />}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                {live && (
                  <View style={[styles.liveChip, { backgroundColor: LIVE_RED }]}>
                    <Text style={[styles.liveChipText, { color: '#fff' }]}>LIVE NOW</Text>
                  </View>
                )}
                <Text style={[styles.name, { color: theme.text }]} numberOfLines={2}>{p.name}</Text>
                <Text style={[styles.price, { color: theme.text }, TABULAR_NUMS]}>{formatCents(p.priceCents)}</Text>
              </View>
              <Button
                label="Buy"
                size="compact"
                onPress={() => onBuy(p.productId)}
                accessibilityLabel={`Buy ${p.name}`}
              />
            </View>
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  sub: { fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
  subHeader: { marginTop: 0, marginBottom: SP.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: RADIUS.md, padding: 8 },
  index: { fontFamily: FONT.semibold, fontSize: FS.xs, width: 14, textAlign: 'center' },
  thumb: { width: 56, height: 56, borderRadius: RADIUS.xs, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  liveChip: { alignSelf: 'flex-start', borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1, marginBottom: 3 },
  liveChipText: { fontFamily: FONT.bold, fontSize: 11 },
  name: { fontFamily: FONT.semibold, fontSize: FS.sm },
  price: { fontFamily: FONT.bold, fontSize: FS.sm, marginTop: 2 },
});
