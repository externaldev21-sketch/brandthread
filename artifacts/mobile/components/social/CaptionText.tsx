import React from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { FONT } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { hashtagHref, mentionHref, splitRichCaption } from '@/lib/hashtagText';

/**
 * Caption body with tappable #hashtags and @mentions. Drop-in for `{caption}`
 * inside an existing <Text> (CaptionSpans) or as its own <Text>
 * (CaptionText). Captions without either render as the same single plain
 * string, so layout is identical to before.
 *
 * Item 143 (Instagram caption pattern, reskinned): mentions and hashtags are
 * white and bold, everything else keeps the caption's own colour.
 */
export function CaptionSpans({ text, tagStyle }: { text: string; tagStyle?: StyleProp<TextStyle> }) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const segments = splitRichCaption(text);
  if (!segments.some((s) => s.kind !== 'text')) return <>{text}</>;
  const linkStyle = [{ fontFamily: FONT.bold, color: theme.text }, tagStyle];
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'tag' ? (
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
  text, style, numberOfLines, tagStyle,
}: { text: string; style?: StyleProp<TextStyle>; numberOfLines?: number; tagStyle?: StyleProp<TextStyle> }) {
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      <CaptionSpans text={text} tagStyle={tagStyle} />
    </Text>
  );
}

export default CaptionText;
