/**
 * Story composer — camera-first, modeled on Instagram/Snapchat's story-creation
 * mechanism (see PR description for Mobbin references).
 *
 * Flow: CAMERA (full-bleed live preview, shutter/gallery/flip, mode carousel,
 *   left-rail "Aa" Create shortcut) → EDIT (full-bleed captured/picked media,
 *   text/sticker/draw tools, bottom "Your story"/"Close Friends"/send) — or,
 *   from the rail, straight into CREATE (text-only background-swatch mode).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Animated, Dimensions, Image, Modal, PanResponder, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useUser } from '@clerk/expo';
import Svg, { Path } from 'react-native-svg';
import {
  CARD, BORDER, FG, MUTED, ON_DARK, FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { createStory, MY_COLOR } from '@/services/socialService';
import { useApi } from '@/lib/api';
import type { StoryMedia, StoryOverlay, StoryOverlayType, StoryPrivacySettings } from '@/services/socialTypes';
import { useAppTheme, getOnAccentTextStyle } from '@/contexts/AppThemeContext';
import { getTaggableProducts } from '@/services/productService';
import type { Product } from '@/services/productTypes';
import { PressableScale, HapticSwitch } from '@/components/BrandthreadUI';
import { hapticLight, hapticToggle, hapticPrimaryAction, hapticSuccessAction } from '@/lib/haptics';
import { ThreadCashBillIcon } from '@/components/thread-cash/ThreadCashBill';
const { width: W, height: H } = Dimensions.get('window');
const IS_WEB = Platform.OS === 'web';
const MAX_VIDEO_SECONDS = 15;

type Step = 'camera' | 'create' | 'edit';
type CaptureMode = 'story' | 'post' | 'live';
type CapturedMedia = { kind: 'photo' | 'video'; uri: string };

// ─── Monochrome-leaning "Create" backgrounds ───────────────────────────────
// Pure black / off-white / charcoal / graphite / a couple of subtle
// gradients, plus (at most) one tasteful accent pulled from the live theme.
type BgSwatch = { id: string; kind: 'solid' | 'gradient'; colors: [string, string]; label: string };

function buildSwatches(accent: string): BgSwatch[] {
  return [
    { id: 'black', kind: 'solid', colors: ['#000000', '#000000'], label: 'Black' },
    { id: 'off-white', kind: 'solid', colors: ['#F2F1ED', '#F2F1ED'], label: 'Off-white' },
    { id: 'charcoal', kind: 'solid', colors: ['#1C1C1E', '#1C1C1E'], label: 'Charcoal' },
    { id: 'graphite', kind: 'solid', colors: ['#2A2A2E', '#2A2A2E'], label: 'Graphite' },
    { id: 'grad-1', kind: 'gradient', colors: ['#000000', '#2A2A2E'], label: 'Fade' },
    { id: 'grad-2', kind: 'gradient', colors: ['#1C1C1E', '#000000'], label: 'Deep fade' },
    { id: 'accent', kind: 'gradient', colors: ['#000000', accent], label: 'Accent' },
  ];
}

const TEXT_COLORS = ['#FFFFFF', '#000000', '#C7C7CC', '#8E8E93'];
const FONT_PRESETS: { key: string; label: string; weight: 'normal' | 'bold'; italic?: boolean; tracking?: number }[] = [
  { key: 'classic', label: 'Aa', weight: 'bold' },
  { key: 'soft', label: 'Aa', weight: 'normal' },
  { key: 'wide', label: 'Aa', weight: 'bold', tracking: 3 },
  { key: 'italic', label: 'Aa', weight: 'normal', italic: true },
];
type Align = 'left' | 'center' | 'right';

// ─── Draggable / pinch-scalable / rotatable overlay chip ───────────────────
function OverlayChip({
  overlay, canvasSize, onChange, onRemove, onTap, children,
}: {
  overlay: StoryOverlay;
  canvasSize: { width: number; height: number };
  onChange: (id: string, patch: Partial<StoryOverlay>) => void;
  onRemove: (id: string) => void;
  onTap?: () => void;
  children: React.ReactNode;
}) {
  const pan = useRef(new Animated.ValueXY({ x: overlay.x, y: overlay.y })).current;
  const lastPos = useRef({ x: overlay.x, y: overlay.y });
  const scaleRef = useRef(overlay.scale ?? 1);
  const rotationRef = useRef(overlay.rotation ?? 0);
  const [scale, setScale] = useState(scaleRef.current);
  const [rotation, setRotation] = useState(rotationRef.current);
  const pinchStartDist = useRef<number | null>(null);
  const pinchStartAngle = useRef<number | null>(null);
  const pinchStartScale = useRef(1);
  const pinchStartRotation = useRef(0);
  const movedRef = useRef(false);

  const dragResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (e, g) => e.nativeEvent.touches.length >= 2 || Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
      onPanResponderGrant: (e) => {
        movedRef.current = false;
        if (e.nativeEvent.touches.length >= 2) {
          const [a, b] = e.nativeEvent.touches;
          pinchStartDist.current = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
          pinchStartAngle.current = Math.atan2(b.pageY - a.pageY, b.pageX - a.pageX);
          pinchStartScale.current = scaleRef.current;
          pinchStartRotation.current = rotationRef.current;
          return;
        }
        pan.setOffset({ x: lastPos.current.x, y: lastPos.current.y });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: (e, g) => {
        if (e.nativeEvent.touches.length >= 2) {
          const [a, b] = e.nativeEvent.touches;
          if (pinchStartDist.current == null || pinchStartAngle.current == null) return;
          const dist = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
          const angle = Math.atan2(b.pageY - a.pageY, b.pageX - a.pageX);
          const nextScale = Math.max(0.4, Math.min(4, pinchStartScale.current * (dist / Math.max(1, pinchStartDist.current))));
          const nextRotation = pinchStartRotation.current + ((angle - pinchStartAngle.current) * 180) / Math.PI;
          scaleRef.current = nextScale;
          rotationRef.current = nextRotation;
          setScale(nextScale);
          setRotation(nextRotation);
          return;
        }
        movedRef.current = true;
        Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false })(e, g);
      },
      onPanResponderRelease: () => {
        if (pinchStartDist.current != null) {
          pinchStartDist.current = null;
          pinchStartAngle.current = null;
          onChange(overlay.id, { scale: scaleRef.current, rotation: rotationRef.current });
          return;
        }
        pan.flattenOffset();
        // @ts-ignore — internal but stable, matches DraggableOverlay pattern elsewhere in this screen family
        const rawX = (pan.x as any)._value as number;
        // @ts-ignore
        const rawY = (pan.y as any)._value as number;
        const x = Math.max(-40, Math.min(canvasSize.width - 20, rawX));
        const y = Math.max(-40, Math.min(canvasSize.height - 20, rawY));
        pan.setValue({ x, y });
        lastPos.current = { x, y };
        if (movedRef.current) onChange(overlay.id, { x, y });
        else onTap?.();
      },
    }),
  ).current;

  return (
    <Animated.View
      {...dragResponder.panHandlers}
      testID={`story-overlay-${overlay.id}`}
      style={[
        styles.overlayChip,
        { transform: [...pan.getTranslateTransform(), { scale }, { rotate: `${rotation}deg` }] },
      ]}
    >
      <Pressable
        onLongPress={() => { hapticLight(); onRemove(overlay.id); }}
        accessibilityRole="button"
        accessibilityLabel="Long-press to remove"
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

// ─── Freehand draw canvas ───────────────────────────────────────────────────
type DrawStroke = { color: string; width: number; d: string };

function DrawCanvas({ strokes, onAddStroke, color, width }: {
  strokes: DrawStroke[];
  onAddStroke: (s: DrawStroke) => void;
  color: string;
  width: number;
}) {
  const pointsRef = useRef<string>('');
  const [live, setLive] = useState('');
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        pointsRef.current = `M ${e.nativeEvent.locationX} ${e.nativeEvent.locationY}`;
        setLive(pointsRef.current);
      },
      onPanResponderMove: (e) => {
        pointsRef.current += ` L ${e.nativeEvent.locationX} ${e.nativeEvent.locationY}`;
        setLive(pointsRef.current);
      },
      onPanResponderRelease: () => {
        if (pointsRef.current) onAddStroke({ color, width, d: pointsRef.current });
        pointsRef.current = '';
        setLive('');
      },
    }),
  ).current;

  return (
    <View style={StyleSheet.absoluteFill} {...responder.panHandlers}>
      <Svg width="100%" height="100%">
        {strokes.map((s, i) => (
          <Path key={i} d={s.d} stroke={s.color} strokeWidth={s.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {live ? <Path d={live} stroke={color} strokeWidth={width} fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
      </Svg>
    </View>
  );
}

function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.muted = true; p.play(); });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />;
}

export default function StoryComposer() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useUser();
  const { theme } = useAppTheme();
  const api = useApi();
  const params = useLocalSearchParams<{ accountType?: string }>();
  const isSeller = params.accountType === 'seller';

  const myName = user?.fullName || user?.firstName || user?.username || 'You';
  const myHandle = user?.username ? `@${user.username}` : '';
  const myInitials = myName.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase() || 'Y';

  const [step, setStep] = useState<Step>('camera');

  // ── Camera state ──
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [flash, setFlash] = useState<'off' | 'on'>('off');
  const [mode, setMode] = useState<CaptureMode>('story');
  const [isRecording, setIsRecording] = useState(false);
  const [recordProgress, setRecordProgress] = useState(0);
  const [lastGalleryUri, setLastGalleryUri] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);
  const recordingRef = useRef(false);
  const recordTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStart = useRef(0);

  useEffect(() => {
    void (async () => {
      if (IS_WEB) return;
      if (!cameraPermission?.granted) await requestCameraPermission();
      if (!micPermission?.granted) await requestMicPermission();
    })();
  }, []);

  // ── Media (captured or picked) ──
  const [media, setMedia] = useState<CapturedMedia | null>(null);

  // ── Create-mode (text-only story) state ──
  const swatches = useMemo(() => buildSwatches(theme.accent), [theme.accent]);
  const [bgIdx, setBgIdx] = useState(0);
  const [createText, setCreateText] = useState('');
  const [createColor, setCreateColor] = useState('#FFFFFF');
  const [createFontIdx, setCreateFontIdx] = useState(0);
  const [createAlign, setCreateAlign] = useState<Align>('center');

  // ── Edit-screen state ──
  const [overlays, setOverlays] = useState<StoryOverlay[]>([]);
  const [textToolOpen, setTextToolOpen] = useState(false);
  const [textDraft, setTextDraft] = useState('');
  const [textDraftColor, setTextDraftColor] = useState('#FFFFFF');
  const [textDraftFontIdx, setTextDraftFontIdx] = useState(0);
  const [textDraftAlign, setTextDraftAlign] = useState<Align>('center');
  const [textDraftBg, setTextDraftBg] = useState(false);
  const [stickerSheetOpen, setStickerSheetOpen] = useState(false);
  const [drawOpen, setDrawOpen] = useState(false);
  const [drawColor, setDrawColor] = useState('#FFFFFF');
  const [drawWidth, setDrawWidth] = useState(4);
  const [strokes, setStrokes] = useState<DrawStroke[]>([]);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [taggableProducts, setTaggableProducts] = useState<Product[]>([]);
  const [shopModalOpen, setShopModalOpen] = useState(false);
  const [shopUrlDraft, setShopUrlDraft] = useState('');
  const [closeFriendsOnly, setCloseFriendsOnly] = useState(false);
  const [isPosting, setIsPosting] = useState(false);

  const canvasSize = { width: W, height: H };

  // ── Camera controls ──────────────────────────────────────────────────────

  const clearRecordTimer = useCallback(() => {
    if (recordTimer.current) clearInterval(recordTimer.current);
    recordTimer.current = null;
  }, []);

  const stopRecording = useCallback(() => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setIsRecording(false);
    clearRecordTimer();
    cameraRef.current?.stopRecording();
  }, [clearRecordTimer]);

  useEffect(() => () => { clearRecordTimer(); if (recordingRef.current) cameraRef.current?.stopRecording(); }, [clearRecordTimer]);

  const startRecording = useCallback(async () => {
    if (!cameraRef.current || recordingRef.current) return;
    recordingRef.current = true;
    setIsRecording(true);
    setRecordProgress(0);
    recordStart.current = Date.now();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    recordTimer.current = setInterval(() => {
      const elapsed = (Date.now() - recordStart.current) / 1000;
      setRecordProgress(Math.min(1, elapsed / MAX_VIDEO_SECONDS));
      if (elapsed >= MAX_VIDEO_SECONDS) stopRecording();
    }, 60);
    try {
      const result = await cameraRef.current.recordAsync({ maxDuration: MAX_VIDEO_SECONDS });
      if (result?.uri) {
        setMedia({ kind: 'video', uri: result.uri });
        setStep('edit');
      }
    } catch {
      // Silently drop — user can just try the shutter again.
    } finally {
      recordingRef.current = false;
      setIsRecording(false);
      setRecordProgress(0);
      clearRecordTimer();
    }
  }, [clearRecordTimer, stopRecording]);

  const takePhoto = useCallback(async () => {
    if (!cameraRef.current) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const result = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (result?.uri) {
        setMedia({ kind: 'photo', uri: result.uri });
        setStep('edit');
      }
    } catch {
      Alert.alert('Could not capture that photo', 'Please try again.');
    }
  }, []);

  const openGallery = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to choose from your camera roll.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.9,
      videoMaxDuration: MAX_VIDEO_SECONDS,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setLastGalleryUri(asset.uri);
      setMedia({ kind: asset.type === 'video' ? 'video' : 'photo', uri: asset.uri });
      setStep('edit');
    }
  }, []);

  // ── Overlay helpers ──────────────────────────────────────────────────────

  const addOverlay = useCallback((patch: Partial<StoryOverlay> & { type: StoryOverlayType }) => {
    setOverlays((prev) => [...prev, {
      id: `ov_${Date.now()}_${prev.length}`,
      x: W / 2 - 60,
      y: H / 2 - 40,
      rotation: 0,
      scale: 1,
      ...patch,
    }]);
  }, []);

  const changeOverlay = useCallback((id: string, patch: Partial<StoryOverlay>) => {
    setOverlays((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }, []);

  const removeOverlay = useCallback((id: string) => {
    setOverlays((prev) => prev.filter((o) => o.id !== id));
  }, []);

  const commitTextOverlay = () => {
    const text = textDraft.trim();
    if (text) {
      addOverlay({
        type: 'text',
        text,
        color: textDraftColor,
        size: 30,
        align: textDraftAlign,
      });
    }
    setTextDraft('');
    setTextToolOpen(false);
  };

  const openProductPicker = async () => {
    try {
      setTaggableProducts(await getTaggableProducts());
    } catch {
      setTaggableProducts([]);
    }
    setProductPickerOpen(true);
  };

  // ── Post ──────────────────────────────────────────────────────────────────

  const doShare = useCallback(async (payload: { type: 'photo' | 'video' | 'text'; uri?: string; bg?: string; text?: string; textColor?: string; ovs: StoryOverlay[] }) => {
    setIsPosting(true);
    try {
      const media: StoryMedia[] = [{
        id: `sm_${Date.now()}`,
        type: payload.type,
        backgroundColor: payload.bg ?? '#000',
        imageUri: payload.uri,
        textContent: payload.text,
        textColor: payload.textColor,
        duration: payload.type === 'video' ? Math.max(3, MAX_VIDEO_SECONDS) : 5,
        overlays: payload.ovs.length ? payload.ovs : undefined,
      }];

      const privacy: StoryPrivacySettings = {
        visibility: 'public',
        replyPermission: 'everyone',
        hiddenFromUserIds: [],
        closeFriendsOnly,
      };

      await createStory({ media, privacy, repliesDisabled: false });
      api.social.createStory({
        authorName: myName,
        authorHandle: myHandle,
        authorInitials: myInitials,
        authorColor: MY_COLOR,
        authorAccountType: (params.accountType as any) ?? 'buyer',
        media,
        repliesDisabled: false,
        privacy: { visibility: 'public', replyPermission: 'everyone' },
      }).catch(() => {});

      hapticSuccessAction();
      router.back();
    } catch {
      Alert.alert("Couldn't share your story", 'Try again.');
      setIsPosting(false);
    }
  }, [api, myName, myHandle, myInitials, params.accountType, router, closeFriendsOnly]);

  const shareFromEdit = () => {
    if (!media) return;
    void doShare({ type: media.kind, uri: media.uri, ovs: overlays });
  };

  const shareFromCreate = () => {
    if (!createText.trim()) return;
    void doShare({ type: 'text', bg: swatches[bgIdx].colors[0], text: createText.trim(), textColor: createColor, ovs: [] });
  };

  const closeAll = () => router.back();

  // ── CAMERA STEP ───────────────────────────────────────────────────────────

  if (step === 'camera') {
    const hasPermission = IS_WEB ? true : !!cameraPermission?.granted;
    return (
      <View style={[styles.root, { backgroundColor: '#000' }]}>
        <StatusBar style="light" />
        {IS_WEB ? (
          <View style={[styles.root, styles.webFallback]}>
            <Feather name="camera-off" size={40} color="rgba(255,255,255,0.4)" />
            <Text style={styles.webFallbackText}>Camera capture is mobile-only here.{"\n"}Choose media from your library to continue.</Text>
          </View>
        ) : hasPermission ? (
          <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} flash={flash} mode={isRecording ? 'video' : 'picture'} />
        ) : (
          <View style={[styles.root, styles.webFallback]}>
            <Feather name="camera-off" size={40} color="rgba(255,255,255,0.4)" />
            <Text style={styles.webFallbackText}>Camera access is required to post a story.</Text>
            <TouchableOpacity style={[styles.permBtn, { backgroundColor: theme.accent }]} onPress={() => { requestCameraPermission(); requestMicPermission(); }}>
              <Text style={[styles.permBtnText, getOnAccentTextStyle(theme)]}>Grant access</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Top bar — never under the notch */}
        <View style={[styles.camTopBar, { paddingTop: insets.top + SP.sm }]}>
          <TouchableOpacity style={styles.camIconBtn} onPress={closeAll} accessibilityLabel="Close" accessibilityRole="button">
            <Feather name="x" size={22} color={ON_DARK} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.camIconBtn}
            onPress={() => setFlash((v) => (v === 'off' ? 'on' : 'off'))}
            accessibilityLabel={flash === 'off' ? 'Turn flash on' : 'Turn flash off'}
            accessibilityRole="button"
          >
            <Feather name={flash === 'off' ? 'zap-off' : 'zap'} size={22} color={flash === 'on' ? '#FBBF24' : ON_DARK} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.camIconBtn}
            onPress={() => Alert.alert('Story settings', 'Audience, replies and close friends can be adjusted after you capture.')}
            accessibilityLabel="Story settings"
            accessibilityRole="button"
          >
            <Feather name="settings" size={22} color={ON_DARK} />
          </TouchableOpacity>
        </View>

        {/* Left-side vertical tool rail — Create shortcut */}
        <View style={[styles.leftRail, { top: insets.top + 90 }]}>
          <TouchableOpacity
            style={styles.railBtn}
            onPress={() => { hapticLight(); setStep('create'); }}
            accessibilityLabel="Create a text story"
            accessibilityRole="button"
          >
            <Text style={styles.railAa}>Aa</Text>
            <Text style={styles.railLabel}>Create</Text>
          </TouchableOpacity>
        </View>

        {/* Bottom controls */}
        <View style={[styles.camBottom, { paddingBottom: insets.bottom + SP.md }]}>
          {/* Mode carousel: STORY / POST / LIVE */}
          <View style={styles.modeRow}>
            {(['story', 'post', 'live'] as CaptureMode[]).map((m) => {
              const active = mode === m;
              return (
                <TouchableOpacity
                  key={m}
                  style={styles.modeItem}
                  disabled={m === 'live'}
                  onPress={() => {
                    hapticToggle();
                    if (m === 'post') { router.push({ pathname: '/create-post', params: { accountType: params.accountType ?? 'buyer' } } as any); return; }
                    setMode(m);
                  }}
                  accessibilityLabel={`${m} mode`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.modeText, active && styles.modeTextActive, m === 'live' && styles.modeTextDisabled]}>
                    {m.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.controlsRow}>
            {/* Gallery thumbnail */}
            <TouchableOpacity style={styles.galleryThumb} onPress={openGallery} accessibilityLabel="Choose from camera roll" accessibilityRole="button">
              {lastGalleryUri ? (
                <Image source={{ uri: lastGalleryUri }} style={styles.galleryThumbImg} />
              ) : (
                <Feather name="image" size={18} color={ON_DARK} />
              )}
            </TouchableOpacity>

            {/* Shutter — tap for photo, hold for video */}
            <Pressable
              style={styles.shutterWrap}
              onPress={takePhoto}
              onLongPress={startRecording}
              onPressOut={() => { if (recordingRef.current) stopRecording(); }}
              delayLongPress={220}
              accessibilityLabel="Tap for photo, hold for video"
              accessibilityRole="button"
            >
              <View style={styles.shutterRing}>
                {isRecording ? (
                  <View style={[styles.progressRing, { transform: [{ rotate: `${recordProgress * 360}deg` }] }]} />
                ) : null}
                <View style={[styles.shutterInner, isRecording && { backgroundColor: '#F87171' }]} />
              </View>
            </Pressable>

            {/* Flip camera */}
            <TouchableOpacity
              style={styles.flipBtn}
              disabled={isRecording}
              onPress={() => setFacing((v) => (v === 'back' ? 'front' : 'back'))}
              accessibilityLabel="Flip camera"
              accessibilityRole="button"
            >
              <Feather name="refresh-cw" size={20} color={isRecording ? 'rgba(255,255,255,0.35)' : ON_DARK} />
            </TouchableOpacity>
          </View>

          <Text style={styles.hint}>Tap for photo · Hold for video</Text>
        </View>
      </View>
    );
  }

  // ── CREATE STEP (text-only story) ───────────────────────────────────────

  if (step === 'create') {
    const swatch = swatches[bgIdx];
    const font = FONT_PRESETS[createFontIdx];
    // Auto-scale: fewer characters → larger type, more → smaller, clamped.
    const autoSize = Math.max(24, Math.min(46, 220 / Math.max(6, createText.length || 6)));
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <LinearGradient colors={swatch.colors} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} />

        <View style={[styles.camTopBar, { paddingTop: insets.top + SP.sm }]}>
          <TouchableOpacity style={styles.camIconBtn} onPress={() => setStep('camera')} accessibilityLabel="Back to camera" accessibilityRole="button">
            <Feather name="arrow-left" size={22} color={swatch.id === 'off-white' ? '#000' : ON_DARK} />
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <PressableScale
            onPress={() => { hapticPrimaryAction(); shareFromCreate(); }}
            disabled={!createText.trim() || isPosting}
            style={{ opacity: !createText.trim() || isPosting ? 0.4 : 1 }}
            accessibilityRole="button"
            accessibilityLabel="Share story"
          >
            <LinearGradient colors={theme.primaryGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.shareBtn}>
              <Text style={[styles.shareBtnText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>{isPosting ? 'Posting…' : 'Share'}</Text>
            </LinearGradient>
          </PressableScale>
        </View>

        <Pressable style={styles.createCenter} onPress={() => {}} accessibilityRole="none">
          <TextInput
            style={[
              styles.createInput,
              {
                color: createColor,
                fontSize: autoSize,
                textAlign: createAlign,
                fontWeight: font.weight,
                fontStyle: font.italic ? 'italic' : 'normal',
                letterSpacing: font.tracking ?? 0,
              },
            ]}
            value={createText}
            onChangeText={setCreateText}
            placeholder="Tap to type"
            placeholderTextColor={swatch.id === 'off-white' ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.35)'}
            multiline
            autoFocus
            maxLength={280}
          />
        </Pressable>

        {/* Small toolbar: font cycle, alignment, text color */}
        <View style={[styles.createToolbar, { bottom: insets.bottom + 128 }]}>
          <TouchableOpacity style={styles.createToolBtn} onPress={() => { hapticToggle(); setCreateFontIdx((i) => (i + 1) % FONT_PRESETS.length); }} accessibilityLabel="Cycle font style" accessibilityRole="button">
            <Text style={[styles.createToolAa, { fontWeight: font.weight, fontStyle: font.italic ? 'italic' : 'normal' }]}>Aa</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.createToolBtn}
            onPress={() => { hapticToggle(); setCreateAlign((a) => (a === 'left' ? 'center' : a === 'center' ? 'right' : 'left')); }}
            accessibilityLabel={`Text alignment: ${createAlign}`}
            accessibilityRole="button"
          >
            <Feather name={createAlign === 'left' ? 'align-left' : createAlign === 'right' ? 'align-right' : 'align-center'} size={20} color={ON_DARK} />
          </TouchableOpacity>
          {TEXT_COLORS.map((c) => (
            <PressableScale
              key={c}
              style={[styles.colorCircle, { backgroundColor: c }, createColor === c && styles.colorCircleActive, c === '#000000' && styles.colorCircleBorder]}
              onPress={() => { hapticToggle(); setCreateColor(c); }}
              accessibilityRole="button"
              accessibilityLabel={`Text color ${c}`}
              accessibilityState={{ selected: createColor === c }}
            />
          ))}
        </View>

        {/* Background swatches — 28pt circles */}
        <View style={[styles.bgSwatchRow, { bottom: insets.bottom + SP.lg }]}>
          {swatches.map((sw, i) => (
            <PressableScale
              key={sw.id}
              onPress={() => { hapticToggle(); setBgIdx(i); }}
              accessibilityRole="button"
              accessibilityLabel={`Background: ${sw.label}`}
              accessibilityState={{ selected: bgIdx === i }}
            >
              <LinearGradient
                colors={sw.colors}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={[styles.bgSwatch, bgIdx === i && styles.bgSwatchActive]}
              />
            </PressableScale>
          ))}
        </View>
      </View>
    );
  }

  // ── EDIT STEP ─────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {media?.kind === 'video' ? <VideoPreview uri={media.uri} /> : media ? (
        <Image source={{ uri: media.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />
      )}

      {drawOpen ? <DrawCanvas strokes={strokes} onAddStroke={(s) => setStrokes((p) => [...p, s])} color={drawColor} width={drawWidth} /> : null}

      {/* Overlays */}
      {overlays.map((ov) => (
        <OverlayChip key={ov.id} overlay={ov} canvasSize={canvasSize} onChange={changeOverlay} onRemove={removeOverlay}>
          {renderOverlayContent(ov)}
        </OverlayChip>
      ))}

      {/* Top bar */}
      <View style={[styles.camTopBar, { paddingTop: insets.top + SP.sm }]}>
        <TouchableOpacity
          style={styles.camIconBtn}
          onPress={() => {
            if (!overlays.length && !strokes.length) { setMedia(null); setStep('camera'); return; }
            Alert.alert('Discard edits?', 'Your text, stickers and drawing will be lost.', [
              { text: 'Keep editing', style: 'cancel' },
              { text: 'Discard', style: 'destructive', onPress: () => { setOverlays([]); setStrokes([]); setMedia(null); setStep('camera'); } },
            ]);
          }}
          accessibilityLabel="Back"
          accessibilityRole="button"
        >
          <Feather name="x" size={22} color={ON_DARK} />
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        {/* Right-side tool row */}
        <View style={styles.editToolRow}>
          <TouchableOpacity style={styles.camIconBtn} onPress={() => { setTextDraft(''); setTextDraftColor('#FFFFFF'); setTextDraftFontIdx(0); setTextDraftAlign('center'); setTextDraftBg(false); setTextToolOpen(true); }} accessibilityLabel="Add text" accessibilityRole="button">
            <Text style={styles.aaIcon}>Aa</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.camIconBtn} onPress={() => { hapticLight(); setStickerSheetOpen(true); }} accessibilityLabel="Add sticker" accessibilityRole="button">
            <Feather name="smile" size={20} color={ON_DARK} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.camIconBtn} onPress={() => { hapticLight(); setDrawOpen((v) => !v); }} accessibilityLabel="Draw" accessibilityRole="button">
            <Feather name="edit-2" size={20} color={drawOpen ? theme.accent : ON_DARK} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.camIconBtn}
            onPress={() => Alert.alert('More tools', 'Additional tools are coming soon.')}
            accessibilityLabel="More tools"
            accessibilityRole="button"
          >
            <Feather name="more-horizontal" size={20} color={ON_DARK} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Draw sub-toolbar */}
      {drawOpen ? (
        <View style={[styles.drawBar, { top: insets.top + 60 }]}>
          {['#FFFFFF', '#000000', '#F87171', '#FBBF24', '#34D399', '#60A5FA'].map((c) => (
            <TouchableOpacity key={c} style={[styles.drawColorDot, { backgroundColor: c }, drawColor === c && styles.drawColorDotActive]} onPress={() => setDrawColor(c)} accessibilityLabel={`Draw color ${c}`} accessibilityRole="button" />
          ))}
          <View style={styles.drawDivider} />
          {[2, 4, 8].map((w) => (
            <TouchableOpacity key={w} style={styles.drawWidthBtn} onPress={() => setDrawWidth(w)} accessibilityLabel={`Brush size ${w}`} accessibilityRole="button">
              <View style={{ width: w + 4, height: w + 4, borderRadius: 8, backgroundColor: drawWidth === w ? theme.accent : 'rgba(255,255,255,0.6)' }} />
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.drawUndo} disabled={!strokes.length} onPress={() => setStrokes((p) => p.slice(0, -1))} accessibilityLabel="Undo last stroke" accessibilityRole="button">
            <Feather name="rotate-ccw" size={16} color={strokes.length ? ON_DARK : 'rgba(255,255,255,0.3)'} />
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Bottom bar */}
      <View style={[styles.editBottom, { paddingBottom: insets.bottom + SP.md }]}>
        <View style={styles.audienceRow}>
          <View style={styles.myStoryChip}>
            <View style={styles.myAvatar}><Text style={styles.myAvatarText}>{myInitials}</Text></View>
            <Text style={styles.myStoryLabel}>Your story</Text>
          </View>
          <View style={styles.closeFriendsChip}>
            <Feather name="star" size={13} color={closeFriendsOnly ? '#34D399' : 'rgba(255,255,255,0.6)'} />
            <Text style={[styles.closeFriendsLabel, closeFriendsOnly && { color: '#34D399' }]}>Close Friends</Text>
            <HapticSwitch value={closeFriendsOnly} onValueChange={setCloseFriendsOnly} trackColor={{ false: BORDER, true: '#34D399' }} thumbColor={ON_DARK} />
          </View>
          <PressableScale
            style={[styles.sendBtn, isPosting && { opacity: 0.6 }]}
            onPress={() => { hapticPrimaryAction(); shareFromEdit(); }}
            disabled={isPosting}
            accessibilityRole="button"
            accessibilityLabel={isPosting ? 'Posting story' : 'Send story'}
          >
            {isPosting ? <Feather name="loader" size={20} color="#000" /> : <Feather name="arrow-up" size={20} color="#000" />}
          </PressableScale>
        </View>
      </View>

      {/* ── Text tool overlay ── */}
      <Modal visible={textToolOpen} transparent animationType="fade" onRequestClose={() => setTextToolOpen(false)}>
        <View style={styles.textToolBackdrop}>
          <View style={[styles.textToolTop, { paddingTop: insets.top + SP.sm }]}>
            <TouchableOpacity onPress={() => setTextToolOpen(false)} accessibilityLabel="Cancel" accessibilityRole="button">
              <Text style={styles.textToolCancel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={commitTextOverlay} accessibilityLabel="Done" accessibilityRole="button">
              <Text style={styles.textToolDone}>Done</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.textToolCenter}>
            <TextInput
              autoFocus
              multiline
              value={textDraft}
              onChangeText={setTextDraft}
              placeholder="Say something…"
              placeholderTextColor="rgba(255,255,255,0.4)"
              style={[
                styles.textToolInput,
                {
                  color: textDraftBg ? (textDraftColor === '#FFFFFF' ? '#000' : textDraftColor) : textDraftColor,
                  backgroundColor: textDraftBg ? (textDraftColor === '#FFFFFF' ? '#FFFFFF' : 'rgba(255,255,255,0.9)') : 'transparent',
                  textAlign: textDraftAlign,
                  fontWeight: FONT_PRESETS[textDraftFontIdx].weight,
                  fontStyle: FONT_PRESETS[textDraftFontIdx].italic ? 'italic' : 'normal',
                },
              ]}
              maxLength={200}
            />
          </View>
          <View style={[styles.textToolBottom, { paddingBottom: insets.bottom + SP.md }]}>
            <View style={styles.textToolRow}>
              <TouchableOpacity style={styles.textToolChip} onPress={() => setTextDraftFontIdx((i) => (i + 1) % FONT_PRESETS.length)} accessibilityLabel="Cycle font" accessibilityRole="button">
                <Text style={styles.textToolChipText}>Aa</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.textToolChip}
                onPress={() => setTextDraftAlign((a) => (a === 'left' ? 'center' : a === 'center' ? 'right' : 'left'))}
                accessibilityLabel={`Alignment ${textDraftAlign}`}
                accessibilityRole="button"
              >
                <Feather name={textDraftAlign === 'left' ? 'align-left' : textDraftAlign === 'right' ? 'align-right' : 'align-center'} size={18} color={ON_DARK} />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.textToolChip, textDraftBg && { backgroundColor: theme.accentDim }]} onPress={() => setTextDraftBg((v) => !v)} accessibilityLabel="Toggle background highlight" accessibilityRole="button">
                <Feather name="square" size={18} color={ON_DARK} />
              </TouchableOpacity>
            </View>
            <View style={styles.textToolColorRow}>
              {['#FFFFFF', '#000000', '#F87171', '#FBBF24', '#34D399', '#60A5FA', '#C084FC'].map((c) => (
                <PressableScale
                  key={c}
                  style={[styles.colorCircle, { backgroundColor: c }, textDraftColor === c && styles.colorCircleActive, c === '#000000' && styles.colorCircleBorder]}
                  onPress={() => setTextDraftColor(c)}
                  accessibilityRole="button"
                  accessibilityLabel={`Text color ${c}`}
                />
              ))}
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Sticker sheet ── */}
      <Modal visible={stickerSheetOpen} transparent animationType="slide" onRequestClose={() => setStickerSheetOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setStickerSheetOpen(false)} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[styles.stickerSheet, { paddingBottom: insets.bottom + SP.md }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Stickers</Text>
          <View style={styles.stickerGrid}>
            <StickerTile icon="at-sign" label="Mention" onPress={() => { addOverlay({ type: 'mention', mentionHandle: '@friend' }); setStickerSheetOpen(false); }} />
            <StickerTile icon="map-pin" label="Location" onPress={() => { addOverlay({ type: 'location', locationLabel: 'Add location' }); setStickerSheetOpen(false); }} />
            <StickerTile icon="clock" label="Time" onPress={() => { addOverlay({ type: 'time', text: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }); setStickerSheetOpen(false); }} />
            <StickerTile icon="bar-chart-2" label="Poll" onPress={() => { addOverlay({ type: 'poll', pollQuestion: 'This or that?', pollOptions: [{ label: 'This', votes: 0 }, { label: 'That', votes: 0 }] }); setStickerSheetOpen(false); }} />
            <StickerTile icon="help-circle" label="Question" onPress={() => { addOverlay({ type: 'question', questionPrompt: 'Ask me anything' }); setStickerSheetOpen(false); }} />
            <StickerTile icon="link" label="Link" onPress={() => { addOverlay({ type: 'link', linkUrl: 'https://', linkText: 'Link' }); setStickerSheetOpen(false); }} />
            {isSeller ? (
              <StickerTile icon="shopping-bag" label="Product" onPress={() => { setStickerSheetOpen(false); openProductPicker(); }} />
            ) : null}
            {isSeller ? (
              <StickerTile icon="external-link" label="Shop link" onPress={() => { setStickerSheetOpen(false); setShopUrlDraft(''); setShopModalOpen(true); }} />
            ) : null}
            <StickerTile
              icon="dollar-sign"
              label="Thread Cash"
              custom={<ThreadCashBillIcon size={26} />}              onPress={() => { addOverlay({ type: 'threadcash', text: 'Thread Cash' }); setStickerSheetOpen(false); }}
            />
          </View>
        </View>
      </Modal>

      {/* ── Product tag picker (sellers) ── */}
      <Modal visible={productPickerOpen} transparent animationType="slide" onRequestClose={() => setProductPickerOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setProductPickerOpen(false)} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[styles.stickerSheet, { paddingBottom: insets.bottom + SP.md, maxHeight: '65%' }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Tag a product</Text>
          <ScrollView>
            {taggableProducts.length === 0 ? (
              <Text style={styles.emptyText}>No products to tag yet.</Text>
            ) : taggableProducts.map((p) => (
              <PressableScale
                key={p.id}
                style={styles.productRow}
                onPress={() => {
                  hapticLight();
                  addOverlay({
                    type: 'product',
                    productId: p.id,
                    productName: p.name,
                    productImageUri: p.media?.[0]?.uri,
                    productPriceCents: p.pricing?.priceCents,
                  });
                  setProductPickerOpen(false);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Tag ${p.name}`}
              >
                <Text style={styles.productRowText}>{p.name}</Text>
                <Feather name="chevron-right" size={16} color={MUTED} />
              </PressableScale>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* ── Shop-link modal (sellers) ── */}
      <Modal visible={shopModalOpen} transparent animationType="fade" onRequestClose={() => setShopModalOpen(false)}>
        <View style={styles.overlayModalBackdrop}>
          <View style={styles.overlayModalCard}>
            <Text style={styles.sheetTitle}>Add a shop link</Text>
            <TextInput
              style={styles.shopInput}
              value={shopUrlDraft}
              onChangeText={setShopUrlDraft}
              placeholder="https://your-shop.com/…"
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoFocus
              autoCapitalize="none"
              keyboardType="url"
            />
            <View style={styles.overlayModalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShopModalOpen(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalAddBtn, { backgroundColor: theme.accent }]}
                onPress={() => {
                  if (shopUrlDraft.trim()) addOverlay({ type: 'shop', shopUrl: shopUrlDraft.trim(), shopLabel: 'Visit shop' });
                  setShopModalOpen(false);
                }}
              >
                <Text style={[styles.modalAddText, getOnAccentTextStyle(theme)]}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Sticker tile ────────────────────────────────────────────────────────────
function StickerTile({ icon, label, onPress, custom }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void; custom?: React.ReactNode }) {
  return (
    <PressableScale style={styles.stickerTile} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      {custom ?? <Feather name={icon} size={22} color={ON_DARK} />}
      <Text style={styles.stickerTileLabel}>{label}</Text>
    </PressableScale>
  );
}

// ─── Overlay content renderer (edit-screen canvas) ──────────────────────────
function renderOverlayContent(ov: StoryOverlay) {
  switch (ov.type) {
    case 'text':
      return <Text style={{ color: ov.color ?? '#FFF', fontSize: ov.size ?? 28, fontFamily: FONT.bold, textAlign: ov.align ?? 'center' }}>{ov.text}</Text>;
    case 'mention':
      return <View style={styles.pillChip}><Feather name="at-sign" size={12} color="#fff" /><Text style={styles.pillChipText}>{ov.mentionHandle}</Text></View>;
    case 'location':
      return <View style={styles.pillChip}><Feather name="map-pin" size={12} color="#fff" /><Text style={styles.pillChipText}>{ov.locationLabel}</Text></View>;
    case 'time':
      return <View style={styles.pillChip}><Feather name="clock" size={12} color="#fff" /><Text style={styles.pillChipText}>{ov.text}</Text></View>;
    case 'question':
      return (
        <View style={styles.questionCard}>
          <Text style={styles.questionCardTitle}>{ov.questionPrompt}</Text>
          <View style={styles.questionInputMock}><Text style={styles.questionInputMockText}>Type your answer…</Text></View>
        </View>
      );
    case 'poll':
      return (
        <View style={styles.pollCard}>
          <Text style={styles.pollQuestion}>{ov.pollQuestion}</Text>
          <View style={styles.pollOptionsRow}>
            {(ov.pollOptions ?? []).map((o, i) => (
              <View key={i} style={styles.pollOption}><Text style={styles.pollOptionText}>{o.label}</Text></View>
            ))}
          </View>
        </View>
      );
    case 'link':
      return <View style={styles.pillChip}><Feather name="link-2" size={12} color="#fff" /><Text style={styles.pillChipText}>{ov.linkText || ov.linkUrl}</Text></View>;
    case 'shop':
      return <View style={styles.pillChip}><Feather name="external-link" size={12} color="#fff" /><Text style={styles.pillChipText}>{ov.shopLabel || ov.shopUrl}</Text></View>;
    case 'product':
      return (
        <View style={styles.productCard}>
          {ov.productImageUri ? <Image source={{ uri: ov.productImageUri }} style={styles.productCardImg} /> : <View style={[styles.productCardImg, { backgroundColor: '#333' }]} />}
          <View style={{ marginLeft: 8, maxWidth: 130 }}>
            <Text style={styles.productCardName} numberOfLines={1}>{ov.productName}</Text>
            {typeof ov.productPriceCents === 'number' ? <Text style={styles.productCardPrice}>${(ov.productPriceCents / 100).toFixed(2)}</Text> : null}
          </View>
        </View>
      );
    case 'threadcash':
      return <View style={styles.pillChip}><ThreadCashBillIcon size={16} /><Text style={styles.pillChipText}>{ov.text}</Text></View>;    default:
      return null;
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  webFallback: { alignItems: 'center', justifyContent: 'center', gap: SP.md, paddingHorizontal: 32 },
  webFallbackText: { color: 'rgba(255,255,255,0.7)', fontSize: FS.sm, textAlign: 'center', lineHeight: 20 },
  permBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: RADIUS.md },
  permBtnText: { fontFamily: FONT.semibold, fontSize: FS.base },

  camTopBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md,
  },
  camIconBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  editToolRow: { flexDirection: 'row', gap: SP.sm },

  leftRail: { position: 'absolute', left: SP.md, zIndex: 20 },
  railBtn: { alignItems: 'center', gap: 4, width: 52, minHeight: 44 },
  railAa: { color: ON_DARK, fontSize: FS.lg, fontFamily: FONT.bold },
  railLabel: { color: 'rgba(255,255,255,0.85)', fontSize: FS.xs, fontFamily: FONT.medium },

  camBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 20, alignItems: 'center' },
  modeRow: { flexDirection: 'row', gap: SP.lg, marginBottom: SP.md },
  modeItem: { minWidth: 44, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  modeText: { color: 'rgba(255,255,255,0.5)', fontSize: FS.sm, fontFamily: FONT.semibold, letterSpacing: 0.5 },
  modeTextActive: { color: ON_DARK, fontSize: FS.base },
  modeTextDisabled: { color: 'rgba(255,255,255,0.25)' },

  controlsRow: {
    width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: SP.xl, marginBottom: SP.sm,
  },
  galleryThumb: {
    width: 44, height: 44, borderRadius: RADIUS.sm, overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  galleryThumbImg: { width: '100%', height: '100%' },
  shutterWrap: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center' },
  shutterRing: {
    width: 80, height: 80, borderRadius: 40, borderWidth: 3.5, borderColor: ON_DARK,
    alignItems: 'center', justifyContent: 'center',
  },
  progressRing: {
    position: 'absolute', width: 80, height: 80, borderRadius: 40,
    borderWidth: 3.5, borderColor: '#F87171', borderLeftColor: 'transparent', borderBottomColor: 'transparent',
  },
  shutterInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: ON_DARK },
  flipBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  hint: { color: 'rgba(255,255,255,0.5)', fontSize: FS.xs, marginBottom: SP.xs },

  // Create mode
  createCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl },
  createInput: { fontFamily: FONT.bold, minWidth: 60, textAlignVertical: 'center' },
  createToolbar: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', gap: SP.md, justifyContent: 'center', alignItems: 'center' },
  createToolBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  createToolAa: { color: ON_DARK, fontSize: FS.base },
  colorCircle: { width: 28, height: 28, borderRadius: 14 },
  colorCircleActive: { borderWidth: 2, borderColor: ON_DARK },
  colorCircleBorder: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  bgSwatchRow: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', gap: SP.sm, justifyContent: 'center' },
  bgSwatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  bgSwatchActive: { borderWidth: 2.5, borderColor: ON_DARK },

  shareBtn: { borderRadius: RADIUS.pill, paddingHorizontal: SP.lg, paddingVertical: SP.sm },
  shareBtnText: { fontFamily: FONT.semibold, fontSize: FS.base },

  overlayChip: { position: 'absolute', top: 0, left: 0, zIndex: 15 },
  aaIcon: { color: ON_DARK, fontSize: FS.md, fontFamily: FONT.bold },

  drawBar: {
    position: 'absolute', left: SP.md, right: SP.md, zIndex: 25,
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: RADIUS.pill, paddingHorizontal: SP.sm, paddingVertical: SP.xs,
  },
  drawColorDot: { width: 22, height: 22, borderRadius: 11 },
  drawColorDotActive: { borderWidth: 2, borderColor: ON_DARK },
  drawDivider: { width: 1, height: 18, backgroundColor: 'rgba(255,255,255,0.25)' },
  drawWidthBtn: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  drawUndo: { marginLeft: 'auto', width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },

  editBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 20, paddingHorizontal: SP.md },
  audienceRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  myStoryChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: RADIUS.pill, paddingHorizontal: SP.sm, paddingVertical: 6 },
  myAvatar: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#444', alignItems: 'center', justifyContent: 'center' },
  myAvatarText: { color: ON_DARK, fontSize: 10, fontFamily: FONT.bold },
  myStoryLabel: { color: ON_DARK, fontSize: FS.xs, fontFamily: FONT.semibold },
  closeFriendsChip: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: RADIUS.pill, paddingHorizontal: SP.sm, paddingVertical: 6 },
  closeFriendsLabel: { color: 'rgba(255,255,255,0.75)', fontSize: FS.xs, fontFamily: FONT.medium, flex: 1 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: ON_DARK, alignItems: 'center', justifyContent: 'center' },

  // Text tool
  textToolBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)' },
  textToolTop: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: SP.md },
  textToolCancel: { color: 'rgba(255,255,255,0.7)', fontSize: FS.base, fontFamily: FONT.medium },
  textToolDone: { color: ON_DARK, fontSize: FS.base, fontFamily: FONT.bold },
  textToolCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl },
  textToolInput: { fontSize: 30, fontFamily: FONT.bold, minWidth: 60, paddingHorizontal: 8, borderRadius: 6 },
  textToolBottom: { paddingHorizontal: SP.md, gap: SP.sm },
  textToolRow: { flexDirection: 'row', gap: SP.sm },
  textToolChip: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  textToolChipText: { color: ON_DARK, fontSize: FS.base, fontFamily: FONT.bold },
  textToolColorRow: { flexDirection: 'row', gap: SP.sm },

  // Sticker sheet
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  stickerSheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: CARD, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: SP.md },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: SP.sm },
  sheetTitle: { color: FG, fontFamily: FONT.semibold, fontSize: FS.md, marginBottom: SP.md },
  stickerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  stickerTile: { width: 78, height: 78, borderRadius: RADIUS.md, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center', gap: 6 },
  stickerTileLabel: { color: ON_DARK, fontSize: FS.xs, fontFamily: FONT.medium },
  emptyText: { color: MUTED, fontSize: FS.sm, textAlign: 'center', padding: SP.lg },
  productRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER },
  productRowText: { color: FG, fontSize: FS.base, fontFamily: FONT.medium },

  overlayModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  overlayModalCard: { width: W - SP.xl * 2, backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, padding: SP.md },
  shopInput: { color: ON_DARK, fontSize: FS.md, borderBottomWidth: 1, borderBottomColor: BORDER, paddingVertical: SP.sm },
  overlayModalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: SP.sm, marginTop: SP.md },
  modalCancelBtn: { paddingHorizontal: SP.md, paddingVertical: SP.sm },
  modalCancelText: { color: MUTED, fontFamily: FONT.medium },
  modalAddBtn: { paddingHorizontal: SP.lg, paddingVertical: SP.sm, borderRadius: RADIUS.md },
  modalAddText: { fontFamily: FONT.semibold },

  // Overlay content chrome
  pillChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: RADIUS.pill, paddingHorizontal: 12, paddingVertical: 7 },
  pillChipText: { color: '#fff', fontSize: FS.sm, fontFamily: FONT.semibold },
  questionCard: { backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: RADIUS.md, padding: SP.md, width: 240 },
  questionCardTitle: { color: '#000', fontFamily: FONT.bold, fontSize: FS.base, marginBottom: SP.sm, textAlign: 'center' },
  questionInputMock: { backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: RADIUS.pill, paddingVertical: 8, alignItems: 'center' },
  questionInputMockText: { color: 'rgba(0,0,0,0.4)', fontSize: FS.sm },
  pollCard: { backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: RADIUS.md, padding: SP.md, width: 220 },
  pollQuestion: { color: '#fff', fontFamily: FONT.bold, fontSize: FS.base, marginBottom: SP.sm, textAlign: 'center' },
  pollOptionsRow: { gap: 6 },
  pollOption: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: RADIUS.pill, paddingVertical: 8, alignItems: 'center' },
  pollOptionText: { color: '#fff', fontSize: FS.sm, fontFamily: FONT.medium },
  productCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: RADIUS.md, padding: 8, maxWidth: 220 },
  productCardImg: { width: 40, height: 40, borderRadius: RADIUS.sm },
  productCardName: { color: '#000', fontFamily: FONT.semibold, fontSize: FS.sm },
  productCardPrice: { color: '#555', fontFamily: FONT.medium, fontSize: FS.xs },
});
