/**
 * SaveHeart — the save / wishlist button for a product.
 *
 * Tap saves or unsaves (optimistic, see lib/saved/savedProductsStore.ts);
 * long-press opens the "Save to…" collection picker, and the "Saved" toast
 * carries an "Add to collection" action for the same thing. Reference: GOAT /
 * Depop / SSENSE corner hearts, reskinned to the monochrome palette — a small
 * solid chip with an outline heart that fills when saved.
 *
 * Always render this as a SIBLING of the card's own Pressable (absolutely
 * positioned via `style`), never inside it: a nested button is invalid DOM on
 * web (see tests/buyer-shopping-no-nested-pressables.test.ts).
 */
import React from 'react';
import { Pressable, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { IconFillTransition } from '@/components/ui/IconFillTransition';
import { useIsProductSaved } from '@/hooks/useSavedProduct';
import { openSaveToCollection, toggleSavedProduct } from '@/lib/saved/savedProducts';
import { haptics } from '@/lib/haptics';

export interface SaveHeartProps {
  productId: string | null | undefined;
  title: string;
  brand?: string;
  priceCents?: number | null;
  /** Visible chip diameter. The tap target is padded out to 44pt. */
  size?: number;
  /** Override the icon colour (e.g. white over full-bleed photo chrome). */
  iconColor?: string;
  /** Positioning (absolute top/right/bottom/left) supplied by the host card. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export const SaveHeart = React.memo(function SaveHeart({
  productId, title, brand, priceCents, size = 30, iconColor, style, testID,
}: SaveHeartProps) {
  const { theme } = useAppTheme();
  const saved = useIsProductSaved(productId);
  if (!productId) return null;

  const draft = {
    productId,
    title,
    brand,
    priceCents: typeof priceCents === 'number' ? priceCents : undefined,
  };
  const pad = Math.max(0, Math.ceil((44 - size) / 2));

  return (
    <Pressable
      onPress={() => { haptics.light(); void toggleSavedProduct(draft); }}
      onLongPress={() => { haptics.rigid(); openSaveToCollection(draft); }}
      delayLongPress={350}
      hitSlop={{ top: pad, bottom: pad, left: pad, right: pad }}
      accessibilityRole="button"
      accessibilityLabel={saved ? `Remove ${title} from saved` : `Save ${title}`}
      accessibilityHint="Touch and hold to add to a collection"
      accessibilityState={{ selected: saved }}
      testID={testID ?? `save-heart-${productId}`}
      style={[
        styles.chip,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: theme.card, borderColor: theme.border },
        style,
      ]}
    >
      <IconFillTransition
        outlineName="heart"
        solidName="heart"
        size={Math.round(size * 0.52)}
        active={saved}
        activeColor={iconColor ?? theme.text}
        inactiveColor={iconColor ?? theme.text}
      />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  chip: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, zIndex: 2 },
});
