/**
 * One seller help article (content/help/sellerArticles.ts) in the shared
 * BottomSheet — Shopify's inline "Learn more" opens the article over the
 * screen the seller is on instead of leaving it.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useColors } from '@/hooks/useColors';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import type { SellerArticle } from '@/content/help/sellerArticles';

export function HelpArticleSheet({ article, onClose }: { article: SellerArticle | null; onClose: () => void }) {
  const palette = useColors();
  // Keep the last article on screen through the close animation.
  const [shown, setShown] = React.useState<SellerArticle | null>(article);
  React.useEffect(() => { if (article) setShown(article); }, [article]);

  return (
    <BottomSheet visible={!!article} onClose={onClose} testID="help-article-sheet">
      {shown && (
        <View style={styles.wrap}>
          <Text style={[TYPE_SCALE.headline, { color: palette.foreground }]} accessibilityRole="header">{shown.title}</Text>
          {shown.body.map((paragraph, i) => (
            <Text key={i} style={[TYPE_SCALE.body, { color: palette.mutedForeground }]}>{paragraph}</Text>
          ))}
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: SPACING.sm, paddingHorizontal: SPACING.md, paddingTop: SPACING.xs, paddingBottom: SPACING.md },
});
