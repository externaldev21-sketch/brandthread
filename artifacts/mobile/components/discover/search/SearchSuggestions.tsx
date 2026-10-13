/**
 * As-you-type suggestions in the Discover search overlay — TikTok's typing
 * step (Mobbin flow "Searching TikTok", screen 2): the typed query first as
 * a search row, matching text bolded, an ↖ arrow that fills a term into the
 * bar. Brandthread groups the matches into Brands / People / Products /
 * Hashtags (up to three each) instead of TikTok's flat query list, since
 * our index returns entities rather than query completions.
 */
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { CachedImage } from '@/components/CachedImage';
import { hapticSelection } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING, SCREEN_GUTTER } from '@/constants/spacing';
import { RADII, radius } from '@/constants/radii';
import { highlightParts } from '@/lib/discoverSearch';

export interface SuggestionRow {
  key: string;
  title: string;
  subtitle?: string;
  imageUri?: string | null;
  initials?: string;
  icon?: keyof typeof Feather.glyphMap;
  /** Square photo (products) instead of a round avatar. */
  square?: boolean;
  onPress: () => void;
  /** ↖ — put this term in the bar without submitting. */
  onFill?: () => void;
}

export interface SuggestionSection { key: string; title: string; rows: SuggestionRow[] }

function Highlighted({ text, query, style, boldStyle }: { text: string; query: string; style: object; boldStyle: object }) {
  return (
    <Text style={style} numberOfLines={1}>
      {highlightParts(text, query).map((part, i) => (
        <Text key={i} style={part.match ? boldStyle : undefined}>{part.text}</Text>
      ))}
    </Text>
  );
}

export function SearchSuggestions({
  query,
  sections,
  searching,
  onSubmitQuery,
}: {
  query: string;
  sections: SuggestionSection[];
  searching: boolean;
  onSubmitQuery: () => void;
}) {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const q = query.trim();

  const renderRow = (row: SuggestionRow) => (
    <View key={row.key} style={styles.row}>
      <Pressable
        style={styles.tap}
        onPress={() => { hapticSelection(); row.onPress(); }}
        accessibilityRole="button"
        accessibilityLabel={row.subtitle ? `${row.title}, ${row.subtitle}` : row.title}
      >
        {row.imageUri ? (
          <CachedImage source={{ uri: row.imageUri }} style={[styles.lead, row.square && styles.leadSquare]} contentFit="cover" />
        ) : row.initials ? (
          <View style={[styles.lead, styles.leadFallback]}>
            <Text style={styles.initials}>{row.initials}</Text>
          </View>
        ) : (
          <View style={[styles.lead, styles.leadIcon, row.square && styles.leadSquare]}>
            <Feather name={row.icon ?? 'search'} size={16} color={theme.muted} />
          </View>
        )}
        <View style={styles.text}>
          <Highlighted text={row.title} query={q} style={styles.title} boldStyle={styles.titleBold} />
          {row.subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{row.subtitle}</Text> : null}
        </View>
      </Pressable>
      {row.onFill && (
        <Pressable
          onPress={() => { hapticSelection(); row.onFill?.(); }}
          accessibilityRole="button"
          accessibilityLabel={`Use ${row.title}`}
          hitSlop={12}
          style={styles.fill}
        >
          <Feather name="arrow-up-left" size={18} color={theme.muted} />
        </Pressable>
      )}
    </View>
  );

  return (
    <View testID="buyer-search-suggestions">
      {renderRow({ key: 'q', title: q, icon: 'search', onPress: onSubmitQuery })}
      {sections.filter((s) => s.rows.length > 0).map((section) => (
        <View key={section.key}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          {section.rows.map(renderRow)}
        </View>
      ))}
      {searching && sections.every((s) => s.rows.length === 0) && (
        <ActivityIndicator style={{ marginTop: SPACING.md }} color={theme.muted} />
      )}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SCREEN_GUTTER, minHeight: 52 },
  tap: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minHeight: 52 },
  lead: { width: 36, height: 36, borderRadius: RADII.avatar, backgroundColor: theme.surface },
  leadSquare: { borderRadius: radius.sm },
  leadIcon: { alignItems: 'center', justifyContent: 'center' },
  leadFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.border },
  initials: { ...TYPE_SCALE.caption, fontFamily: FONT.bold, color: theme.text },
  text: { flex: 1, minWidth: 0 },
  title: { ...TYPE_SCALE.body, color: theme.text },
  titleBold: { fontFamily: FONT.bold },
  subtitle: { ...TYPE_SCALE.footnote, color: theme.muted },
  fill: { paddingLeft: SPACING.sm, minHeight: 44, justifyContent: 'center' },
  sectionTitle: {
    ...TYPE_SCALE.footnote, fontFamily: FONT.semibold, color: theme.muted,
    paddingHorizontal: SCREEN_GUTTER, paddingTop: SPACING.sm, paddingBottom: SPACING.xxs,
  },
});
