/**
 * Brandthread — Seller Drafts
 *
 * Full-screen list for sellers with more in-progress product drafts than fit
 * in the Products tab preview strip.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import {
  BG, BORDER, CARD, FG, MUTED, ORANGE, RED, SUBTLE, SUCCESS,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { EmptyState, SearchBar } from '@/components/BrandthreadUI';
import { deleteDraft, listDrafts } from '@/services/productService';
import { ProductDraft } from '@/services/productTypes';

type DraftSort = 'lastSaved' | 'name';

function formatSavedDate(value?: string): string {
  if (!value) return 'Not saved yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not saved yet';
  return `Saved ${date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;
}

function DraftRow({
  draft,
  onResume,
  onDiscard,
}: {
  draft: ProductDraft;
  onResume: () => void;
  onDiscard: () => void;
}) {
  const colors = useColors();
  const styles = createStyles(colors);
  const step = Math.min(Math.max(draft.currentStep ?? 1, 1), 10);
  const name = draft.name?.trim() || 'Untitled product';

  return (
    <View style={styles.row}>
      <View style={styles.rowHeading}>
        <View style={styles.draftIcon}>
          <Feather name="edit-3" size={ICON.sm} color={ORANGE} />
        </View>
        <View style={styles.rowTitleWrap}>
          <Text style={styles.rowTitle} numberOfLines={1}>{name}</Text>
          <Text style={styles.rowDate}>{formatSavedDate(draft.lastSavedAt)}</Text>
        </View>
        <Text style={styles.stepLabel}>Step {step}/10</Text>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${step * 10}%` }]} />
      </View>

      <View style={styles.rowActions}>
        <TouchableOpacity
          style={styles.resumeButton}
          onPress={onResume}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={`Resume ${name}`}
        >
          <Feather name="play" size={13} color={BG} />
          <Text style={styles.resumeLabel}>Resume</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.discardButton}
          onPress={onDiscard}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={`Discard ${name}`}
        >
          <Feather name="trash-2" size={13} color={RED} />
          <Text style={styles.discardLabel}>Discard</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function DraftsScreen() {
  const colors = useColors();
  const styles = createStyles(colors);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [drafts, setDrafts] = useState<ProductDraft[]>([]);
  const [sort, setSort] = useState<DraftSort>('lastSaved');
  const [filterQuery, setFilterQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const loadDrafts = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listDrafts();
      setDrafts(Array.isArray(rows) ? rows : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    loadDrafts();
  }, [loadDrafts]));

  const visibleDrafts = useMemo(() => {
    const query = filterQuery.trim().toLocaleLowerCase();
    const filtered = query
      ? drafts.filter(draft => (draft.name || 'Untitled product').toLocaleLowerCase().includes(query))
      : drafts;

    return [...filtered].sort((a, b) => {
      if (sort === 'name') {
        const nameA = (a.name || 'Untitled product').trim().toLocaleLowerCase();
        const nameB = (b.name || 'Untitled product').trim().toLocaleLowerCase();
        return nameA.localeCompare(nameB) || b.lastSavedAt.localeCompare(a.lastSavedAt);
      }
      return b.lastSavedAt.localeCompare(a.lastSavedAt);
    });
  }, [drafts, filterQuery, sort]);

  const discardDraft = useCallback((draft: ProductDraft) => {
    const name = draft.name?.trim() || 'Untitled product';
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Discard draft?',
      `"${name}" will be permanently deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: async () => {
            await deleteDraft(draft.id);
            setDrafts(current => current.filter(item => item.id !== draft.id));
          },
        },
      ],
    );
  }, []);

  const renderDraft = useCallback(({ item }: { item: ProductDraft }) => (
    <DraftRow
      draft={item}
      onResume={() => router.push(('/add-product?editId=' + item.id) as never)}
      onDiscard={() => discardDraft(item)}
    />
  ), [discardDraft, router]);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + SP.sm }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Back to products"
        >
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>In-progress drafts</Text>
          <Text style={styles.headerSubtitle}>
            {filterQuery.trim()
              ? `${visibleDrafts.length} of ${drafts.length} drafts`
              : `${drafts.length} draft${drafts.length === 1 ? '' : 's'}`}
          </Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.controlsSection}>
        <Text style={styles.controlLabel}>Filter drafts</Text>
        <SearchBar
          value={filterQuery}
          onChange={setFilterQuery}
          placeholder="Filter by product name"
        />

        <Text style={[styles.controlLabel, styles.sortLabel]}>Sort by</Text>
        <View style={styles.sortOptions}>
          <TouchableOpacity
            style={[styles.sortOption, sort === 'lastSaved' && styles.sortOptionActive]}
            onPress={() => setSort('lastSaved')}
            activeOpacity={0.75}
            accessibilityRole="radio"
            accessibilityState={{ selected: sort === 'lastSaved' }}
          >
            <Feather name="clock" size={14} color={sort === 'lastSaved' ? colors.accentForeground : MUTED} />
            <Text style={[styles.sortOptionLabel, sort === 'lastSaved' && styles.sortOptionLabelActive]}>
              Last saved
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sortOption, sort === 'name' && styles.sortOptionActive]}
            onPress={() => setSort('name')}
            activeOpacity={0.75}
            accessibilityRole="radio"
            accessibilityState={{ selected: sort === 'name' }}
          >
            <Feather name="type" size={14} color={sort === 'name' ? colors.accentForeground : MUTED} />
            <Text style={[styles.sortOptionLabel, sort === 'name' && styles.sortOptionLabelActive]}>
              Product name
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={visibleDrafts}
        keyExtractor={item => item.id}
        renderItem={renderDraft}
        contentContainerStyle={[
          styles.listContent,
          visibleDrafts.length === 0 && styles.emptyListContent,
          { paddingBottom: insets.bottom + SP.xl },
        ]}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={styles.rowSeparator} />}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon={filterQuery.trim() ? 'search' : 'edit-3'}
              title={filterQuery.trim() ? 'No matching drafts' : 'No drafts yet'}
              description={
                filterQuery.trim()
                  ? `No drafts match “${filterQuery.trim()}”.`
                  : 'Product drafts you save while creating will appear here.'
              }
              action={filterQuery.trim()
                ? { label: 'Clear filter', icon: 'x', onPress: () => setFilterQuery('') }
                : {
                    label: 'Create product',
                    icon: 'plus',
                    onPress: () => router.push('/add-product' as never),
                  }}
            />
          )
        }
      />

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      )}
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    minHeight: 76,
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.sm,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleWrap: {
    flex: 1,
    marginLeft: SP.sm,
  },
  headerTitle: {
    fontSize: FS.lg,
    fontFamily: FONT.bold,
    color: FG,
  },
  headerSubtitle: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
    marginTop: 2,
  },
  headerSpacer: {
    width: 38,
  },
  controlsSection: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  controlLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: MUTED,
    marginBottom: SP.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  sortLabel: {
    marginTop: SP.md,
  },
  sortOptions: {
    flexDirection: 'row',
    gap: SP.sm,
  },
  sortOption: {
    flex: 1,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.xs,
    paddingHorizontal: SP.sm,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
  },
  sortOptionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.accent,
  },
  sortOptionLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: MUTED,
  },
  sortOptionLabelActive: {
    color: colors.accentForeground,
  },
  listContent: {
    paddingHorizontal: SP.md,
    paddingTop: SP.md,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  row: {
    backgroundColor: CARD,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.md,
  },
  rowHeading: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  draftIcon: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.sm,
    backgroundColor: ORANGE + '18',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SP.sm,
  },
  rowTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: FG,
  },
  rowDate: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
    marginTop: 3,
  },
  stepLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: ORANGE,
    marginLeft: SP.sm,
  },
  progressTrack: {
    height: 5,
    borderRadius: RADIUS.pill,
    backgroundColor: SUBTLE + '55',
    marginTop: SP.md,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: RADIUS.pill,
    backgroundColor: SUCCESS,
  },
  rowActions: {
    flexDirection: 'row',
    gap: SP.sm,
    marginTop: SP.md,
  },
  resumeButton: {
    flex: 1,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: RADIUS.sm,
    backgroundColor: colors.primary,
  },
  resumeLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.bold,
    color: colors.primaryForeground,
  },
  discardButton: {
    minHeight: 38,
    minWidth: 102,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: RED + '66',
    backgroundColor: RED + '12',
  },
  discardLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: RED,
  },
  rowSeparator: {
    height: SP.sm,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(7,7,15,0.6)',
  },
});