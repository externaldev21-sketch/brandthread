import React from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { FONT } from '@/lib/theme';
import { hashtagHref, splitCaption, type CaptionSegment } from '@/lib/hashtagText';
import { splitProductMentions, type MentionSegment, type PostProductMention } from '@/lib/captionMentions';

/**
 * Caption body with tappable #hashtags and, when the post has
 * `productMentions`, tappable product names (bold, TikTok-style linked
 * tokens) that call `onProductMention`. Drop-in for `{caption}` inside an
 * existing <Text> (CaptionSpans) or as its own <Text> (CaptionText). Captions
 * without a hashtag or mention render as the same single plain string, so
 * layout is identical to before.
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
  const pieces: MentionSegment[] = onProductMention ? splitProductMentions(text, productMentions) : [{ kind: 'text', text }];
  const segments = pieces.flatMap((piece): Array<CaptionSegment | Extract<MentionSegment, { kind: 'product' }>> => (
    piece.kind === 'product' ? [piece] : splitCaption(piece.text)
  ));
  if (!segments.some((s) => s.kind !== 'text')) return <>{text}</>;
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
            style={[{ fontFamily: FONT.semibold }, tagStyle]}
            accessibilityRole="link"
            accessibilityLabel={`Hashtag ${segment.tag}`}
            suppressHighlighting
            onPress={() => router.push(hashtagHref(segment.tag) as never)}
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
