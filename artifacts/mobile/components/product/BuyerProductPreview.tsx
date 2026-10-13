/**
 * The buyer product page (app/buyer-product-detail.tsx) rendered from a
 * listing that is not published yet. It uses the buyer page's own gallery,
 * option picker, policy rows and styles, in the same order, but only the
 * parts that come from the listing itself: everything the buyer page loads
 * per product (reviews, questions, stock counter, related items, seller
 * payment status) needs a published product and makes network calls, so it
 * is left out. The purchase bar (BuyerProductPreviewActionBar) is disabled.
 */
import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { ResponsiveContainer, StickyFooter } from '@/components/layout';
import { Avatar, Button } from '@/components/ui';
import { BuyerProtectionNote } from '@/components/BuyerProtectionNote';
import { formatCents } from '@/lib/money';
import { SP } from '@/lib/theme';
import type { BuyerProduct } from '@/services/cartTypes';
import type { DraftPreviewRow } from '@/lib/draftBuyerPreview';
import {
  OptionPicker,
  PolicyRow,
  ProductGallery,
  adaptApiProductToBuyerProduct,
  makeStyles as makeBuyerProductStyles,
} from '@/app/buyer-product-detail';

/** The buyer page's own adapter, so the preview matches the published page. */
export function buyerProductFromDraftRow(row: DraftPreviewRow): BuyerProduct {
  return adaptApiProductToBuyerProduct(row);
}

export function BuyerProductPreview({ product, testID }: {
  product: BuyerProduct;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeBuyerProductStyles(theme), [theme]);
  const [selections, setSelections] = useState<Record<string, string>>({});

  const allSelected = product.options.every(o => !!selections[o.id]);
  const variant = allSelected
    ? product.variants.find(v => v.optionValues.every(ov => selections[ov.optionId] === ov.valueId)) ?? null
    : null;
  const price = variant?.priceCents ?? product.priceCents;
  const compare = variant?.compareAtPriceCents ?? product.compareAtPriceCents;
  const hasDiscount = !!compare && compare > price;

  return (
    <View testID={testID}>
      <View style={s.imageArea}>
        <ProductGallery imageUris={product.imageUris} accentColor={theme.accent} />
      </View>

      <ResponsiveContainer style={s.body}>
        <View style={s.badgeRow}>
          {product.isPreOrder && (
            <View style={s.preOrderBadge}>
              <Feather name="clock" size={12} color={theme.secondary} />
              <Text style={s.preOrderBadgeText}>PRE-ORDER</Text>
            </View>
          )}
          {hasDiscount && (
            <View style={s.saleBadge}>
              <Text style={s.saleBadgeText}>SALE</Text>
            </View>
          )}
        </View>

        <Text style={s.productName} numberOfLines={3}>{product.name || 'Untitled product'}</Text>
        <View style={s.priceRow}>
          <Text style={[s.price, hasDiscount ? s.priceSale : undefined]}>{formatCents(price)}</Text>
          {hasDiscount && <Text style={s.comparePrice}>{formatCents(compare!)}</Text>}
          {hasDiscount && <Text style={s.savings}>Save {formatCents(compare! - price)}</Text>}
        </View>

        {product.isPreOrder && (
          <View style={s.preOrderCard}>
            <View style={s.preOrderRow}>
              <Feather name="clock" size={16} color={theme.secondary} />
              <Text style={s.preOrderTitle}>Pre-Order Item</Text>
            </View>
            {product.preOrderClosingDate && (
              <Text style={s.preOrderDetail}>
                Pre-order closes: {new Date(product.preOrderClosingDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </Text>
            )}
            {product.preOrderEstShipDate && (
              <Text style={s.preOrderDetail}>
                Est. ship date: {new Date(product.preOrderEstShipDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </Text>
            )}
            <Text style={s.preOrderDisclaimer}>
              Production and ship dates are estimates and may change. You will be notified of any updates.
            </Text>
          </View>
        )}

        <View style={s.divider} />

        {product.options.map(option => (
          <OptionPicker
            key={option.id}
            product={product}
            option={option}
            selections={selections}
            onSelect={(optionId, valueId) => setSelections(prev => ({ ...prev, [optionId]: valueId }))}
          />
        ))}

        {!!product.sizeChartImageUrl && (
          <View style={s.sizeGuideLink}>
            <Feather name="maximize" size={13} color={theme.accentLight} />
            <Text style={[s.sizeGuideLinkText, { color: theme.accentLight }]}>Size guide</Text>
          </View>
        )}

        {variant && (
          <View style={s.stockRow}>
            <View style={[s.stockDot, {
              backgroundColor: variant.isAvailable && variant.inventoryQuantity <= 5 ? theme.text : variant.isAvailable ? theme.muted : theme.subtle,
            }]} />
            <Text style={[s.stockText, { color: variant.isAvailable && variant.inventoryQuantity <= 5 ? theme.text : theme.muted }]}>
              {variant.isAvailable
                ? variant.inventoryQuantity <= 5 ? `Only ${variant.inventoryQuantity} left in stock` : 'In stock'
                : 'Out of stock — select another option'}
            </Text>
          </View>
        )}

        <View style={s.divider} />
        <View style={s.sellerCard}>
          <Avatar name={product.sellerName} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={s.sellerName} numberOfLines={1}>{product.sellerName}</Text>
          </View>
          <View style={s.sellerViewStore}>
            <Text style={s.sellerViewStoreText}>View store</Text>
            <Feather name="chevron-right" size={14} color={theme.muted} />
          </View>
        </View>

        {product.description?.trim() ? (
          <>
            <View style={s.divider} />
            <Text style={s.descTitle}>About this piece</Text>
            <Text style={s.desc}>{product.description.trim()}</Text>
          </>
        ) : null}

        <View style={s.divider} />
        <PolicyRow icon="refresh-ccw" label="Returns" value={product.refundPolicy} />
        <PolicyRow icon="x-circle" label="Cancellation" value={product.cancellationPolicy} />
        <BuyerProtectionNote preorder={product.isPreOrder} style={{ marginTop: SP.sm }} />
      </ResponsiveContainer>
    </View>
  );
}

/** The buyer page's sticky Add to cart / Buy now bar, disabled (full-screen preview only). */
export function BuyerProductPreviewActionBar({ product }: { product: BuyerProduct }) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeBuyerProductStyles(theme), [theme]);
  return (
    <StickyFooter style={s.actionBar}>
      <View style={s.actionBarRow}>
        <Button label="Add to cart" variant="secondary" onPress={() => {}} disabled style={s.buyNowBtn} />
        <Button
          label={product.isPreOrder ? 'Reserve (No Charge)' : 'Buy now'}
          variant="primary"
          onPress={() => {}}
          disabled
          style={s.buyNowBtn}
        />
      </View>
    </StickyFooter>
  );
}
