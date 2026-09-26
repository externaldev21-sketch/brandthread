/**
 * Seller Go Live — pre-broadcast setup screen.
 * Full-bleed live camera preview (front by default), title/description over a
 * bottom gradient, then hands off into the existing /seller-live broadcast flow.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
  Animated, KeyboardAvoidingView, Platform, Linking, Image, FlatList,
} from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/lib/api';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import NativeOnlyFeature from '@/components/NativeOnlyFeature';

const LIVE_RED = '#FF3B30';
const FG = '#FFFFFF';
const GLASS = 'rgba(0,0,0,0.5)';

export default function SellerGoLiveScreen() {
  if (Platform.OS === 'web') {
    return (
      <NativeOnlyFeature
        icon="video-off"
        title="Going live is mobile-only"
        description="Start a Brandthread live broadcast from the iOS or Android app, where camera and microphone access are available."
      />
    );
  }
  return <SellerGoLiveNativeScreen />;
}

function SellerGoLiveNativeScreen() {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [permissionsRequested, setPermissionsRequested] = useState(false);

  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const [torch, setTorch] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [starting, setStarting] = useState(false);

  // ── Products to feature ──
  // Tagging previously only happened mid-broadcast (seller-live.tsx's
  // product-picker rail button); sellers had no way to line products up
  // before going live. Reuses the same pick/toggle pattern and is sent
  // straight through as `productTags` on /api/live/start (already accepted
  // there, just never populated from setup).
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [allProducts, setAllProducts] = useState<any[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [featuredProducts, setFeaturedProducts] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    setProductsLoading(true);
    (api as any).products?.list?.()
      .then((r: any) => { if (!cancelled) setAllProducts(r?.products ?? []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setProductsLoading(false); });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleFeaturedProduct(product: any) {
    Haptics.selectionAsync();
    setFeaturedProducts(prev =>
      prev.some(p => p.id === product.id)
        ? prev.filter(p => p.id !== product.id)
        : [...prev, product],
    );
  }

  const flipAnim = useRef(new Animated.Value(1)).current;
  const goLiveScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    void (async () => {
      if (!cameraPermission?.granted) await requestCameraPermission();
      if (!micPermission?.granted) await requestMicPermission();
      setPermissionsRequested(true);
    })();
  }, []);

  const flipCamera = useCallback(() => {
    Haptics.selectionAsync();
    Animated.sequence([
      Animated.timing(flipAnim, { toValue: 0, duration: 140, useNativeDriver: true }),
      Animated.timing(flipAnim, { toValue: 1, duration: 140, useNativeDriver: true }),
    ]).start();
    setFacing(v => {
      const next = v === 'front' ? 'back' : 'front';
      if (next === 'front') setTorch(false);
      return next;
    });
  }, [flipAnim]);

  const toggleTorch = useCallback(() => {
    Haptics.selectionAsync();
    setTorch(v => !v);
  }, []);

  const onGoLivePressIn = useCallback(() => {
    Animated.spring(goLiveScale, { toValue: 0.96, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  }, [goLiveScale]);

  const onGoLivePressOut = useCallback(() => {
    Animated.spring(goLiveScale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  }, [goLiveScale]);

  async function handleGoLive() {
    if (!title.trim() || starting) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStarting(true);
    try {
      const result = await (api as any).live.start({
        title: title.trim(),
        description: description.trim() || undefined,
        productTags: featuredProducts.map(p => ({
          productId: p.id,
          productName: p.name,
          priceCents: p.priceCents ?? 0,
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
        },
      } as any);
    } catch (e: any) {
      Alert.alert('Could not start live', e?.message ?? 'Please check your connection and try again.');
    } finally {
      setStarting(false);
    }
  }

  const camGranted = cameraPermission?.granted ?? false;
  const micGranted = micPermission?.granted ?? false;
  const camBlocked = cameraPermission !== null && !cameraPermission?.granted && cameraPermission?.canAskAgain === false;
  const micBlocked = micPermission !== null && !micPermission?.granted && micPermission?.canAskAgain === false;

  // ─── Permissions gate ────────────────────────────────────────────────────
  if (permissionsRequested && (!camGranted || !micGranted)) {
    const blocked = camBlocked || micBlocked;
    return (
      <View style={[s.permRoot, { paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]}>
        <TouchableOpacity onPress={() => goBackOr(router)} style={[s.closeBtn, { top: insets.top + 8 }]} accessibilityLabel="Close">
          <Feather name="x" size={22} color={FG} />
        </TouchableOpacity>
        <View style={s.permBox}>
          <View style={s.permIconWrap}>
            <Feather name="camera-off" size={30} color="rgba(255,255,255,0.7)" />
          </View>
          <Text style={s.permTitle}>Camera & microphone access needed</Text>
          <Text style={s.permSub}>
            Brandthread needs your camera and microphone to go live, so viewers can see and hear your stream.
          </Text>
          {blocked ? (
            <TouchableOpacity
              style={[s.permBtn, { backgroundColor: theme.accent }]}
              onPress={() => Linking.openSettings()}
            >
              <Text style={[s.permBtnText, { color: theme.onAccent }]}>Open Settings</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[s.permBtn, { backgroundColor: theme.accent }]}
              onPress={async () => {
                await requestCameraPermission();
                await requestMicPermission();
              }}
            >
              <Text style={[s.permBtnText, { color: theme.onAccent }]}>Allow camera</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => goBackOr(router)}>
            <Text style={s.permCancel}>Not now</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* Live camera preview, full-bleed */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: flipAnim, transform: [{ scaleX: flipAnim }] }]}>
        {camGranted && micGranted ? (
          <CameraView style={StyleSheet.absoluteFill} facing={facing} enableTorch={facing === 'back' && torch} />
        ) : (
          <View style={[StyleSheet.absoluteFill, s.cameraPlaceholder]} />
        )}
      </Animated.View>

      {/* Top bar */}
      <View style={[s.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => goBackOr(router)} style={s.iconBtn} accessibilityLabel="Close">
          <Feather name="x" size={20} color={FG} />
        </TouchableOpacity>
        <View style={s.topRight}>
          {facing === 'back' && (
            <TouchableOpacity onPress={toggleTorch} style={s.iconBtn} accessibilityLabel={torch ? 'Turn flash off' : 'Turn flash on'}>
              <Feather name={torch ? 'zap' : 'zap-off'} size={19} color={torch ? '#FBBF24' : FG} />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={flipCamera} style={s.iconBtn} accessibilityLabel="Flip camera">
            <Feather name="refresh-cw" size={19} color={FG} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Bottom gradient + setup fields */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.88)']}
        style={s.bottomGradient}
        pointerEvents="box-none"
      >
        <View style={s.fields} pointerEvents="box-none">
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Add a title…"
            placeholderTextColor="rgba(255,255,255,0.6)"
            maxLength={80}
            style={s.titleInput}
          />
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Add a description (optional)…"
            placeholderTextColor="rgba(255,255,255,0.5)"
            maxLength={200}
            multiline
            style={s.descInput}
          />

          <TouchableOpacity
            style={s.featureProductsBtn}
            onPress={() => setShowProductPicker(true)}
            activeOpacity={0.8}
            accessibilityLabel="Feature products"
          >
            <Feather name="shopping-bag" size={15} color={FG} />
            <Text style={s.featureProductsText}>
              {featuredProducts.length > 0
                ? `${featuredProducts.length} product${featuredProducts.length === 1 ? '' : 's'} featured`
                : 'Feature products'}
            </Text>
            <Feather name="chevron-right" size={15} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>

          <Animated.View style={{ transform: [{ scale: goLiveScale }] }}>
            <TouchableOpacity
              onPress={handleGoLive}
              onPressIn={onGoLivePressIn}
              onPressOut={onGoLivePressOut}
              disabled={starting || !title.trim()}
              activeOpacity={0.9}
              style={[s.goLiveBtn, { backgroundColor: LIVE_RED, opacity: starting || !title.trim() ? 0.5 : 1 }]}
            >
              {starting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <View style={s.liveDot} />
                  <Text style={s.goLiveBtnText}>Go Live</Text>
                </>
              )}
            </TouchableOpacity>
          </Animated.View>
        </View>
      </LinearGradient>

      {showProductPicker && (
        <View style={[StyleSheet.absoluteFill, s.pickerModal]}>
          <View style={[s.pickerSheet, { paddingBottom: insets.bottom + 12 }]}>
            <View style={s.pickerHeader}>
              <Text style={s.pickerTitle}>Feature products</Text>
              <TouchableOpacity onPress={() => setShowProductPicker(false)} accessibilityLabel="Done">
                <Feather name="x" size={22} color={FG} />
              </TouchableOpacity>
            </View>
            {productsLoading ? (
              <View style={s.pickerLoading}>
                <ActivityIndicator color={FG} />
              </View>
            ) : (
              <FlatList
                data={allProducts}
                keyExtractor={p => p.id}
                ListEmptyComponent={<Text style={s.pickerEmptyText}>No products found. Add products to your store first.</Text>}
                renderItem={({ item: p }) => {
                  const tagged = featuredProducts.some(t => t.id === p.id);
                  return (
                    <TouchableOpacity
                      onPress={() => toggleFeaturedProduct(p)}
                      activeOpacity={0.7}
                      style={[s.pickerRow, tagged && s.pickerRowActive]}
                    >
                      {p.imageUrl ? (
                        <Image source={{ uri: p.imageUrl }} style={s.pickerRowThumb} />
                      ) : (
                        <View style={[s.pickerRowThumb, s.pickerRowThumbPlaceholder]}>
                          <Feather name="image" size={16} color="rgba(255,255,255,0.4)" />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={s.pickerRowName} numberOfLines={1}>{p.name}</Text>
                        <Text style={s.pickerRowPrice}>${((p.priceCents ?? 0) / 100).toFixed(2)}</Text>
                      </View>
                      <View style={[s.checkbox, tagged && s.checkboxActive]}>
                        {tagged && <Feather name="check" size={13} color="#000" />}
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  return StyleSheet.create({
    root:              { flex: 1, backgroundColor: '#000' },
    cameraPlaceholder: { backgroundColor: '#0a0a0a' },

    topBar:            { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md },
    topRight:          { flexDirection: 'row', gap: 10 },
    iconBtn:           { width: 40, height: 40, borderRadius: 20, backgroundColor: GLASS, alignItems: 'center', justifyContent: 'center' },

    bottomGradient:    { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 100 },
    fields:            { paddingHorizontal: SP.md, paddingBottom: SP.md, gap: SP.sm },
    titleInput:        { color: FG, fontSize: FS.md, fontFamily: FONT.bold, paddingVertical: 6 },
    descInput:         { color: 'rgba(255,255,255,0.9)', fontSize: FS.sm, fontFamily: FONT.regular, paddingVertical: 2, maxHeight: 60 },

    goLiveBtn:         { marginTop: SP.xs, borderRadius: RADIUS.pill, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
    liveDot:           { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
    goLiveBtnText:      { color: '#fff', fontFamily: FONT.bold, fontSize: FS.base, letterSpacing: 0.5 },

    // Feature-products entry point
    featureProductsBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: GLASS, borderRadius: RADIUS.pill, paddingHorizontal: 14, height: 38, alignSelf: 'flex-start' },
    featureProductsText: { color: FG, fontFamily: FONT.medium, fontSize: FS.sm },

    // Product picker sheet
    pickerModal:       { backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    pickerSheet:        { backgroundColor: '#141416', borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, maxHeight: '70%', paddingTop: SP.md },
    pickerHeader:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingBottom: SP.sm },
    pickerTitle:        { color: FG, fontSize: FS.base, fontFamily: FONT.bold },
    pickerLoading:      { paddingVertical: SP.xl, alignItems: 'center' },
    pickerEmptyText:    { color: 'rgba(255,255,255,0.6)', fontSize: FS.sm, textAlign: 'center', paddingVertical: SP.xl, paddingHorizontal: SP.md },
    pickerRow:          { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md, paddingVertical: SP.sm },
    pickerRowActive:    { backgroundColor: 'rgba(255,255,255,0.06)' },
    pickerRowThumb:     { width: 40, height: 40, borderRadius: RADIUS.sm },
    pickerRowThumbPlaceholder: { backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
    pickerRowName:      { color: FG, fontSize: FS.sm, fontFamily: FONT.semibold },
    pickerRowPrice:     { color: 'rgba(255,255,255,0.6)', fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
    checkbox:           { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)', alignItems: 'center', justifyContent: 'center' },
    checkboxActive:      { backgroundColor: FG, borderColor: FG },

    // Permissions gate
    permRoot:          { flex: 1, backgroundColor: '#000' },
    closeBtn:          { position: 'absolute', left: SP.md, width: 40, height: 40, borderRadius: 20, backgroundColor: GLASS, alignItems: 'center', justifyContent: 'center', zIndex: 10 },
    permBox:           { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: SP.md },
    permIconWrap:      { width: 68, height: 68, borderRadius: RADIUS.xl, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
    permTitle:         { color: FG, fontSize: FS.md, fontFamily: FONT.bold, textAlign: 'center' },
    permSub:           { color: 'rgba(255,255,255,0.65)', fontSize: FS.sm, textAlign: 'center', lineHeight: 22 },
    permBtn:           { paddingHorizontal: 28, paddingVertical: 13, borderRadius: RADIUS.md, marginTop: SP.sm },
    permBtnText:       { fontSize: FS.base, fontFamily: FONT.semibold },
    permCancel:        { color: 'rgba(255,255,255,0.55)', fontSize: FS.sm },
  });
};
