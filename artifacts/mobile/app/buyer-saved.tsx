import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Alert, StyleSheet, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE, ON_DARK,

  FONT, FS, SP, RADIUS, COMP, ICON,
} from '@/lib/theme';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import { getSavedItems, removeSavedItem, subscribeSocial } from '@/services/socialService';
import { SavedItem, SavedItemType } from '@/services/socialTypes';
import { reportNetworkError } from '@/lib/networkNotice';

const { width: W } = Dimensions.get('window');
const TILE_SIZE = (W - SP.md * 2 - SP.sm) / 2;

const TABS: { key: SavedItemType; label: string; icon: string }[] = [
  { key: 'post', label: 'Posts', icon: 'bookmark' },
  { key: 'product', label: 'Products', icon: 'shopping-bag' },
  { key: 'collection', label: 'Collections', icon: 'folder' },
  { key: 'store', label: 'Stores', icon: 'home' },
];

export default function BuyerSaved() {
  const { theme } = useAppTheme();
  const PURPLE = theme.accent;
  const PURPLE_DIM = theme.accentDim;
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<SavedItem[]>([]);
  const [activeTab, setActiveTab] = useState<SavedItemType>('post');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  async function loadData() {
    setLoadError(false);
    try {
      setItems(await getSavedItems());
    } catch (error) {
      setLoadError(true);
      reportNetworkError(error, loadData);
    } finally {
      setLoading(false);
    }
  }

  useFocusEffect(useCallback(() => { loadData(); }, []));

  useEffect(() => {
    const unsub = subscribeSocial(() => loadData());
    return unsub;
  }, []);

  const filtered = items.filter(i => i.type === activeTab);
  const activeTabDef = TABS.find(t => t.key === activeTab)!;

  function emptyTitle(): string {
    switch (activeTab) {
      case 'post': return 'No saved posts yet';
      case 'product': return 'No saved products yet';
      case 'collection': return 'No saved collections yet';
      case 'store': return 'No saved stores yet';
    }
  }

  function emptyDesc(): string {
    switch (activeTab) {
      case 'post': return 'Tap the bookmark icon on any post to save it here.';
      case 'product': return 'Save products you love and come back to them anytime.';
      case 'collection': return 'Save collections from your favorite brands.';
      case 'store': return 'Follow stores to save them and get updates.';
    }
  }

  function handleItemPress(item: SavedItem) {
    Alert.alert(
      'Saved Item',
      item.title,
      [
        { text: 'View', onPress: () => {} },
        {
          text: 'Remove from saved',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeSavedItem(item.targetId);
              await loadData();
            } catch {
              Alert.alert('Could not remove saved item', 'Try again.');
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  function renderTile({ item }: { item: SavedItem }) {
    return (
      <TouchableOpacity
        style={styles.tile}
        onPress={() => handleItemPress(item)}
        onLongPress={() => handleItemPress(item)}
        activeOpacity={0.85}
      >
        <LinearGradient
          colors={[item.accentColor || PURPLE, BG]}
          style={styles.tileGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <View style={styles.tileTop}>
            <Feather
              name={activeTabDef.icon as any}
              size={20}
              color="white"
              style={{ opacity: 0.7 }}
            />
          </View>
          <View style={styles.tileBottom}>
            <Text style={styles.tileTitle} numberOfLines={2}>{item.title}</Text>
            {item.subtitle ? (
              <Text style={styles.tileSubtitle} numberOfLines={1}>{item.subtitle}</Text>
            ) : null}
          </View>
        </LinearGradient>
      </TouchableOpacity>
    );
  }

  function renderRow({ item }: { item: SavedItem }) {
    return (
      <TouchableOpacity
        style={styles.listRow}
        onPress={() => handleItemPress(item)}
        onLongPress={() => handleItemPress(item)}
        activeOpacity={0.7}
      >
        <View style={[styles.rowIcon, { backgroundColor: item.accentColor || PURPLE }]}>
          <Feather name={activeTabDef.icon as any} size={ICON.md} color="white" />
        </View>
        <View style={styles.rowContent}>
          <Text style={styles.rowTitle}>{item.title}</Text>
          {item.subtitle ? <Text style={styles.rowSubtitle}>{item.subtitle}</Text> : null}
        </View>
        <Feather name="chevron-right" size={ICON.md} color={SUBTLE} />
      </TouchableOpacity>
    );
  }

  const isGrid = activeTab === 'post' || activeTab === 'product';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="arrow-left" size={ICON.lg} color={FG} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Saved</Text>
        <View style={styles.headerBtn}>
          <Feather name="bookmark" size={ICON.md} color={MUTED} />
        </View>
      </View>

      {/* TAB BAR */}
      <View>
        <FlatList
          data={TABS}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={t => t.key}
          contentContainerStyle={styles.tabBar}
          renderItem={({ item: tab }) => (
            <TouchableOpacity
              style={[styles.tab, activeTab === tab.key && styles.tabActive]}
              onPress={() => setActiveTab(tab.key)}
              activeOpacity={0.7}
            >
              <Feather
                name={tab.icon as any}
                size={ICON.sm}
                color={activeTab === tab.key ? PURPLE : MUTED}
              />
              <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {/* CONTENT */}
       {loading ? <View style={styles.emptyContainer}><Text style={styles.emptyDesc}>Loading saved items…</Text></View> : loadError ? <View style={styles.emptyContainer}><Text style={styles.emptyTitle}>Couldn't load saved items</Text><TouchableOpacity onPress={loadData}><Text style={[styles.emptyDesc, { color: PURPLE }]}>Try again</Text></TouchableOpacity></View> : filtered.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Feather name={activeTabDef.icon as any} size={48} color={MUTED} />
          <Text style={styles.emptyTitle}>{emptyTitle()}</Text>
          <Text style={styles.emptyDesc}>{emptyDesc()}</Text>
          <TouchableOpacity
            onPress={() => router.push('/(buyer)/discover')}
            activeOpacity={0.85}
            style={styles.discoverBtnWrap}
          >
            <LinearGradient
              colors={theme.primaryGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.discoverBtn}
            >
              <Text style={[styles.discoverBtnText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Discover</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      ) : isGrid ? (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          numColumns={2}
          columnWrapperStyle={{ gap: SP.sm }}
          contentContainerStyle={styles.gridContent}
          renderItem={renderTile}
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={renderRow}
        />
      )}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
  },
  headerBtn: {
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: FS.md,
    fontFamily: FONT.bold,
    color: FG,
  },
  tabBar: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    gap: SP.sm,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    paddingHorizontal: SP.md,
    paddingVertical: SP.xs + 2,
    borderRadius: RADIUS.pill,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },
  tabActive: {
    backgroundColor: theme.accentDim,
    borderColor: theme.accent,
  },
  tabText: {
    color: MUTED,
    fontFamily: FONT.medium,
    fontSize: FS.sm,
  },
  tabTextActive: {
    color: theme.accent,
    fontFamily: FONT.semibold,
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: SP.xxl,
    paddingHorizontal: SP.lg,
  },
  emptyTitle: {
    color: FG,
    fontFamily: FONT.semibold,
    fontSize: FS.md,
    marginTop: SP.md,
    textAlign: 'center',
  },
  emptyDesc: {
    color: MUTED,
    fontSize: FS.sm,
    textAlign: 'center',
    marginTop: SP.sm,
  },
  discoverBtnWrap: {
    marginTop: SP.lg,
  },
  discoverBtn: {
    height: COMP.buttonH,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discoverBtnText: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
  },
  gridContent: {
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
    gap: SP.sm,
    paddingBottom: SP.xxl,
  },
  tile: {
    width: TILE_SIZE,
    aspectRatio: 1,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: BORDER,
  },
  tileGradient: {
    flex: 1,
    padding: SP.sm,
    justifyContent: 'space-between',
  },
  tileTop: {
    alignItems: 'flex-start',
  },
  tileBottom: {
    gap: 2,
  },
  tileTitle: {
    color: ON_DARK,
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
  },
  tileSubtitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: FS.xs,
  },
  listContent: {
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
    gap: SP.sm,
    paddingBottom: SP.xxl,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS.md,
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
  },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowContent: {
    flex: 1,
    marginLeft: SP.md,
  },
  rowTitle: {
    color: FG,
    fontFamily: FONT.semibold,
    fontSize: FS.base,
  },
  rowSubtitle: {
    color: MUTED,
    fontSize: FS.sm,
    marginTop: 2,
  },
});
