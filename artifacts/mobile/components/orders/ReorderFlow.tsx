/**
 * Reorder flow for order history / order detail.
 *
 * `useReorderFlow()` runs reorderFromOrder() for one order, then surfaces the
 * result: a snackbar ("3 items added · 1 unavailable" + View cart) and, when
 * anything needs the buyer's attention (unavailable lines, price changes,
 * reduced quantities), a bottom sheet that lists it. Render `element` once
 * near the root of the screen.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Snackbar } from '@/components/ui/Snackbar';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/hooks/useApi';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { FONT } from '@/lib/theme';
import { reorderFromOrder } from '@/services/reorderService';
import {
  priceChangeNote, reorderNeedsReview, summarizeReorder, unavailableReasonLabel,
  type ReorderOutcome,
} from '@/lib/reorderSummary';

const SNACKBAR_MS = 5000;

export function useReorderFlow(options: { aboveTabBar?: boolean } = {}) {
  const tabBarInset = useBuyerTabBarInset();
  const api = useApi();
  const router = useRouter();
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ReorderOutcome | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(false);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const showMessage = useCallback((text: string) => {
    if (timer.current) clearTimeout(timer.current);
    setMessage(text);
    timer.current = setTimeout(() => setMessage(null), SNACKBAR_MS);
  }, []);

  const openCart = useCallback(() => {
    setSheetOpen(false);
    setMessage(null);
    router.push('/(buyer)/cart' as never);
  }, [router]);

  const reorder = useCallback(async (orderId: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusyOrderId(orderId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      const result = await reorderFromOrder(orderId, api);
      setOutcome(result);
      showMessage(summarizeReorder(result));
      if (result.addedUnits > 0) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (reorderNeedsReview(result)) setSheetOpen(true);
    } catch {
      setOutcome(null);
      showMessage("Couldn't reorder. Try again.");
    } finally {
      busyRef.current = false;
      setBusyOrderId(null);
    }
  }, [api, showMessage]);

  const element = (
    <>
      <Snackbar
        visible={!!message && !sheetOpen}
        message={message ?? ''}
        actionLabel={outcome && outcome.addedUnits > 0 ? 'View cart' : undefined}
        onAction={openCart}
        onDismiss={() => setMessage(null)}
        bottomOffset={options.aboveTabBar ? tabBarInset + SPACING.xs : undefined}
      />
      <ReorderSheet
        visible={sheetOpen}
        outcome={outcome}
        onClose={() => setSheetOpen(false)}
        onOpenCart={openCart}
      />
    </>
  );

  return { reorder, busyOrderId, element };
}

function ReorderSheet({
  visible, outcome, onClose, onOpenCart,
}: { visible: boolean; outcome: ReorderOutcome | null; onClose: () => void; onOpenCart: () => void}) {
  const colors = useColors();
  const styles = useMemo(() => StyleSheet.create({
    body: { paddingHorizontal: SPACING.md, paddingBottom: SPACING.md },
    title: { ...TYPE_SCALE.headline, color: colors.foreground },
    heading: { ...TYPE_SCALE.footnote, fontFamily: FONT.semibold, color: colors.mutedForeground, marginTop: SPACING.md, marginBottom: SPACING.xxs },
    row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, paddingVertical: SPACING.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    rowCopy: { flex: 1, minWidth: 0 },
    rowTitle: { ...TYPE_SCALE.body, fontFamily: FONT.medium, color: colors.foreground },
    rowNote: { ...TYPE_SCALE.footnote, color: colors.mutedForeground },
    actions: { gap: SPACING.xs, marginTop: SPACING.md },
  }), [colors]);

  if (!outcome) return null;
  const hasAdded = outcome.addedUnits > 0;
  return (
    <BottomSheet visible={visible} onClose={onClose} testID="reorder-sheet">
      <View style={styles.body}>
        <Text style={styles.title}>{summarizeReorder(outcome)}</Text>

        {outcome.unavailable.length > 0 && (
          <>
            <Text style={styles.heading}>Not added</Text>
            {outcome.unavailable.map((item, i) => (
              <View key={`${item.title}-${i}`} style={styles.row}>
                <Feather name="slash" size={16} color={colors.mutedForeground} />
                <View style={styles.rowCopy}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.rowNote}>{unavailableReasonLabel(item.reason)}</Text>
                </View>
              </View>
            ))}
          </>
        )}

        {outcome.priceChanges.length > 0 && (
          <>
            <Text style={styles.heading}>Price changed</Text>
            {outcome.priceChanges.map((change, i) => (
              <View key={`${change.title}-${i}`} style={styles.row}>
                <Feather name="tag" size={16} color={colors.mutedForeground} />
                <View style={styles.rowCopy}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{change.title}</Text>
                  <Text style={styles.rowNote}>{priceChangeNote(change)}</Text>
                </View>
              </View>
            ))}
          </>
        )}

        {outcome.reducedQuantityTitles.length > 0 && (
          <>
            <Text style={styles.heading}>Fewer than before</Text>
            {outcome.reducedQuantityTitles.map((title, i) => (
              <View key={`${title}-${i}`} style={styles.row}>
                <Feather name="minus-circle" size={16} color={colors.mutedForeground} />
                <View style={styles.rowCopy}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
                  <Text style={styles.rowNote}>Only what is left in stock was added</Text>
                </View>
              </View>
            ))}
          </>
        )}

        <View style={styles.actions}>
          {hasAdded && <Button label="View cart" icon="shopping-bag" onPress={onOpenCart} fullWidth />}
          <Button label={hasAdded ? 'Keep browsing' : 'Close'} variant="secondary" onPress={onClose} fullWidth />
        </View>
      </View>
    </BottomSheet>
  );
}
