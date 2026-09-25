/**
 * Buyer protection, shown at every point a buyer commits money (product
 * detail, checkout, order detail).
 *
 * No new copy: the heading reuses the app's existing "Purchase protection ·
 * Brandthread protected" label (buyer settings), and the body is quoted
 * verbatim from the Terms of Service in content/legal.ts — the single legal
 * source of truth — so this note can never drift from what the Terms say.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { LEGAL_DOCUMENTS } from '@/content/legal';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

export const BUYER_PROTECTION_TITLE = 'Purchase protection';
export const BUYER_PROTECTION_STATUS = 'Brandthread protected';

function termsBullet(sectionTitle: string, match: string): string | null {
  const section = LEGAL_DOCUMENTS.terms.sections.find((candidate) => candidate.title === sectionTitle);
  const bullet = section?.bullets?.find((text) => text.includes(match)) ?? null;
  // Never surface an unresolved [OWNER/COUNSEL: …] drafting placeholder to buyers.
  return bullet && !bullet.includes('[') ? bullet : null;
}

/** The Terms lines the note quotes (exported for tests). */
export function buyerProtectionLines({ preorder = false }: { preorder?: boolean } = {}): string[] {
  const lines = [termsBullet('Buying on Brandthread', 'return, exchange, cancellation')];
  if (preorder) lines.push(termsBullet('Preorders and drops', 'held by Brandthread'));
  return lines.filter((line): line is string => !!line);
}

export function BuyerProtectionNote({
  preorder = false,
  compact = false,
  style,
  testID = 'buyer-protection-note',
}: {
  preorder?: boolean;
  /** Title + first line only, for tight footers. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const lines = buyerProtectionLines({ preorder });
  const terms = LEGAL_DOCUMENTS.terms;
  return (
    <View
      style={[styles.card, { borderColor: theme.border, backgroundColor: theme.cardGlass }, style]}
      testID={testID}
      accessibilityRole="summary"
    >
      <View style={styles.head}>
        <View style={[styles.icon, { backgroundColor: theme.accentDim }]}>
          <Feather name="shield" size={15} color={theme.accent} />
        </View>
        <View style={styles.headCopy}>
          <Text style={[styles.title, { color: theme.text }]}>{BUYER_PROTECTION_TITLE}</Text>
          <Text style={[styles.status, { color: theme.muted }]}>{BUYER_PROTECTION_STATUS}</Text>
        </View>
      </View>
      {(compact ? lines.slice(0, 1) : lines).map((line) => (
        <Text key={line} style={[styles.body, { color: theme.muted }]}>{line}</Text>
      ))}
      <TouchableOpacity
        onPress={() => router.push(terms.route as never)}
        accessibilityRole="link"
        accessibilityLabel={`Read the ${terms.title}`}
        activeOpacity={0.7}
        style={styles.link}
      >
        <Text style={[styles.linkText, { color: theme.accent }]}>{terms.title}</Text>
        <Feather name="chevron-right" size={14} color={theme.accent} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: RADIUS.md, padding: SP.md, gap: SP.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  headCopy: { flex: 1 },
  title: { fontFamily: FONT.semibold, fontSize: FS.sm },
  status: { fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 1 },
  body: { fontFamily: FONT.regular, fontSize: FS.xs, lineHeight: 18 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', minHeight: 44 },
  linkText: { fontFamily: FONT.semibold, fontSize: FS.xs },
});
