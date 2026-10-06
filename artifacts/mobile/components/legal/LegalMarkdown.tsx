/**
 * Renders parsed legal markdown blocks (content/legal/parse.ts): headings,
 * paragraphs, bulleted and numbered lists, **bold** and [links](/route).
 *
 * It draws with the styles LegalDocument already uses for paragraphs and
 * bullets (passed in), so a document looks identical whether a section is
 * rendered from plain strings or from markdown blocks.
 */
import React from 'react';
import { Linking, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { parseInline, type LegalBlock } from '@/content/legal/parse';

export interface LegalMarkdownStyles {
  paragraph: StyleProp<TextStyle>;
  bulletRow: StyleProp<ViewStyle>;
  bullet: StyleProp<ViewStyle>;
  bulletText: StyleProp<TextStyle>;
  numberText: StyleProp<TextStyle>;
  heading: StyleProp<TextStyle>;
  bold: StyleProp<TextStyle>;
  link: StyleProp<TextStyle>;
}

function Inline({
  text, style, styles, onLink,
}: {
  text: string;
  style: StyleProp<TextStyle>;
  styles: LegalMarkdownStyles;
  onLink: (href: string) => void;
}) {
  return (
    <Text style={style}>
      {parseInline(text).map((segment, index) => {
        if (segment.href) {
          return (
            <Text
              key={index}
              accessibilityRole="link"
              style={styles.link}
              onPress={() => onLink(segment.href!)}
            >
              {segment.text}
            </Text>
          );
        }
        return segment.bold
          ? <Text key={index} style={styles.bold}>{segment.text}</Text>
          : <Text key={index}>{segment.text}</Text>;
      })}
    </Text>
  );
}

export default function LegalMarkdown({
  blocks, styles,
}: {
  blocks: LegalBlock[];
  styles: LegalMarkdownStyles;
}) {
  const router = useRouter();
  const onLink = React.useCallback((href: string) => {
    if (href.startsWith('/')) router.push(href as never);
    else void Linking.openURL(href).catch(() => {});
  }, [router]);

  return (
    <>
      {blocks.map((block, blockIndex) => {
        if (block.type === 'heading') {
          return <Text key={blockIndex} accessibilityRole="header" style={styles.heading}>{block.text}</Text>;
        }
        if (block.type === 'paragraph') {
          return <Inline key={blockIndex} text={block.text} style={styles.paragraph} styles={styles} onLink={onLink} />;
        }
        return (
          <React.Fragment key={blockIndex}>
            {block.items.map((item, itemIndex) => (
              <View key={itemIndex} style={styles.bulletRow}>
                {block.type === 'numbered'
                  ? <Text style={styles.numberText}>{itemIndex + 1}.</Text>
                  : <View style={styles.bullet} />}
                <Inline text={item} style={styles.bulletText} styles={styles} onLink={onLink} />
              </View>
            ))}
          </React.Fragment>
        );
      })}
    </>
  );
}
