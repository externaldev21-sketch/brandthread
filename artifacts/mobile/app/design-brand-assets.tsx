/**
 * Brandthread Design Studio — Brand Assets Library
 * Route: /design-brand-assets
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, FlatList,
  Image, Modal, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { showAlert } from '@/lib/actionSheet';
import { friendlyError } from '@/lib/friendlyError';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import {
  BG, SURFACE, CARD, CARD_ELEVATED,
  BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE,
  RED, RED_DIM, OVERLAY,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { SearchBar, EmptyState } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Share } from 'react-native';
import {
  getBrandAssets, addBrandAsset, renameBrandAsset, deleteBrandAsset, getProjects,
} from '@/services/designService';
import { BRAND_ASSET_TYPES } from '@/services/designTypes';
import { useSellerTabBarInset } from '@/hooks/useSellerTabBarInset';
import type { BrandAsset, BrandAssetType } from '@/services/designTypes';
import { radius } from '@/constants/radii';
import { minHitSlop } from '@/lib/hitSlop';

// Category pills draw 34pt tall (8pt gaps → vertical-only slop); the Upload
// Asset FAB draws 39pt tall. Pad touch areas to 44pt without changing layout.
const TAB_HIT_SLOP = minHitSlop({ height: 32 }); // 34pt pill minus its 1pt border (web slop is measured from the padding box)
const FAB_HIT_SLOP = minHitSlop({ height: 39 });
import { useApi } from '@/hooks/useApi';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';

function errorText(err: unknown, fallback: string): string {
  return friendlyError(err, fallback);
}

/** Normalises "c0c0c0" / "#c0c0c0" → "#C0C0C0"; null when not a 6-digit hex. */
function normalizeBrandHex(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  const color = (t.startsWith('#') ? t : '#' + t).toUpperCase();
  return /^#[0-9A-F]{6}$/.test(color) ? color : null;
}

// In-app text prompt (Alert.prompt is iOS-only, so Brand Color / Font /
// Rename did nothing on Android and web). `onSubmit` returns an error string
// to keep the sheet open with inline feedback, or null when done.
interface TextPromptRequest {
  title: string;
  message: string;
  placeholder?: string;
  initialValue?: string;
  submitLabel: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  testID: string;
  onSubmit: (value: string) => Promise<string | null>;
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
  const tabBarInset = useSellerTabBarInset();
  const router = useRouter();
  const api = useApi();
  const [assets, setAssets] = useState<BrandAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<string>('all');
  const [prompt, setPrompt] = useState<TextPromptRequest | null>(null);

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
    showAlert('Add Brand Asset', 'Choose asset type:', [
      {
        text: 'Image / Logo / Graphic',
        onPress: async () => {
          let result: ImagePicker.ImagePickerResult;
          try {
            result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
          } catch (err) {
            showAlert('Could not open photos', friendlyError(err, 'Your photo library could not be opened. Check photo access in Settings and try again.'));
            return;
          }
          if (result.canceled || !result.assets?.[0]) return;
          const picked = result.assets[0];
          showAlert('Asset Type', 'What is this image?', [
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
          setPrompt({
            title: 'Brand Color',
            message: 'Enter a 6-digit hex color, e.g. #C0C0C0.',
            placeholder: '#C0C0C0',
            submitLabel: 'Save color',
            autoCapitalize: 'characters',
            testID: 'brand-color-prompt',
            onSubmit: async (hex) => {
              const color = normalizeBrandHex(hex);
              if (!color) return 'Enter a 6-digit hex color like #C0C0C0.';
              try {
                const newAsset = await addBrandAsset({ name: color, type: 'color', color, tags: [] });
                setAssets(prev => [newAsset, ...prev]);
                return null;
              } catch (err) {
                return errorText(err, 'Could not save this color. Please try again.');
              }
            },
          });
        },
      },
      {
        text: 'Font',
        onPress: () => {
          setPrompt({
            title: 'Font',
            message: 'Enter the font family name.',
            placeholder: 'e.g. Helvetica Neue',
            submitLabel: 'Save font',
            autoCapitalize: 'words',
            testID: 'brand-font-prompt',
            onSubmit: async (raw) => {
              const name = raw.trim();
              if (!name) return 'Enter a font name.';
              try {
                const newAsset = await addBrandAsset({ name, type: 'font', fontFamily: name, tags: [] });
                setAssets(prev => [newAsset, ...prev]);
                return null;
              } catch (err) {
                return errorText(err, 'Could not save this font. Please try again.');
              }
            },
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
      showAlert('Upload failed', errorText(err, 'Could not upload this image. Check your connection and try again.'));
    } finally {
      setUploading(false);
    }
  }

  // ── Asset long press ───────────────────────────────────────────────────────
  function handleLongPress(asset: BrandAsset) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    showAlert(asset.name, '', [
      {
        text: 'Rename',
        onPress: () => {
          setPrompt({
            title: 'Rename',
            message: 'Enter a new name for this asset.',
            initialValue: asset.name,
            submitLabel: 'Rename',
            testID: 'brand-rename-prompt',
            onSubmit: async (raw) => {
              const name = raw.trim();
              if (!name) return 'Enter a name.';
              try {
                await renameBrandAsset(asset.id, name);
                setAssets(prev => prev.map(a => a.id === asset.id ? { ...a, name } : a));
                return null;
              } catch (err) {
                return errorText(err, 'Could not rename this asset. Please try again.');
              }
            },
          });
        },
      },
      {
        text: 'Add to Project',
        onPress: async () => {
          let projects;
          try {
            projects = await getProjects();
          } catch (err) {
            showAlert('Could not load projects', errorText(err, 'Your design projects could not be loaded. Please try again.'));
            return;
          }
          if (projects.length === 0) {
            showAlert('No Projects', 'Create a design project first to add assets.', [
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
          showAlert('Add to Project', 'Choose a design project:', buttons);
        },
      },
      {
        text: 'Share',
        onPress: async () => {
          const uri = (asset as any).uri ?? (asset as any).thumbnailUrl ?? '';
          try {
            await Share.share({ message: asset.name, url: uri });
          } catch {
            showAlert('Share', 'Could not share this asset.');
          }
        },
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          showAlert('Delete Asset', `Delete "${asset.name}"?`, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete', style: 'destructive',
              onPress: async () => {
                try {
                  await deleteBrandAsset(asset.id);
                  setAssets(prev => prev.filter(a => a.id !== asset.id));
                } catch (err) {
                  showAlert('Could not delete', errorText(err, 'Please try again.'));
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
        onPress={() => handleLongPress(item)}
        onLongPress={() => handleLongPress(item)}
        activeOpacity={0.8}
        delayLongPress={400}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${item.type.replace('_', ' ')}`}
        accessibilityHint="Opens asset options"
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
            <Icon name={assetTypeIcon(item.type)} size={ICON.lg} color={PURPLE_LIGHT} />
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
        {[{ key: 'all', label: 'All' }, ...BRAND_ASSET_TYPES].map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[bas.tab, activeTab === tab.key && bas.tabActive]}
            hitSlop={TAB_HIT_SLOP}
            onPress={() => { Haptics.selectionAsync(); setActiveTab(tab.key); }}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: activeTab === tab.key }}
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
          {assets.length > 0 ? (
            <EmptyState
              icon="search"
              title="No matching assets"
              description="Nothing matches this search or filter."
              action={{ label: 'Show all assets', onPress: () => { setSearch(''); setActiveTab('all'); } }}
            />
          ) : (
            <EmptyState
              icon="star"
              title="No assets yet"
              description="Save logos, colors, graphics, and reusable assets."
              action={{ label: 'Add your first asset', onPress: handleAddAsset, icon: 'plus' }}
            />
          )}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          numColumns={2}
          contentContainerStyle={[bas.gridContent, { paddingBottom: insets.bottom + 80 + tabBarInset }]}
          columnWrapperStyle={bas.columnWrapper}
          showsVerticalScrollIndicator={false}
          renderItem={renderAsset}
        />
      )}

      {/* ── FAB ── (hidden while the empty state's own add button is showing,
          so there's one primary add action; lifted above the seller tab bar) */}
      {!loading && filtered.length > 0 && (
        <TouchableOpacity
          style={[bas.fab, { bottom: (tabBarInset || insets.bottom) + SP.lg }]}
          onPress={handleAddAsset}
          disabled={uploading}
          activeOpacity={0.85}
          hitSlop={FAB_HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Upload asset"
        >
          <Icon name="upload" size={ICON.md} color={theme.onAccent} />
          <Text style={bas.fabText}>{uploading ? 'Uploading…' : 'Upload asset'}</Text>
        </TouchableOpacity>
      )}

      <TextPromptModal request={prompt} onClose={() => setPrompt(null)} />
    </View>
  );
}

// ─── Text prompt modal ─────────────────────────────────────────────────────────
function TextPromptModal({ request, onClose }: { request: TextPromptRequest | null; onClose: () => void }) {
  const { theme } = useAppTheme();
  const ps = createPromptStyles(theme);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue(request?.initialValue ?? '');
    setError(null);
    setBusy(false);
  }, [request]);

  async function submit() {
    if (!request || busy) return;
    setBusy(true);
    const err = await request.onSubmit(value);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <Modal visible={!!request} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={ps.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        {request && (
          <View style={ps.card} testID={request.testID}>
            <Text style={ps.title}>{request.title}</Text>
            <Text style={ps.message}>{request.message}</Text>
            <TextInput
              style={ps.input}
              value={value}
              onChangeText={t => { setValue(t); if (error) setError(null); }}
              placeholder={request.placeholder}
              placeholderTextColor={SUBTLE}
              autoCapitalize={request.autoCapitalize ?? 'sentences'}
              autoCorrect={false}
              autoFocus
              onSubmitEditing={submit}
              returnKeyType="done"
              accessibilityLabel={request.title}
              testID={`${request.testID}-input`}
            />
            {error && <Text style={ps.error} accessibilityLiveRegion="polite">{error}</Text>}
            <View style={ps.actions}>
              <TouchableOpacity style={ps.btn} onPress={onClose} accessibilityRole="button" testID={`${request.testID}-cancel`}>
                <Text style={ps.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[ps.btn, ps.primary]}
                onPress={submit}
                disabled={busy}
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                testID={`${request.testID}-submit`}
              >
                {busy ? <ActivityIndicator size="small" color={theme.onAccent} /> : <Text style={ps.primaryText}>{request.submitLabel}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const createPromptStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: OVERLAY, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.md },
  card:        { width: '100%', maxWidth: 360, backgroundColor: SURFACE, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, padding: SP.md, gap: SP.sm },
  title:       { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  message:     { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  input:       { minHeight: 44, borderRadius: radius.sm, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD, color: FG, paddingHorizontal: SP.sm, fontSize: FS.base, fontFamily: FONT.regular },
  error:       { fontSize: FS.xs, fontFamily: FONT.medium, color: RED },
  actions:     { flexDirection: 'row', justifyContent: 'flex-end', gap: SP.sm, marginTop: SP.xs },
  btn:         { minHeight: 44, minWidth: 88, paddingHorizontal: SP.md, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  primary:     { backgroundColor: theme.accent },
  cancelText:  { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
  primaryText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.onAccent },
});

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

function assetTypeIcon(type: BrandAssetType): IconName {
  const map: Record<BrandAssetType, IconName> = {
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

  // 5pt top padding offset by a -5 margin: the row doesn't move, but the
  // (clipping) ScrollView has room for the pills' 44pt touch areas.
  tabsScroll:    { flexGrow: 0, marginTop: -5 },
  tabsContent:   { paddingHorizontal: SP.md, gap: SP.xs, paddingBottom: SP.sm, paddingTop: 5 },
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
