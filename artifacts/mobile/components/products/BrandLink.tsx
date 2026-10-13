/**
 * The brand name on a product, as a link to the brand's store (item 136:
 * "brand name tappable on every card").
 *
 * Reference: SSENSE's product page and product tiles, where the designer
 * name above the product name opens that designer's page
 * (https://mobbin.com/flows/0f29b0fc-f9f8-4d14-b152-cce071029b9e). Reskinned:
 * system text, Dev's silver/white, no colour.
 *
 * Renders plain text (still the same look) when there is no seller id to
 * link to, so a card never shows a link that goes nowhere.
 */
import React from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { profileHref } from '@/lib/profileNavigation';
import { hapticToggle } from '@/lib/haptics';

export interface BrandLinkProps {
  sellerId?: string | null;
  name?: string | null;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  testID?: string;
}

export function brandLinkHref(sellerId: string): string {
  return profileHref({ userId: sellerId, accountType: 'seller' });
}

export function BrandLink({ sellerId, name, style, numberOfLines = 1, testID }: BrandLinkProps) {
  const router = useRouter();
  const label = name?.trim();
  if (!label) return null;
  if (!sellerId) {
    return <Text style={style} numberOfLines={numberOfLines} testID={testID}>{label}</Text>;
  }
  return (
    <Text
      style={style}
      numberOfLines={numberOfLines}
      suppressHighlighting
      accessibilityRole="link"
      accessibilityLabel={`${label}, open store`}
      // A nested Text press: the card around it keeps its own onPress for
      // the product; only the brand name opens the store.
      onPress={(e) => {
        e?.stopPropagation?.();
        hapticToggle();
        router.push(brandLinkHref(sellerId) as never);
      }}
      testID={testID}
    >
      {label}
    </Text>
  );
}
