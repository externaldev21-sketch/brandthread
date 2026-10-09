/**
 * GOAT's size sheet, 1:1 and reskinned (Adding to cart (instant):
 * https://mobbin.com/flows/c34f9bac-a2d5-4cf8-a371-800e7329649d): a grabber,
 * the sizes title, a horizontal scroller with each size and its price under
 * it (struck through when discounted; the picked size bold white, the rest
 * grey), the offer row for the picked size underneath, and — once a size is
 * picked — two equal buttons side by side: "Checkout" (outline) and
 * "Add to bag" (primary).
 */
import React, { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BottomSheet, Button } from '@/components/ui';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { FONT, FS, SP } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';
import type { SizeCell } from '@/lib/sizeSheet';

const CELL_W = 72;

export function SizeSheet({
  visible, title, cells, selectedValueId, stockLine, promiseLine,
  checkoutLabel = 'Checkout', checkoutDisabled, checkoutBusy, addBusy,
  onSelect, onCheckout, onAddToBag, onClose,
}: {
  visible: boolean;
  /** e.g. "Sizes". */
  title: string;
  cells: SizeCell[];
  selectedValueId: string | null;
  /** "In stock" / "Only 2 left" for the picked size. */
  stockLine: string | null;
  /** "Delivered in 15 days or your money back". */
  promiseLine: string;
  checkoutLabel?: string;
  checkoutDisabled?: boolean;
  checkoutBusy?: boolean;
  addBusy?: boolean;
  onSelect: (valueId: string) => void;
  onCheckout: () => void;
  onAddToBag: () => void;
  onClose: () => void;
}) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const scrollRef = useRef<ScrollView>(null);
  const selected = cells.find(c => c.valueId === selectedValueId) ?? null;
  const selectedIndex = cells.findIndex(c => c.valueId === selectedValueId);

  // Open on the picked size, like GOAT (it scrolls the strip to your size).
  useEffect(() => {
    if (!visible || selectedIndex < 0) return;
    const id = setTimeout(() => scrollRef.current?.scrollTo({ x: Math.max(0, (selectedIndex - 2) * CELL_W), animated: false }), 0);
    return () => clearTimeout(id);
  }, [visible, selectedIndex]);

  return (
    <BottomSheet visible={visible} onClose={onClose} testID="size-sheet">
      <Text style={s.title} accessibilityRole="header">{title}</Text>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.strip}
        accessibilityRole="radiogroup"
      >
        {cells.map((cell) => {
          const isSelected = cell.valueId === selectedValueId;
          const soldOut = cell.priceCents === null;
          return (
            <Pressable
              key={cell.valueId}
              onPress={() => { if (!soldOut) onSelect(cell.valueId); }}
              disabled={soldOut}
              style={s.cell}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected, disabled: soldOut }}
              accessibilityLabel={`${cell.label}, ${soldOut ? 'sold out' : formatCents(cell.priceCents!)}`}
              testID={`size-sheet-option-${cell.label}`}
            >
              <Text style={[s.cellSize, isSelected ? s.selectedText : s.dimText]}>{cell.label}</Text>
              {soldOut ? (
                <Text style={[s.cellPrice, s.dimText]}>Sold out</Text>
              ) : (
                <View style={s.priceStack}>
                  {cell.compareAtCents !== null && <Text style={[s.cellPrice, s.dimText, s.struck]}>{formatCents(cell.compareAtCents)}</Text>}
                  <Text style={[s.cellPrice, isSelected ? s.selectedText : s.dimText]}>{formatCents(cell.priceCents!)}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={s.rule} />

      {selected && selected.priceCents !== null ? (
        <View style={s.offer} testID="size-sheet-offer">
          <View style={s.offerPriceRow}>
            {selected.compareAtCents !== null && <Text style={[s.offerPrice, s.dimText, s.struck]}>{formatCents(selected.compareAtCents)}</Text>}
            <Text style={s.offerPrice}>{formatCents(selected.priceCents)}</Text>
          </View>
          {!!stockLine && <Text style={s.offerLine}>{stockLine}</Text>}
          <Text style={s.offerMeta}>{promiseLine}</Text>
          <View style={s.buttons}>
            <Button
              label={checkoutLabel}
              variant="secondary"
              onPress={onCheckout}
              loading={checkoutBusy}
              disabled={checkoutDisabled || checkoutBusy}
              style={s.button}
              testID="size-sheet-checkout"
            />
            <Button
              label="Add to bag"
              onPress={onAddToBag}
              loading={addBusy}
              disabled={addBusy}
              style={s.button}
              testID="size-sheet-add"
            />
          </View>
        </View>
      ) : (
        <View style={s.offer}>
          <Text style={s.offerMeta}>{promiseLine}</Text>
        </View>
      )}
    </BottomSheet>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  title: { fontFamily: FONT.semibold, fontSize: FS.base, color: theme.text, textAlign: 'center', marginBottom: SP.sm },
  strip: { paddingHorizontal: SP.sm },
  cell: { width: CELL_W, minHeight: 64, alignItems: 'center', justifyContent: 'flex-start', paddingVertical: SP.xs, gap: 4 },
  cellSize: { fontSize: FS.base, ...TABULAR_NUMS },
  priceStack: { alignItems: 'center' },
  cellPrice: { fontSize: FS.sm, ...TABULAR_NUMS },
  selectedText: { color: theme.text, fontFamily: FONT.bold },
  dimText: { color: theme.muted, fontFamily: FONT.regular },
  struck: { textDecorationLine: 'line-through' },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginTop: SP.sm },
  offer: { paddingHorizontal: SP.md, paddingTop: SP.md, gap: 4 },
  offerPriceRow: { flexDirection: 'row', alignItems: 'baseline', gap: SP.xs },
  offerPrice: { fontFamily: FONT.semibold, fontSize: FS.lg, color: theme.text, ...TABULAR_NUMS },
  offerLine: { fontFamily: FONT.medium, fontSize: FS.sm, color: theme.text },
  offerMeta: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted },
  buttons: { flexDirection: 'row', gap: SP.sm, marginTop: SP.md },
  button: { flex: 1 },
});
