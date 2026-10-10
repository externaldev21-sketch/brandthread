import React from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { FONT } from '@/lib/theme';
import { hashtagHref, splitCaption } from '@/lib/hashtagText';

/**
 * Caption body with tappable #hashtags. Drop-in for `{caption}` inside an
 * existing <Text> (CaptionSpans) or as its own <Text> (CaptionText). Captions
 * without a hashtag render as the same single plain string, so layout is
 * identical to before.
 */
export function CaptionSpans({ text, tagStyle }: { text: string; tagStyle?: StyleProp<TextStyle> }) {
  const router = useRouter();
  const segments = splitCaption(text);
  if (!segments.some((s) => s.kind === 'tag')) return <>{text}</>;
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'tag' ? (
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
  text, style, numberOfLines, tagStyle,
}: { text: string; style?: StyleProp<TextStyle>; numberOfLines?: number; tagStyle?: StyleProp<TextStyle> }) {
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      <CaptionSpans text={text} tagStyle={tagStyle} />
    </Text>
  );
}

export default CaptionText;
