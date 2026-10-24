/**
 * Go live — the host's two steps before the show, both built from Whatnot:
 *
 *  1. Create your show — Whatnot "Creating a show" / "Schedule a Live Show"
 *     (https://mobbin.com/flows/23f4ba60-def1-48d0-8438-eb6504e2aa94,
 *     https://mobbin.com/flows/c5bfc22c-2e3b-40f2-8172-00ab1c0a0cbe):
 *     title with its character count, a thumbnail tile ("Add Photos":
 *     Upload Photo / Take Photo) and the products to pin, then Cancel / Next.
 *  2. Camera check — Whatnot's pre-show screen (same flow): the camera
 *     full-bleed, the host top-left, Flip / Mic / Shop down the right, one
 *     full-width "Start show" pill. X's Go LIVE screen
 *     (https://mobbin.com/screens/2946114c-edc3-4fd6-a75b-a86611cd2ed5) is
 *     the same pattern.
 *
 * No Agora key on the server (GET /api/live/status → LIVE_NOT_CONFIGURED):
 * the whole screen is "LIVE isn't available yet" before the seller fills
 * anything in. Broadcasting needs the native app; on web the camera check
 * still works but Start show explains that (preview `demo=1` excepted).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useUser } from '@clerk/expo';
import { API_BASE_URL, useApi } from '@/lib/api';
import { FONT, FS, MEDIA, SP } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useAgeStatus } from '@/lib/ageGate';
import { AgeRestrictedScreen } from '@/components/age/AgeNotices';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StickyFooter } from '@/components/layout/StickyFooter';
import { CachedImage } from '@/components/CachedImage';
import { showActionSheet } from '@/components/ui/ActionSheet';
import { LiveNotice } from '@/components/live/LiveNotice';
import { LiveProductsSheet } from '@/components/live/LiveProductsSheet';
import { formatCents } from '@/lib/money';
import { haptic } from '@/lib/haptics';
import { getLiveStreamProvider, isLivePreviewDemo } from '@/lib/live/liveProvider';
import { useLiveAvailability } from '@/lib/live/useLiveAvailability';
import { toLiveProductOptions } from '@/lib/liveProductOptions';
import { loadAgoraModule } from '@/lib/agoraAvailability';
import PlanUpsellModal from '@/components/PlanUpsellModal';
import { getEntitlementRejection, type EntitlementRejection } from '@/lib/entitlementError';
import { LIVE_HOST_MIN_PLAN } from '@/lib/sellerPlans';
import type { LiveProduct } from '@/lib/live/types';
import {
  LIVE_NOT_CONFIGURED_BODY, LIVE_NOT_CONFIGURED_TITLE,
  isLiveNotConfiguredError, liveStartErrorMessage,
} from '@/lib/live/liveAvailability';

const TITLE_MAX = 80;

interface CatalogProduct { id: string; name: string; priceCents?: number; imageUrl?: string | null; stock?: number | null }

function toLiveProduct(p: CatalogProduct): LiveProduct {
  return { productId: p.id, name: p.name, priceCents: p.priceCents ?? 0, imageUri: p.imageUrl ?? null, remainingUnits: p.stock ?? null };
}

export default function SellerGoLiveScreen() {
  const age = useAgeStatus();
  if (age.status !== 'ok') return <AgeRestrictedScreen title="Go live" status={age.status} onResolved={age.setBand} />;
  return <SellerGoLiveFlow />;
}

function SellerGoLiveFlow() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const api = useApi();
  const availability = useLiveAvailability();
  const launch = useLocalSearchParams<{ scheduledLiveId?: string; title?: string }>();

  const [step, setStep] = useState<'setup' | 'camera'>('setup');
  const [title, setTitle] = useState(typeof launch.title === 'string' ? launch.title : '');
  const [cover, setCover] = useState<{ localUri: string; remoteUrl: string | null; uploading: boolean } | null>(null);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [featured, setFeatured] = useState<CatalogProduct[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [notice, setNotice] = useState('');

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogFailed(false);
    const provider = getLiveStreamProvider();
    try {
      // `?bt_preview=seller&demo=1` has no API: offer the preview shows'
      // items (the same opt-in every preview dataset uses). Real accounts
      // always get their own catalog.
      if (isLivePreviewDemo()) {
        const seen = new Map<string, CatalogProduct>();
        for (const p of (await provider.listLive()).flatMap(st => st.products)) {
          if (!seen.has(p.productId)) seen.set(p.productId, { id: p.productId, name: p.name, priceCents: p.priceCents, imageUrl: p.imageUri ?? null });
        }
        setCatalog([...seen.values()]);
      } else {
        const r = await api.productBulk.list({ status: 'active' });
        setCatalog(toLiveProductOptions(r, API_BASE_URL).map(p => ({ ...p, stock: p.totalStock })));
      }
    } catch {
      // Keep what we had; opening the picker again retries.
      setCatalogFailed(true);
    } finally {
      setCatalogLoading(false);
    }
  }, [api]);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  const toggleFeaturedProduct = useCallback((productId: string) => {
    haptic('select');
    setFeatured(prev => {
      if (prev.some(p => p.id === productId)) return prev.filter(p => p.id !== productId);
      const product = catalog.find(p => p.id === productId);
      return product ? [...prev, product] : prev;
    });
  }, [catalog]);

  const uploadCover = useCallback(async (uri: string, mimeType?: string | null) => {
    setCover({ localUri: uri, remoteUrl: null, uploading: true });
    try {
      const res = await (api as any).products.uploadImage({ uri, mimeType });
      const url = res?.objectPath ?? res?.url ?? null;
      setCover({ localUri: uri, remoteUrl: url, uploading: false });
    } catch {
      setCover(null);
      setNotice("Couldn't upload that photo. Try again.");
    }
  }, [api]);

  const addThumbnail = useCallback(() => {
    showActionSheet('Add Photos', undefined, [
      {
        text: 'Upload Photo',
        onPress: async () => {
          const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1, allowsEditing: true, aspect: [3, 4] });
          if (!result.canceled && result.assets[0]) void uploadCover(result.assets[0].uri, result.assets[0].mimeType);
        },
      },
      {
        text: 'Take Photo',
        onPress: async () => {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) { setNotice('Allow camera access in Settings to take a photo.'); return; }
          const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1, allowsEditing: true, aspect: [3, 4] });
          if (!result.canceled && result.assets[0]) void uploadCover(result.assets[0].uri, result.assets[0].mimeType);
        },
      },
      ...(cover ? [{ text: 'Remove thumbnail', style: 'destructive' as const, onPress: () => setCover(null) }] : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }, [cover, uploadCover]);

  if (availability === 'unavailable') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }} testID="go-live-not-configured">
        <ScreenHeader title="Go live" backAccessibilityLabel="Close" />
        <View style={styles.center}>
          <LiveNotice title={LIVE_NOT_CONFIGURED_TITLE} body={LIVE_NOT_CONFIGURED_BODY} actionLabel="Got it" onAction={() => goBackOr(router)} />
        </View>
      </View>
    );
  }

  if (step === 'camera') {
    return (
      <CameraCheck
        title={title.trim()}
        coverUrl={cover?.remoteUrl ?? null}
        featured={featured}
        scheduledLiveId={typeof launch.scheduledLiveId === 'string' ? launch.scheduledLiveId : undefined}
        onBack={() => setStep('setup')}
      />
    );
  }

  const canNext = !!title.trim() && !cover?.uploading;
  // Why Next is disabled, shown right above it.
  const nextHint = !title.trim() ? 'Add a title to go live.' : cover?.uploading ? 'Uploading your thumbnail…' : '';
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }} testID="go-live-setup">
      <ScreenHeader title="Create your show" backAccessibilityLabel="Close" />
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Text style={[styles.h, { color: theme.text }]}>Give your show a title</Text>
        <Text style={[styles.help, { color: theme.muted }]}>The best titles are short, simple, and descriptive, so buyers know exactly what you&apos;re selling.</Text>
        <View style={[styles.field, { borderColor: theme.border }]}>
          <Text style={[styles.fieldLabel, { color: theme.muted }]}>Show title ({title.length}/{TITLE_MAX})*</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Add a title…"
            placeholderTextColor={theme.subtle}
            maxLength={TITLE_MAX}
            style={[styles.fieldInput, { color: theme.text }]}
            accessibilityLabel="Show title"
            testID="go-live-title"
          />
        </View>

        <Text style={[styles.h, { color: theme.text, marginTop: SP.lg }]}>Add a show thumbnail</Text>
        <Text style={[styles.help, { color: theme.muted }]}>This is the image buyers see before they enter your show.</Text>
        <Pressable
          onPress={addThumbnail}
          style={[styles.thumbTile, { borderColor: theme.border, backgroundColor: theme.card }]}
          accessibilityRole="button"
          accessibilityLabel={cover ? 'Change thumbnail' : 'Add a thumbnail'}
          testID="go-live-thumbnail"
        >
          {cover ? (
            <>
              <CachedImage source={{ uri: cover.localUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
              {cover.uploading && <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: MEDIA.chip }]}><ActivityIndicator color={MEDIA.fg} /></View>}
            </>
          ) : (
            <>
              <Text style={[styles.optional, { color: theme.muted }]}>Optional</Text>
              <Feather name="image" size={22} color={theme.text} />
              <Text style={[styles.thumbText, { color: theme.text }]}>Add a Thumbnail</Text>
            </>
          )}
        </Pressable>

        <Text style={[styles.h, { color: theme.text, marginTop: SP.lg }]}>Products to pin</Text>
        <Text style={[styles.help, { color: theme.muted }]}>Line up what you&apos;ll sell. While you&apos;re live, pin one at a time and buyers get a Buy now button.</Text>
        {featured.map(p => (
          <View key={p.id} style={[styles.productRow, { borderColor: theme.borderSubtle }]}>
            <View style={[styles.productThumb, { backgroundColor: theme.cardElevated }]}>
              {p.imageUrl ? <CachedImage source={{ uri: p.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Feather name="shopping-bag" size={16} color={theme.muted} />}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.productName, { color: theme.text }]} numberOfLines={1}>{p.name}</Text>
              <Text style={[styles.help, { color: theme.muted, marginTop: 0 }]}>{formatCents(p.priceCents ?? 0)}</Text>
            </View>
            <Pressable onPress={() => toggleFeaturedProduct(p.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${p.name}`}>
              <Feather name="x" size={18} color={theme.muted} />
            </Pressable>
          </View>
        ))}
        <Pressable
          onPress={() => { haptic('sheet'); setShowPicker(true); if (catalog.length === 0) void loadCatalog(); }}
          style={[styles.addRow, { borderColor: theme.border }]}
          accessibilityRole="button"
          testID="go-live-add-products"
        >
          <Feather name="plus" size={18} color={theme.text} />
          <Text style={[styles.addRowText, { color: theme.text }]}>{featured.length ? 'Add more products' : 'Add products'}</Text>
        </Pressable>

        <Pressable onPress={() => router.push('/seller-schedule-live' as never)} style={styles.schedule} accessibilityRole="button">
          <Text style={[styles.scheduleText, { color: theme.muted }]}>Schedule for later instead</Text>
        </Pressable>
        {notice ? <Text style={[styles.help, { color: theme.muted, textAlign: 'center' }]}>{notice}</Text> : null}
      </ScrollView>
      <StickyFooter>
        {nextHint ? <Text style={[styles.help, styles.nextHint, { color: theme.muted }]} testID="go-live-next-hint">{nextHint}</Text> : null}
        <View style={styles.footerRow}>
          <Pressable onPress={() => goBackOr(router)} style={[styles.footerBtn, { borderColor: theme.border, borderWidth: 1 }]} accessibilityRole="button">
            <Text style={[styles.footerText, { color: theme.text }]}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={() => setStep('camera')}
            disabled={!canNext}
            style={[styles.footerBtn, { backgroundColor: theme.text, opacity: canNext ? 1 : 0.4 }]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canNext }}
            testID="go-live-next"
          >
            <Text style={[styles.footerText, { color: theme.background }]}>Next</Text>
          </Pressable>
        </View>
      </StickyFooter>

      {showPicker && (
        <LiveProductsSheet
          visible
          products={catalog.map(toLiveProduct)}
          pinnedProductId={null}
          onClose={() => setShowPicker(false)}
          emptyText={catalogLoading
            ? 'Loading your products…'
            : catalogFailed
              ? 'Couldn’t load your products. Close and try again.'
              : 'No products yet. Add products to your store first.'}
          actionFor={product => {
            const added = featured.some(f => f.id === product.productId);
            return { label: added ? 'Added' : 'Add', selected: added, onPress: () => toggleFeaturedProduct(product.productId) };
          }}
        />
      )}
    </View>
  );
}

// ─── Step 2: camera check ────────────────────────────────────────────────────

function CameraCheck({ title, coverUrl, featured, scheduledLiveId, onBack }: {
  title: string;
  coverUrl: string | null;
  featured: CatalogProduct[];
  scheduledLiveId?: string;
  onBack: () => void;
}) {
  const router = useRouter();
  const api = useApi();
  const { user } = useUser();
  const insets = useSafeAreaInsets();
  const topInset = useHeaderTopInset();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [permissionsRequested, setPermissionsRequested] = useState(false);
  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const [torch, setTorch] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [upsell, setUpsell] = useState<EntitlementRejection | null>(null);
  const [showShop, setShowShop] = useState(false);
  const previewDemo = isLivePreviewDemo();
  const canBroadcastHere = previewDemo || (Platform.OS !== 'web' && !!loadAgoraModule());

  useEffect(() => {
    void (async () => {
      if (!cameraPermission?.granted) await requestCameraPermission();
      if (!micPermission?.granted) await requestMicPermission();
      setPermissionsRequested(true);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const flipCamera = useCallback(() => {
    haptic('select');
    setFacing(v => {
      const next = v === 'front' ? 'back' : 'front';
      if (next === 'front') setTorch(false);
      return next;
    });
  }, []);

  const products = useMemo(() => featured.map(toLiveProduct), [featured]);

  async function handleStart() {
    if (starting || !canBroadcastHere) return;
    setStarting(true);
    setError('');
    try {
      if (previewDemo) {
        const { streamId } = await getLiveStreamProvider().start({ title, productIds: featured.map(p => p.id) });
        router.replace({ pathname: '/seller-live', params: { streamId, title, facing, mic: micOn ? 'on' : 'off' } } as never);
        return;
      }
      const result = await (api as any).live.start({
        title: title.trim(),
        thumbnailUrl: coverUrl ?? undefined,
        ...(scheduledLiveId ? { scheduledLiveId } : {}),
        productTags: featured.map(p => ({
          productId: p.id,
          productName: p.name,
          priceCents: p.priceCents ?? 0,
          imageUri: p.imageUrl ?? undefined,
        })),
      }) as any;
      router.replace({
        pathname: '/seller-live',
        params: {
          streamId:    result.stream.id,
          channelName: result.stream.channelName,
          agoraUid:    String(result.stream.agoraUid),
          agoraAppId:  result.agoraAppId,
          token:       result.token ?? '',
          title:       title.trim(),
          facing,
          mic:         micOn ? 'on' : 'off',
        },
      } as never);
    } catch (e: any) {
      const rejection = getEntitlementRejection(e);
      if (rejection) { setUpsell(rejection); return; }
      setError(isLiveNotConfiguredError(e) ? LIVE_NOT_CONFIGURED_BODY : liveStartErrorMessage(e));
    } finally {
      setStarting(false);
    }
  }

  const camGranted = cameraPermission?.granted ?? false;
  const micGranted = micPermission?.granted ?? false;
  const camBlocked = cameraPermission !== null && !cameraPermission?.granted && cameraPermission?.canAskAgain === false;
  const micBlocked = micPermission !== null && !micPermission?.granted && micPermission?.canAskAgain === false;

  if (permissionsRequested && (!camGranted || !micGranted)) {
    const blocked = camBlocked || micBlocked;
    return (
      <View style={[styles.camRoot, styles.center, { paddingBottom: insets.bottom + 24 }]} testID="go-live-permissions">
        <Pressable onPress={onBack} style={[styles.camClose, { top: topInset + 8 }]} accessibilityRole="button" accessibilityLabel="Close">
          <Feather name="x" size={20} color={MEDIA.fg} />
        </Pressable>
        <LiveNotice
          tone="dark"
          title="Camera & microphone access needed"
          body="Brandthread needs your camera and microphone to go live, so buyers can see and hear your show."
        />
        <Pressable
          style={styles.permBtn}
          onPress={blocked ? () => { void Linking.openSettings(); } : async () => { await requestCameraPermission(); await requestMicPermission(); }}
          accessibilityRole="button"
        >
          <Text style={styles.startText}>{blocked ? 'Open Settings' : 'Allow camera & microphone'}</Text>
        </Pressable>
      </View>
    );
  }

  const host = {
    name: user?.username ?? user?.firstName ?? 'You',
    imageUrl: user?.imageUrl ?? null,
  };

  return (
    <View style={styles.camRoot} testID="go-live-camera">
      <PlanUpsellModal
        visible={!!upsell}
        featureName="Live selling"
        requiredPlan={upsell?.requiredPlan ?? LIVE_HOST_MIN_PLAN}
        onClose={() => setUpsell(null)}
        onUpgrade={() => { setUpsell(null); router.push('/subscription' as never); }}
      />
      {camGranted && micGranted ? (
        <CameraView style={StyleSheet.absoluteFill} facing={facing} enableTorch={facing === 'back' && torch} mute={!micOn} />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: MEDIA.backdrop }]} />
      )}

      <View style={[styles.camTop, { top: topInset + 6 }]} pointerEvents="box-none">
        <View style={styles.camHost}>
          <View style={styles.camAvatar}>
            {host.imageUrl
              ? <CachedImage source={{ uri: host.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
              : <Text style={styles.camAvatarText}>{host.name.slice(0, 1).toUpperCase()}</Text>}
          </View>
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.camName} numberOfLines={1}>{host.name}</Text>
            <Text style={styles.camTitle} numberOfLines={1}>{title}</Text>
          </View>
        </View>
        <Pressable onPress={onBack} style={styles.camClose} accessibilityRole="button" accessibilityLabel="Close" testID="go-live-camera-close">
          <Feather name="x" size={20} color={MEDIA.fg} />
        </Pressable>
      </View>

      <View style={[styles.camRail, { bottom: insets.bottom + 96 }]}>
        {facing === 'back' && (
          <RailButton icon={torch ? 'zap' : 'zap-off'} label="Flash" onPress={() => { haptic('select'); setTorch(v => !v); }} />
        )}
        <RailButton icon="refresh-cw" label="Flip" onPress={flipCamera} testID="go-live-flip" />
        <RailButton icon={micOn ? 'mic' : 'mic-off'} label={micOn ? 'Mic on' : 'Mic off'} onPress={() => { haptic('select'); setMicOn(v => !v); }} testID="go-live-mic" />
        <RailButton icon="shopping-bag" label="Shop" badge={featured.length} onPress={() => setShowShop(true)} testID="go-live-shop" />
      </View>

      <View style={[styles.camBottom, { paddingBottom: insets.bottom + 12 }]}>
        {!canBroadcastHere ? (
          <Text style={styles.camNote}>Going live works in the Brandthread app. You can still check your camera here.</Text>
        ) : error ? (
          <Text style={styles.camNote} testID="go-live-error">{error}</Text>
        ) : null}
        <Pressable
          onPress={() => { void handleStart(); }}
          disabled={starting || !canBroadcastHere}
          style={[styles.startBtn, (!canBroadcastHere) && { opacity: 0.5 }]}
          accessibilityRole="button"
          accessibilityState={{ disabled: starting || !canBroadcastHere }}
          testID="go-live-start"
        >
          {starting ? <ActivityIndicator color={MEDIA.onFg} /> : <Text style={styles.startText}>Start show</Text>}
        </Pressable>
      </View>

      {showShop && (
        <LiveProductsSheet
          visible
          products={products}
          pinnedProductId={null}
          onClose={() => setShowShop(false)}
          actionFor={() => ({ label: 'Pin once you’re live', onPress: () => setShowShop(false) })}
        />
      )}
    </View>
  );
}

function RailButton({ icon, label, onPress, badge, testID }: {
  icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void; badge?: number; testID?: string;
}) {
  return (
    <Pressable onPress={onPress} style={styles.railItem} accessibilityRole="button" accessibilityLabel={label} testID={testID} hitSlop={4}>
      <View>
        <Feather name={icon} size={23} color={MEDIA.fg} />
        {badge != null && badge > 0 && (
          <View style={styles.railBadge}><Text style={styles.railBadgeText}>{badge}</Text></View>
        )}
      </View>
      <Text style={styles.railLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  form: { paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: 120 },
  h: { fontFamily: FONT.bold, fontSize: FS.lg, lineHeight: 24 },
  help: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 18, marginTop: 4 },
  field: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, marginTop: SP.md },
  fieldLabel: { fontFamily: FONT.regular, fontSize: FS.meta },
  fieldInput: { fontFamily: FONT.regular, fontSize: FS.base, paddingVertical: 4, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as object : null) },
  thumbTile: {
    width: 150, aspectRatio: 3 / 4, borderRadius: 10, borderWidth: 1, marginTop: SP.md, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  optional: { position: 'absolute', top: 8, right: 10, fontFamily: FONT.regular, fontSize: FS.meta },
  thumbText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  productThumb: { width: 44, height: 44, borderRadius: 6, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  productName: { fontFamily: FONT.semibold, fontSize: FS.base },
  addRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: 23, borderWidth: 1, marginTop: SP.md },
  addRowText: { fontFamily: FONT.semibold, fontSize: FS.base },
  schedule: { alignItems: 'center', paddingVertical: SP.lg },
  scheduleText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  footerRow: { flexDirection: 'row', gap: 12 },
  nextHint: { textAlign: 'center', marginTop: 0, marginBottom: SP.sm },
  footerBtn: { flex: 1, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  footerText: { fontFamily: FONT.bold, fontSize: FS.base },

  camRoot: { flex: 1, backgroundColor: MEDIA.backdrop },
  camTop: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  camHost: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  camAvatar: { width: 34, height: 34, borderRadius: 17, overflow: 'hidden', backgroundColor: MEDIA.chip, alignItems: 'center', justifyContent: 'center' },
  camAvatarText: { color: MEDIA.fg, fontFamily: FONT.bold, fontSize: FS.sm },
  camName: { color: MEDIA.fg, fontFamily: FONT.bold, fontSize: 15 },
  camTitle: { color: MEDIA.fgMuted, fontFamily: FONT.medium, fontSize: FS.meta, marginTop: 1 },
  camClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: MEDIA.chip, alignItems: 'center', justifyContent: 'center' },
  camRail: { position: 'absolute', right: 12, alignItems: 'center', gap: 16 },
  railItem: { alignItems: 'center', minWidth: 48, gap: 3 },
  railLabel: { color: MEDIA.fg, fontFamily: FONT.semibold, fontSize: FS.xs },
  railBadge: {
    position: 'absolute', top: -6, right: -10, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4,
    backgroundColor: MEDIA.fg, alignItems: 'center', justifyContent: 'center',
  },
  railBadgeText: { color: MEDIA.onFg, fontFamily: FONT.bold, fontSize: 10 },
  camBottom: { position: 'absolute', left: 12, right: 12, bottom: 0, gap: 10 },
  camNote: { color: MEDIA.fgMuted, fontFamily: FONT.medium, fontSize: FS.meta, textAlign: 'center' },
  startBtn: { height: 52, borderRadius: 26, backgroundColor: MEDIA.fg, alignItems: 'center', justifyContent: 'center' },
  startText: { color: MEDIA.onFg, fontFamily: FONT.bold, fontSize: FS.md },
  permBtn: { marginTop: SP.lg, height: 48, paddingHorizontal: 28, borderRadius: 24, backgroundColor: MEDIA.fg, alignItems: 'center', justifyContent: 'center' },
});
