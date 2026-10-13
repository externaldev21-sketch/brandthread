/**
 * Inline "Learn more about …" link that opens a seller help article in a
 * bottom sheet, without leaving the screen — the Shopify iOS pattern of a
 * small muted link under a section that explains it.
 *
 * Usage: <HelpLink article="payouts" />  (label defaults to the article's
 * own linkLabel; ids live in content/help/sellerArticles.ts).
 */
import React, { useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { PressableScale } from '@/components/BrandthreadUI';
import { useColors } from '@/hooks/useColors';
import { TYPE_SCALE } from '@/constants/typography';
import { getSellerArticle, type SellerArticleId } from '@/content/help/sellerArticles';
import { HelpArticleSheet } from './HelpArticleSheet';

export function HelpLink({ article, label, style }: {
  article: SellerArticleId;
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = useColors();
  const [open, setOpen] = useState(false);
  const entry = getSellerArticle(article);
  if (!entry) return null;
  const text = label ?? entry.linkLabel;

  return (
    <View style={style}>
      <PressableScale
        onPress={() => setOpen(true)}
        noMinHeight
        hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
        accessibilityRole="link"
        accessibilityLabel={text}
        testID={`help-link-${article}`}
        style={styles.row}
      >
        <Feather name="help-circle" size={13} color={palette.mutedForeground} />
        <Text style={[TYPE_SCALE.footnote, { color: palette.mutedForeground }]}>{text}</Text>
      </PressableScale>
      <HelpArticleSheet article={open ? entry : null} onClose={() => setOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
});
