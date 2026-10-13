/**
 * Variant table: one row per variant (e.g. each size) × inline-editable
 * Price and Stock columns, Shopify-admin style. Values stay strings owned by
 * the parent screen (its own save logic parses them); this component only
 * strips characters that can't be part of a price / whole-number stock.
 */
import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { sanitizePriceInput, sanitizeStockInput } from '@/lib/variantTableInput';

export interface VariantTableRow {
  id: string;
  label: string;
  /** Second line under the label, e.g. "Sold out". */
  sublabel?: string;
  price: string;
  stock: string;
  pricePlaceholder?: string;
  highlighted?: boolean;
}

interface Props {
  rows: VariantTableRow[];
  onChangePrice: (id: string, text: string) => void;
  onChangeStock: (id: string, text: string) => void;
  /** Before the label (e.g. a bulk-select checkbox). */
  renderLeading?: (row: VariantTableRow) => React.ReactNode;
  /** After the Stock cell (e.g. delete or expand). Keep it ≤ 32pt wide. */
  renderTrailing?: (row: VariantTableRow) => React.ReactNode;
  /** Extra content under the row (e.g. SKU, low-stock level). */
  renderBelow?: (row: VariantTableRow) => React.ReactNode;
  firstColumnLabel?: string;
  testID?: string;
}

export const PRICE_COL = 84;
export const STOCK_COL = 64;
export const TRAILING_COL = 32;

export function VariantTable({
  rows, onChangePrice, onChangeStock, renderLeading, renderTrailing, renderBelow, firstColumnLabel = 'Variant', testID,
}: Props) {
  const { theme } = useAppTheme();
  const inputStyle = [styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }];
  return (
    <View testID={testID}>
      <View style={[styles.headRow, { borderBottomColor: theme.border }]}>
        <Text style={[styles.head, styles.firstCol, { color: theme.muted }]}>{firstColumnLabel}</Text>
        <Text style={[styles.head, styles.priceCol, styles.right, { color: theme.muted }]}>Price</Text>
        <Text style={[styles.head, styles.stockCol, styles.right, { color: theme.muted }]}>Stock</Text>
        {renderTrailing ? <View style={styles.trailingCol} /> : null}
      </View>
      {rows.map((row, i) => (
        <View
          key={row.id}
          style={[
            styles.rowWrap,
            i < rows.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSubtle },
          ]}
          testID={`variant-table-row-${row.id}`}
        >
          <View style={styles.row}>
            <View style={[styles.firstCol, styles.labelCell]}>
              {renderLeading?.(row)}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.label, { color: theme.text }]} numberOfLines={2}>{row.label}</Text>
                {row.sublabel ? <Text style={[styles.sublabel, { color: theme.muted }]} numberOfLines={1}>{row.sublabel}</Text> : null}
              </View>
            </View>
            <TextInput
              style={[inputStyle, styles.priceCol, row.highlighted && { borderColor: theme.text }]}
              value={row.price}
              onChangeText={(t) => onChangePrice(row.id, sanitizePriceInput(t))}
              placeholder={row.pricePlaceholder ?? '0.00'}
              placeholderTextColor={theme.muted}
              keyboardType="decimal-pad"
              selectTextOnFocus
              accessibilityLabel={`Price for ${row.label}`}
            />
            <TextInput
              style={[inputStyle, styles.stockCol, row.highlighted && { borderColor: theme.text }]}
              value={row.stock}
              onChangeText={(t) => onChangeStock(row.id, sanitizeStockInput(t))}
              placeholder="0"
              placeholderTextColor={theme.muted}
              keyboardType="number-pad"
              selectTextOnFocus
              accessibilityLabel={`Stock for ${row.label}`}
            />
            {renderTrailing ? <View style={[styles.trailingCol, styles.trailingCell]}>{renderTrailing(row)}</View> : null}
          </View>
          {renderBelow?.(row)}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingBottom: SP.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  head: {
    fontFamily: FONT.semibold,
    fontSize: FS.xs,
    letterSpacing: 0.2,
  },
  right: { textAlign: 'right' },
  rowWrap: {
    paddingVertical: SP.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
  },
  firstCol: { flex: 1, minWidth: 0 },
  priceCol: { width: PRICE_COL },
  stockCol: { width: STOCK_COL },
  trailingCol: { width: TRAILING_COL },
  trailingCell: { alignItems: 'center', justifyContent: 'center' },
  labelCell: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  label: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    lineHeight: 20,
  },
  sublabel: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    lineHeight: 18,
  },
  input: {
    height: 40,
    borderWidth: 1,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SP.sm,
    fontFamily: FONT.medium,
    fontSize: FS.base,
    textAlign: 'right',
  },
});
