import React from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { FONT } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { hashtagHref, mentionHref, splitRichCaption } from '@/lib/hashtagText';

import { splitProductMentions, type MentionSegment, type PostProductMention } from '@/lib/captionMentions';
/** Caption links preserve hashtags, people mentions and product mentions.
 */
export function CaptionSpans({
  text, tagStyle, productMentions, onProductMention, mentionStyle,
}: {
  text: string;
  tagStyle?: StyleProp<TextStyle>;
  productMentions?: PostProductMention[];
  onProductMention?: (mention: PostProductMention) => void;
  mentionStyle?: StyleProp<TextStyle>;
}) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const pieces: MentionSegment[] = onProductMention ? splitProductMentions(text, productMentions) : [{ kind: 'text', text }];
  const segments = pieces.flatMap((piece): Array<ReturnType<typeof splitRichCaption>[number] | Extract<MentionSegment, { kind: 'product' }>> => (
    piece.kind === 'product' ? [piece] : splitRichCaption(piece.text)
  ));
  if (!segments.some((s) => s.kind !== 'text')) return <>{text}</>;
  const linkStyle = [{ fontFamily: FONT.bold, color: theme.text }, tagStyle];
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'product' ? (
          <Text
            key={index}
            style={[{ fontFamily: FONT.bold }, mentionStyle]}
            accessibilityRole="link"
            accessibilityLabel={`Product ${segment.mention.name ?? segment.text}`}
            suppressHighlighting
            testID={`caption-product-${segment.mention.productId}`}
            onPress={() => onProductMention?.(segment.mention)}
          >
            {segment.text}
          </Text>
        ) : segment.kind === 'tag' ? (
          <Text
            key={index}
            style={linkStyle}
            accessibilityRole="link"
            accessibilityLabel={`Hashtag ${segment.tag}`}
            suppressHighlighting
            onPress={() => router.push(hashtagHref(segment.tag) as never)}
          >
            {segment.text}
          </Text>
        ) : segment.kind === 'mention' ? (
          <Text
            key={index}
            style={linkStyle}
            accessibilityRole="link"
            accessibilityLabel={`Open ${segment.text}`}
            suppressHighlighting
            onPress={() => router.push(mentionHref(segment.handle) as never)}
          >
            {segment.text}
          </Text>
        ) : (
          <React.Fragment key={index}>{segment.text}</React.Fragment>
        ),
      )}
    </>
  );
}

export function CaptionText({
  text, style, numberOfLines, tagStyle, productMentions, onProductMention,
}: {
  text: string; style?: StyleProp<TextStyle>; numberOfLines?: number; tagStyle?: StyleProp<TextStyle>;
  productMentions?: PostProductMention[]; onProductMention?: (mention: PostProductMention) => void;
}) {
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      <CaptionSpans text={text} tagStyle={tagStyle} productMentions={productMentions} onProductMention={onProductMention} />
    </Text>
  );
}

export default CaptionText;
