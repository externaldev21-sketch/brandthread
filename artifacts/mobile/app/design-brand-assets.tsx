/**
 * Brandthread Design Studio — Brand Assets Library
 * Route: /design-brand-assets
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, FlatList,
  Alert, Image, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import {
  BG, SURFACE, CARD, CARD_ELEVATED,
  BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE,
  RED, RED_DIM,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { SearchBar, EmptyState } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Share } from 'react-native';
import {
  getBrandAssets, addBrandAsset, renameBrandAsset, deleteBrandAsset, getProjects,
} from '@/services/designService';
import { BRAND_ASSET_TYPES } from '@/services/designTypes';
import type { BrandAsset, BrandAssetType } from '@/services/designTypes';
import { radius } from '@/constants/radii';
import { useApi } from '@/hooks/useApi';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

export default function DesignBrandAssetsScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentDim: PURPLE_DIM, accentLight: PURPLE_LIGHT, secondary: CYAN, secondaryDim: CYAN_DIM } = theme;
  const bas = createStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const [assets, setAssets] = useState<BrandAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<string>('all');

  // ── Load assets ────────────────────────────────────────────────────────────
  const [loadError, setLoadError] = useState<string | null>(null);
  async function loadAssets() {
    setLoading(true);
    setLoadError(null);
    try {
      const all = await getBrandAssets();
      setAssets(all);
    } catch (err) {
      setLoadError(errorText(err, 'Could not load your brand assets. Check your connection and try again.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAssets(); }, []);

  // ── Filter ─────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const tabType = BRAND_ASSET_TYPES.find(t => t.key === activeTab)?.type;
    return assets.filter(a => {
      const matchType = activeTab === 'all' || a.type === tabType;
      const matchSearch = !search.trim() || a.name.toLowerCase().includes(search.toLowerCase());
      return matchType && matchSearch;
    });
  }, [assets, activeTab, search]);

  // ── Add asset ──────────────────────────────────────────────────────────────
  async function handleAddAsset() {
    Alert.alert('Add Brand Asset', 'Choose asset type:', [
      {
        text: 'Image / Logo / Graphic',
        onPress: async () => {
          const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
          if (result.canceled || !result.assets?.[0]) return;
          const picked = result.assets[0];
          Alert.alert('Asset Type', 'What is this image?', [
            { text: 'Logo',    onPress: () => saveImageAsset(picked, 'logo') },
            { text: 'Icon',    onPress: () => saveImageAsset(picked, 'icon') },
            { text: 'Graphic', onPress: () => saveImageAsset(picked, 'graphic') },
            { text: 'Photo',   onPress: () => saveImageAsset(picked, 'photo') },
            { text: 'Mockup',  onPress: () => saveImageAsset(picked, 'mockup') },
            { text: 'Cancel',  style: 'cancel' },
          ]);
        },
      },
      {
        text: 'Brand Color',
        onPress: () => {
          Alert.prompt('Brand Color', 'Enter hex color (e.g. #0EA5E9):', async (hex) => {
            if (!hex?.trim()) return;
            const color = (hex.trim().startsWith('#') ? hex.trim() : '#' + hex.trim()).toUpperCase();
            if (!/^#[0-9A-F]{6}$/.test(color)) {
              Alert.alert('Invalid color', 'Enter a 6-digit hex color like #0EA5E9.');
              return;
            }
            try {
              const newAsset = await addBrandAsset({ name: color, type: 'color', color, tags: [] });
              setAssets(prev => [newAsset, ...prev]);
            } catch (err) {
              Alert.alert('Could not save color', errorText(err, 'Please try again.'));
            }
          });
        },
      },
      {
        text: 'Font',
        onPress: () => {
          Alert.prompt('Font Name', 'Enter font family name:', async (name) => {
            if (!name?.trim()) return;
            try {
              const newAsset = await addBrandAsset({ name: name.trim(), type: 'font', fontFamily: name.trim(), tags: [] });
              setAssets(prev => [newAsset, ...prev]);
            } catch (err) {
              Alert.alert('Could not save font', errorText(err, 'Please try again.'));
            }
          });
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  const [uploading, setUploading] = useState(false);
  async function saveImageAsset(picked: { uri: string; mimeType?: string | null }, type: BrandAssetType) {
    const name = type.charAt(0).toUpperCase() + type.slice(1) + ' ' + (assets.length + 1);
    setUploading(true);
    try {
      // Real sellers: upload the bytes to storage first and save only the
      // stored object path — a file:// URI is useless on any other device.
      // The signed-out preview / demo keeps the local-only library.
      const local = isSellerDevPreview() || isPreviewDemoMode();
      const newAsset = local
        ? await addBrandAsset({ name, type, uri: picked.uri, tags: [] })
        : await addBrandAsset({ name, type, objectPath: (await api.products.uploadImage(picked)).objectPath, tags: [] });
      setAssets(prev => [newAsset, ...prev]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert('Upload failed', errorText(err, 'Could not upload this image. Check your connection and try again.'));
    } finally {
      setUploading(false);
    }
  }

  // ── Asset long press ───────────────────────────────────────────────────────
  function handleLongPress(asset: BrandAsset) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(asset.name, '', [
      {
        text: 'Rename',
        onPress: () => {
          Alert.prompt('Rename', 'New name:', async (name) => {
            if (!name?.trim()) return;
            try {
              await renameBrandAsset(asset.id, name.trim());
              setAssets(prev => prev.map(a => a.id === asset.id ? { ...a, name: name.trim() } : a));
            } catch (err) {
              Alert.alert('Could not rename', errorText(err, 'Please try again.'));
            }
          }, 'plain-text', asset.name);
        },
      },
      {
        text: 'Add to Project',
        onPress: async () => {
          const projects = await getProjects();
          if (projects.length === 0) {
            Alert.alert('No Projects', 'Create a design project first to add assets.', [
              { text: 'Go to Design Studio', onPress: () => router.push('/design' as never) },
              { text: 'Cancel', style: 'cancel' },
            ]);
            return;
          }
          const buttons: any[] = projects.slice(0, 7).map(p => ({
            text: p.name,
            onPress: () => router.push((`/design-canvas?id=${p.id}&addAssetId=${asset.id}`) as never),
          }));
          buttons.push({ text: 'Cancel', style: 'cancel' });
          Alert.alert('Add to Project', 'Choose a design project:', buttons);
        },
      },
      {
        text: 'Download',
        onPress: async () => {
          const uri = (asset as any).uri ?? (asset as any).thumbnailUrl ?? '';
          try {
            await Share.share({ message: asset.name, url: uri });
          } catch {
            Alert.alert('Download', 'Could not share this asset.');
          }
        },
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          Alert.alert('Delete Asset', `Delete "${asset.name}"?`, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete', style: 'destructive',
              onPress: async () => {
                try {
                  await deleteBrandAsset(asset.id);
                  setAssets(prev => prev.filter(a => a.id !== asset.id));
                } catch (err) {
                  Alert.alert('Could not delete', errorText(err, 'Please try again.'));
                }
              },
            },
          ]);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  // ── Render asset card ──────────────────────────────────────────────────────
  function renderAsset({ item }: { item: BrandAsset }) {
    return (
      <TouchableOpacity
        style={bas.assetCard}
        onLongPress={() => handleLongPress(item)}
        activeOpacity={0.8}
        delayLongPress={400}
      >
        {/* Thumbnail */}
        {item.type === 'color' && item.color ? (
          <View style={[bas.colorThumb, { backgroundColor: item.color }]}>
            <Text style={[bas.colorHex, { color: isLightColor(item.color) ? '#111' : '#fff' }]}>
              {item.color.toUpperCase()}
            </Text>
          </View>
        ) : item.uri ? (
          <Image source={{ uri: item.uri }} style={bas.imageThumb} resizeMode="cover" />
        ) : item.type === 'font' ? (
          <View style={bas.fontThumb}>
            <Text style={[bas.fontPreview, { fontFamily: item.fontFamily ?? 'System' }]}>Aa</Text>
          </View>
        ) : (
          <View style={bas.placeholderThumb}>
            <Feather name={assetTypeIcon(item.type)} size={ICON.lg} color={PURPLE_LIGHT} />
          </View>
        )}

        {/* Info */}
        <View style={bas.cardInfo}>
          <Text style={bas.assetName} numberOfLines={1}>{item.name}</Text>
          <Text style={bas.assetType}>{item.type.replace('_', ' ')}</Text>
          <Text style={bas.assetDate}>{formatDate(item.createdAt)}</Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={bas.root}>
      <ScreenHeader
        title="Brand Assets"
        actions={[{ icon: 'plus', onPress: handleAddAsset, accessibilityLabel: 'Add asset' }]}
      />

      {/* ── SEARCH ── */}
      <View style={bas.searchWrap}>
        <SearchBar value={search} onChange={setSearch} placeholder="Search assets…" />
      </View>

      {/* ── CATEGORY TABS ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={bas.tabsScroll} contentContainerStyle={bas.tabsContent}>
        {BRAND_ASSET_TYPES.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[bas.tab, activeTab === tab.key && bas.tabActive]}
            onPress={() => { Haptics.selectionAsync(); setActiveTab(tab.key); }}
          >
            <Text style={[bas.tabText, activeTab === tab.key && { color: PURPLE_LIGHT }]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── ASSET GRID ── */}
      {loading ? (
        <View style={bas.loadingWrap}>
          <Text style={{ color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm }}>Loading assets…</Text>
        </View>
      ) : loadError ? (
        <View style={{ flex: 1 }}>
          <EmptyState
            icon="alert-circle"
            title="Couldn't load assets"
            description={loadError}
            action={{ label: 'Try again', onPress: () => { void loadAssets(); }, icon: 'refresh-cw' }}
          />
        </View>
      ) : filtered.length === 0 ? (
        <View style={{ flex: 1 }}>
          <EmptyState
            icon="star"
            title="No assets yet"
            description="Save logos, colors, graphics, and reusable assets."
            action={{ label: 'Add Your First Asset', onPress: handleAddAsset, icon: 'plus' }}
          />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          numColumns={2}
          contentContainerStyle={[bas.gridContent, { paddingBottom: insets.bottom + 80 }]}
          columnWrapperStyle={bas.columnWrapper}
          showsVerticalScrollIndicator={false}
          renderItem={renderAsset}
        />
      )}

      {/* ── FAB ── */}
      <TouchableOpacity
        style={[bas.fab, { bottom: insets.bottom + SP.lg }]}
        onPress={handleAddAsset}
        activeOpacity={0.85}
        disabled={uploading}
      >
        <Feather name="upload" size={ICON.md} color={theme.onAccent} />
        <Text style={bas.fabText}>{uploading ? 'Uploading…' : 'Upload Asset'}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function isLightColor(hex: string): boolean {
  try {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 128;
  } catch {
    return false;
  }
}

function assetTypeIcon(type: BrandAssetType): keyof typeof Feather.glyphMap {
  const map: Record<BrandAssetType, keyof typeof Feather.glyphMap> = {
    logo:       'award',
    icon:       'aperture',
    font:       'type',
    color:      'droplet',
    pattern:    'grid',
    graphic:    'image',
    photo:      'camera',
    mockup:     'layers',
    packaging:  'box',
    text_style: 'align-left',
  };
  return map[type] ?? 'file';
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const { accent: PURPLE, accentDim: PURPLE_DIM } = theme;
  return StyleSheet.create({
  root:          { flex: 1, backgroundColor: 'transparent' },
  searchWrap:    { paddingHorizontal: SP.md, paddingVertical: SP.sm },

  tabsScroll:    { flexGrow: 0 },
  tabsContent:   { paddingHorizontal: SP.md, gap: SP.xs, paddingBottom: SP.sm },
  tab:           { paddingHorizontal: SP.md, paddingVertical: 8, borderRadius: radius.sm, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  tabActive:     { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE },
  tabText:       { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },

  loadingWrap:   { flex: 1, alignItems: 'center', justifyContent: 'center' },

  gridContent:   { paddingHorizontal: SP.md, paddingTop: SP.sm },
  columnWrapper: { gap: SP.sm, marginBottom: SP.sm },

  assetCard:     { flex: 1, backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },

  colorThumb:    { width: '100%', aspectRatio: 1.2, alignItems: 'center', justifyContent: 'center' },
  colorHex:      { fontSize: FS.xs, fontFamily: FONT.bold, letterSpacing: 0.5 },

  imageThumb:    { width: '100%', aspectRatio: 1.2, backgroundColor: CARD_ELEVATED },

  fontThumb:     { width: '100%', aspectRatio: 1.2, backgroundColor: CARD_ELEVATED, alignItems: 'center', justifyContent: 'center' },
  fontPreview:   { fontSize: FS.h2, color: FG },

  placeholderThumb: { width: '100%', aspectRatio: 1.2, backgroundColor: PURPLE_DIM, alignItems: 'center', justifyContent: 'center' },

  cardInfo:      { padding: SP.sm, gap: 2 },
  assetName:     { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  assetType:     { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, textTransform: 'capitalize' },
  assetDate:     { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },

  fab:           { position: 'absolute', right: SP.md, flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: PURPLE, borderRadius: radius.sm, paddingHorizontal: SP.md, paddingVertical: SP.sm },
  fabText:       { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.onAccent },
  });
};
