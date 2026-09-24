/**
 * Renders AI reply text using the parsed blocks from lib/aiMarkdownLite.ts.
 * Presentational only — see that module for the parsing rules.
 */
import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { parseMarkdownLite } from '@/lib/aiMarkdownLite';
import { BORDER, CARD_ELEVATED, FG, FONT, FS } from '@/lib/theme';

const MONO_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

interface MarkdownLiteProps {
  text: string;
  textColor?: string;
}

export default function MarkdownLite({ text, textColor = FG }: MarkdownLiteProps) {
  const blocks = parseMarkdownLite(text);

  return (
    <View>
      {blocks.map((block, i) => {
        if (block.type === 'code') {
          return (
            <View key={i} style={styles.codeBlock}>
              <Text style={styles.codeText}>{block.text}</Text>
            </View>
          );
        }
        const content = block.segments.map((seg, j) => (
          <Text key={j} style={seg.bold ? styles.bold : undefined}>
            {seg.text}
          </Text>
        ));
        if (block.type === 'bullet') {
          return (
            <View key={i} style={styles.bulletRow}>
              <Text style={[styles.bulletDot, { color: textColor }]}>{'•'}</Text>
              <Text style={[styles.text, { color: textColor }]}>{content}</Text>
            </View>
          );
        }
        return (
          <Text key={i} style={[styles.text, styles.paragraph, { color: textColor }]}>
            {content}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  text: {
    fontSize: FS.base,
    fontFamily: FONT.regular,
    lineHeight: 22,
  },
  paragraph: {
    marginBottom: 2,
  },
  bold: {
    fontFamily: FONT.semibold,
  },
  bulletRow: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  bulletDot: {
    width: 16,
    fontSize: FS.base,
    lineHeight: 22,
  },
  codeBlock: {
    backgroundColor: CARD_ELEVATED,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    padding: 10,
    marginVertical: 6,
  },
  codeText: {
    color: FG,
    fontFamily: MONO_FONT,
    fontSize: FS.sm,
    lineHeight: 18,
  },
});
