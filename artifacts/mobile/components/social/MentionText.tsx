/**
 * Comment body with verified @handles rendered as tappable links. Only handles
 * the server resolved into `mentions` are tappable; everything else is plain
 * text. Renders nested <Text>, so it never adds a pressable ancestor or
 * descendant pair around the comment's long-press area.
 */
import React from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { FONT } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { parseMentionSegments, type CommentMentionRef } from '@/lib/commentMentions';

export function MentionText({
  body, mentions, style, onPressMention,
}: {
  body: string;
  mentions?: CommentMentionRef[] | null;
  style?: StyleProp<TextStyle>;
  onPressMention?: (mention: CommentMentionRef) => void;
}) {
  const { theme } = useAppTheme();
  const segments = parseMentionSegments(body, mentions);
  return (
    <Text style={style}>
      {segments.map((segment, index) => segment.type === 'mention' ? (
        <Text
          key={index}
          // Item 143: mentions are white and bold wherever they appear.
          style={{ fontFamily: FONT.bold, color: theme.text }}
          onPress={onPressMention ? () => onPressMention({ userId: segment.userId, handle: segment.handle }) : undefined}
          accessibilityRole="link"
          accessibilityLabel={`Open ${segment.text}`}
        >
          {segment.text}
        </Text>
      ) : (
        <Text key={index}>{segment.text}</Text>
      ))}
    </Text>
  );
}
