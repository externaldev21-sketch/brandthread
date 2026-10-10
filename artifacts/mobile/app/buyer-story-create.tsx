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
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  ActivityIndicator, Alert, Animated, Dimensions, Image, KeyboardAvoidingView, Linking, Modal, PanResponder, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { captureRef } from 'react-native-view-shot';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useUser } from '@clerk/expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle, Path } from 'react-native-svg';
import {
  CARD, BORDER, FG, MUTED, ON_DARK, FONT, FS, SP, RADIUS, TEXT_SECONDARY, TEXT_TERTIARY,
} from '@/lib/theme';
import { createStory, searchProfiles, createOrGetConversation, sendMessage } from '@/services/socialService';
import type { ProfileSearchResult } from '@/services/socialTypes';
import { useApi } from '@/lib/api';
import type { StoryMedia, StoryOverlay, StoryOverlayType, StoryPrivacySettings } from '@/services/socialTypes';
import { useAppTheme, getOnAccentTextStyle } from '@/contexts/AppThemeContext';
import { useRole } from '@/contexts/RoleContext';
import { getTaggableProducts } from '@/services/productService';
import type { Product } from '@/services/productTypes';
import { PressableScale } from '@/components/BrandthreadUI';
import { Button } from '@/components/ui/Button';
import { hapticLight, hapticToggle, hapticPrimaryAction, hapticSuccessAction } from '@/lib/haptics';
import { ThreadCashBillIcon } from '@/components/thread-cash/ThreadCashBill';
import { TEXT_FONTS, storyFontFamily, loadStoryFontsAsync, type StoryFontKey } from '@/lib/storyFonts';
import { startUploadActivity, updateUploadActivity, endUploadActivity } from '@/lib/uploadLiveActivity';
import { WEB_INPUT_RESET } from '@/lib/inputReset';
import { MediaCropper } from '@/components/media/MediaCropper';
import { applyCropRect, type NormalizedCropRect } from '@/lib/mediaCrop';
import { ModalSafeArea } from '@/components/ModalSafeArea';
import { MentionPickerSheet, MentionSuggestionsBar } from '@/components/MentionPickerSheet';
import { PollSticker, QuestionSticker, ProductSticker, CountdownSticker, STICKER } from '@/components/social/StoryStickers';
import { PollComposer, QuestionComposer, CountdownPicker } from '@/components/social/StoryStickerComposer';
import { MentionStickerView, ReshareCard, RESHARE_CARD_WIDTH, RESHARE_CARD_HEIGHT } from '@/components/StoryMentionSticker';
import { InlineSlider } from '@/components/InlineSlider';
import {
  MAX_MENTIONS_PER_STORY, MENTION_MIN_SCALE, activeMentionQuery, clampMentionOpacity, clampOverlayPosition, clampOverlayScale,
  insertMention, nextMentionStyle, tapSlop, taggedPeople, withAt,
} from '@/lib/storyMentionSticker';
import { RESHARE_CARD_RADIUS, RESHARE_FALLBACK_COLORS, reshareGradientFromBackground, sampleImageColor } from '@/lib/storyReshare';
import type { MentionPerson } from '@/services/socialTypes';
import { radius } from '@/constants/radii';
import { getMediaLibrary } from '@/lib/mediaLibraryCompat';
const { width: W, height: H } = Dimensions.get('window');
const IS_WEB = Platform.OS === 'web';
const MAX_VIDEO_SECONDS = 15;

type Step = 'camera' | 'create' | 'edit';
type CaptureMode = 'story' | 'post' | 'live';
type CapturedMedia = {
  kind: 'photo' | 'video'; uri: string;
  originalUri?: string; cropRect?: NormalizedCropRect;
};
type SharePayload = { type: 'photo' | 'video' | 'text'; uri?: string; bg?: string; text?: string; textColor?: string; ovs: StoryOverlay[] };

const firstParam = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

// ─── Layout capture grids — Instagram's 6-option "Changing grid" popover ───
type GridSpec = { id: string; cols: number; rows: number };
const GRID_SPECS: GridSpec[] = [
  { id: '2x1', cols: 1, rows: 2 },
  { id: '1x2', cols: 2, rows: 1 },
  { id: '3x1', cols: 1, rows: 3 },
  { id: '1x3', cols: 3, rows: 1 },
  { id: '2x2', cols: 2, rows: 2 },
  { id: '3x2', cols: 3, rows: 2 },
];

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
// Mention stickers are tags first, so they break the usual limits: scale goes
// down to 0.05, the drag is never clamped into the safe area (see
// clampOverlayPosition), the touch target never drops below 44pt on screen
// (hitSlop grows as the sticker shrinks), and a dashed outline marks it when
// selected so a speck or an edge-tucked sticker can always be found again.
function OverlayChip({
  overlay, canvasSize, onChange, onRemove, onTap, selected, removable = true, children,
}: {
  overlay: StoryOverlay;
  canvasSize: { width: number; height: number };
  onChange: (id: string, patch: Partial<StoryOverlay>) => void;
  onRemove: (id: string) => void;
  onTap?: (id: string) => void;
  selected?: boolean;
  /** false for the reshare card — it can move/scale but not be deleted. */
  removable?: boolean;
  children: React.ReactNode;
}) {
  const pan = useRef(new Animated.ValueXY({ x: overlay.x, y: overlay.y })).current;
  const lastPos = useRef({ x: overlay.x, y: overlay.y });
  const scaleRef = useRef(overlay.scale ?? 1);
  const rotationRef = useRef(overlay.rotation ?? 0);
  const [scale, setScale] = useState(scaleRef.current);
  const [rotation, setRotation] = useState(rotationRef.current);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const pinchStartDist = useRef<number | null>(null);
  const pinchStartAngle = useRef<number | null>(null);
  const pinchStartScale = useRef(1);
  const pinchStartRotation = useRef(0);
  const movedRef = useRef(false);
  // The responder below is created once, so read everything that can change
  // (handlers, canvas size) through a ref.
  const latest = useRef({ overlay, canvasSize, onChange, onTap });
  latest.current = { overlay, canvasSize, onChange, onTap };
  const isMention = overlay.type === 'mention';

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
          const nextScale = clampOverlayScale(latest.current.overlay.type, pinchStartScale.current * (dist / Math.max(1, pinchStartDist.current)));
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
        const { overlay: ov, canvasSize: canvas, onChange: change } = latest.current;
        if (pinchStartDist.current != null) {
          pinchStartDist.current = null;
          pinchStartAngle.current = null;
          change(ov.id, { scale: scaleRef.current, rotation: rotationRef.current });
          return;
        }
        pan.flattenOffset();
        // @ts-ignore — internal but stable, matches DraggableOverlay pattern elsewhere in this screen family
        const rawX = (pan.x as any)._value as number;
        // @ts-ignore
        const rawY = (pan.y as any)._value as number;
        const { x, y } = clampOverlayPosition(ov.type, { x: rawX, y: rawY }, canvas, sizeRef.current);
        pan.setValue({ x, y });
        lastPos.current = { x, y };
        if (movedRef.current) change(ov.id, { x, y });
      },
    }),
  ).current;

  const slop = isMention ? tapSlop(size, scale) : null;
  return (
    <Animated.View
      {...dragResponder.panHandlers}
      testID={`story-overlay-${overlay.id}`}
      onLayout={isMention ? (e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height }) : undefined}
      hitSlop={slop ? { left: slop.x, right: slop.x, top: slop.y, bottom: slop.y } : undefined}
      style={[
        styles.overlayChip,
        isMention && { opacity: clampMentionOpacity(overlay.opacity) },
        { transform: [...pan.getTranslateTransform(), { scale }, { rotate: `${rotation}deg` }] },
      ]}
    >
      {isMention && selected && slop ? (
        <View
          pointerEvents="none"
          style={[styles.selectionOutline, {
            left: -slop.x, right: -slop.x, top: -slop.y, bottom: -slop.y,
            // keep the outline ~1.5pt on screen however far the sticker is zoomed out
            borderWidth: 1.5 / Math.max(scale, MENTION_MIN_SCALE),
            borderRadius: 10 / Math.max(scale, MENTION_MIN_SCALE),
          }]}
        />
      ) : null}
      {/* A plain tap lands on this Pressable (the pan responder above only takes over once the finger moves or a second finger lands). */}
      <Pressable
        onPress={() => latest.current.onTap?.(overlay.id)}
        onLongPress={removable ? () => { hapticLight(); onRemove(overlay.id); } : undefined}
        // No button role on the reshare card: its credit row is a button and web forbids nested <button>s.
        accessibilityRole={removable ? 'button' : undefined}
        accessibilityLabel={removable ? 'Long-press to remove' : 'Drag to move'}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

// ─── Posting-progress toast ─────────────────────────────────────────────────
// Matches Instagram's own "Your story is uploading… NN%" pill: a thumbnail,
// the label, and a ring that fills as `percent` climbs to 100.
const RING_SIZE = 22;
const RING_STROKE = 2.5;
const RING_R = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRC = 2 * Math.PI * RING_R;

function PostingToast({ percent, topInset }: { percent: number; topInset: number }) {
  return (
    <View pointerEvents="none" style={[postingStyles.wrap, { top: topInset + SP.sm }]}>
      <View style={postingStyles.pill}>
        <Text style={postingStyles.label}>Your story is uploading…</Text>
        <View style={{ width: RING_SIZE, height: RING_SIZE }}>
          <Svg width={RING_SIZE} height={RING_SIZE}>
            <Circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_R}
              stroke="rgba(255,255,255,0.25)"
              strokeWidth={RING_STROKE}
              fill="none"
            />
            <Circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_R}
              stroke="#FFFFFF"
              strokeWidth={RING_STROKE}
              fill="none"
              strokeDasharray={`${RING_CIRC}, ${RING_CIRC}`}
              strokeDashoffset={RING_CIRC * (1 - percent / 100)}
              strokeLinecap="round"
              transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
            />
          </Svg>
          <Text style={postingStyles.percent}>{percent}</Text>
        </View>
      </View>
    </View>
  );
}

const postingStyles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 50 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    backgroundColor: 'rgba(0,0,0,0.85)', borderRadius: RADIUS.pill,
    paddingHorizontal: SP.md, paddingVertical: SP.sm,
  },
  label: { color: ON_DARK, fontSize: FS.sm, fontFamily: FONT.semibold },
  percent: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    textAlign: 'center', textAlignVertical: 'center',
    color: ON_DARK, fontSize: 9, fontFamily: FONT.semibold,
  },
});

// ─── Grid-layout option icon (camera Layout popover) ───────────────────────
function GridIcon({ spec, active }: { spec: GridSpec; active: boolean }) {
  const cells = [];
  for (let i = 0; i < spec.cols * spec.rows; i++) cells.push(i);
  return (
    <View style={{ width: 24, height: 24, flexDirection: 'row', flexWrap: 'wrap', borderRadius: 3, overflow: 'hidden', borderWidth: active ? 1.5 : 1, borderColor: active ? '#FFFFFF' : 'rgba(255,255,255,0.4)' }}>
      {cells.map((i) => (
        <View
          key={i}
          style={{
            width: `${100 / spec.cols}%`,
            height: `${100 / spec.rows}%`,
            borderWidth: 0.5,
            borderColor: 'rgba(255,255,255,0.3)',
            backgroundColor: active ? 'rgba(255,255,255,0.25)' : 'transparent',
          }}
        />
      ))}
    </View>
  );
}

// ─── Vertical size slider (text tool, left edge) ───────────────────────────
function VerticalSizeSlider({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  const trackHeight = useRef(0);
  const frac = (value - min) / (max - min);
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_e, g) => {
        const h = trackHeight.current;
        if (!h) return;
        // g.moveY is absolute; approximate via accumulated dy against the last frac.
        const delta = -g.dy / h;
        const next = Math.max(min, Math.min(max, value + delta * (max - min)));
        onChange(Math.round(next));
      },
    }),
  ).current;

  return (
    <View
      style={styles.sizeSlider}
      onLayout={(e) => { trackHeight.current = e.nativeEvent.layout.height; }}
      {...responder.panHandlers}
    >
      <View style={styles.sizeSliderTrack} />
      <View style={[styles.sizeSliderThumb, { top: `${(1 - frac) * 100}%`, marginTop: -11 }]} />
    </View>
  );
}

// ─── HSB color picker (text/draw color sheets) ──────────────────────────────
function hsbToHex(h: number, s: number, b: number): string {
  const c = (b / 100) * (s / 100);
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = b / 100 - c;
  let [r, g, bl] = [0, 0, 0];
  if (h < 60) [r, g, bl] = [c, x, 0];
  else if (h < 120) [r, g, bl] = [x, c, 0];
  else if (h < 180) [r, g, bl] = [0, c, x];
  else if (h < 240) [r, g, bl] = [0, x, c];
  else if (h < 300) [r, g, bl] = [x, 0, c];
  else [r, g, bl] = [c, 0, x];
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(bl)}`.toUpperCase();
}

function HsbSlider({ label, value, max, colors, onChange }: {
  label: string; value: number; max: number; colors: readonly [string, string, ...string[]]; onChange: (v: number) => void;
}) {
  const trackWidth = useRef(0);
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (e) => {
        const w = trackWidth.current;
        if (!w) return;
        // locationX is relative to the track view itself.
        const x = Math.max(0, Math.min(w, e.nativeEvent.locationX));
        onChange(Math.round((x / w) * max));
      },
    }),
  ).current;
  const frac = value / max;
  return (
    <View>
      <Text style={styles.hsbLabel}>{label}</Text>
      <View
        style={styles.hsbTrack}
        onLayout={(e) => { trackWidth.current = e.nativeEvent.layout.width; }}
        {...responder.panHandlers}
      >
        <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[StyleSheet.absoluteFill, { borderRadius: 14 }]} />
        <View style={[styles.hsbThumb, { left: `${frac * 100}%`, marginLeft: -11 }]} />
      </View>
    </View>
  );
}

function HsbPicker({ color, onChange }: { color: string; onChange: (hex: string) => void }) {
  const [hue, setHue] = useState(0);
  const [sat, setSat] = useState(100);
  const [bri, setBri] = useState(100);
  const commit = (h: number, s: number, b: number) => onChange(hsbToHex(h, s, b));
  return (
    <View style={styles.hsbPicker}>
      <HsbSlider label="Hue" value={hue} max={359} colors={['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF', '#FF0000']} onChange={(v) => { setHue(v); commit(v, sat, bri); }} />
      <HsbSlider label="Saturation" value={sat} max={100} colors={['#FFFFFF', color]} onChange={(v) => { setSat(v); commit(hue, v, bri); }} />
      <HsbSlider label="Brightness" value={bri} max={100} colors={['#000000', color]} onChange={(v) => { setBri(v); commit(hue, sat, v); }} />
    </View>
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
  // On web the safe-area inset can under-report how much the browser chrome
  // (or a notch-simulating preview frame) actually occupies, which is what
  // let the X/flash/settings row render under the notch at ~28px. Floor it
  // at 54 on web only — native insets are already correct.
  const topInset = useHeaderTopInset();
  const router = useRouter();
  const { user } = useUser();
  const { theme } = useAppTheme();
  const api = useApi();
  // The real signed-in role (seller preview counts as seller — RoleContext
  // handles that), NOT an `accountType` route param: every seller entry
  // point (camera-capture.tsx, create-post.tsx) pushes this route with no
  // such param, so a seller landed here always saw POST/STORY only — LIVE
  // never showed no matter the account, and a seller's story/post got
  // attributed as `authorAccountType: 'buyer'`. Used for every seller-only
  // decision in this screen: the LIVE mode item, the Product/Shop-link
  // stickers, and what account type gets forwarded/recorded.
  const { role } = useRole();
  const isSeller = role === 'seller';

  const myName = user?.fullName || user?.firstName || user?.username || 'You';
  const myHandle = user?.username ? `@${user.username}` : '';
  const myInitials = myName.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase() || 'Y';

  // Reshare ("Add to your story" from a story that tagged me): skips the camera
  // and opens the editor on a text-type slide holding the original as a card.
  const params = useLocalSearchParams<{ reshareStoryId?: string; reshareImage?: string; reshareHandle?: string; reshareSlide?: string }>();
  const reshareStoryId = firstParam(params.reshareStoryId);
  const reshareImage = firstParam(params.reshareImage);
  const reshareHandle = firstParam(params.reshareHandle);
  const isReshare = !!reshareStoryId;
  const [reshareBg, setReshareBg] = useState<string>(RESHARE_FALLBACK_COLORS[0]);
  const [reshareUnavailable, setReshareUnavailable] = useState(false);

  const [step, setStep] = useState<Step>(isReshare ? 'edit' : 'camera');

  // ── Camera state ──
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [flash, setFlash] = useState<'off' | 'on'>('off');
  const [mode, setMode] = useState<CaptureMode>('story');
  // Underline that slides to sit beneath the active mode label (Instagram/
  // TikTok's own capture-mode switch), instead of the active/inactive style
  // just swapping instantly. Purely decorative — layout/positions/behavior
  // of the row itself are unchanged.
  const [modeLayouts, setModeLayouts] = useState<Partial<Record<CaptureMode, { x: number; width: number }>>>({});
  const modeIndicatorX = useRef(new Animated.Value(0)).current;
  const modeIndicatorWidth = useRef(new Animated.Value(0)).current;
  const modeIndicatorReady = useRef(false);
  useEffect(() => {
    const layout = modeLayouts[mode];
    if (!layout) return;
    if (!modeIndicatorReady.current) {
      modeIndicatorReady.current = true;
      modeIndicatorX.setValue(layout.x);
      modeIndicatorWidth.setValue(layout.width);
      return;
    }
    Animated.parallel([
      Animated.timing(modeIndicatorX, { toValue: layout.x, duration: 150, useNativeDriver: false }),
      Animated.timing(modeIndicatorWidth, { toValue: layout.width, duration: 150, useNativeDriver: false }),
    ]).start();
  }, [mode, modeLayouts, modeIndicatorX, modeIndicatorWidth]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordProgress, setRecordProgress] = useState(0);
  const [lastGalleryUri, setLastGalleryUri] = useState<string | null>(null);
  // Instagram-style latest-photo thumbnail on the gallery button — read-only
  // (no permission prompt of its own): only checks an already-granted
  // permission so it never surprises the user with a second prompt before
  // they've tapped anything. Falls back to the icon glyph until granted or
  // if the library is empty.
  useEffect(() => {
    const MediaLibrary = IS_WEB ? null : getMediaLibrary();
    if (!MediaLibrary) return;
    void (async () => {
      try {
        const perm = await MediaLibrary.getPermissionsAsync();
        if (!perm.granted) return;
        const page = await MediaLibrary.getAssetsAsync({
          mediaType: ['photo', 'video'],
          sortBy: [[MediaLibrary.SortBy.creationTime, false]],
          first: 1,
        });
        if (page.assets[0]) setLastGalleryUri(page.assets[0].uri);
      } catch {
        // No access / no assets — keep the icon fallback.
      }
    })();
  }, []);
  const cameraRef = useRef<CameraView>(null);
  const recordingRef = useRef(false);
  const recordTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStart = useRef(0);

  // ── Camera left rail: Create / Boomerang / Layout / Hands-free ──
  const [railExpanded, setRailExpanded] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const [boomerangOn, setBoomerangOn] = useState(false);
  const [gridSpec, setGridSpec] = useState<GridSpec | null>(null);
  const [gridPopoverOpen, setGridPopoverOpen] = useState(false);
  const [gridCells, setGridCells] = useState<(string | null)[]>([]);
  const gridCompositeRef = useRef<View>(null);
  const [compositing, setCompositing] = useState(false);

  useEffect(() => {
    void (async () => {
      // expo-camera supports the browser's getUserMedia permission prompt
      // too, so this now runs on web as well as native.
      try {
        if (!cameraPermission?.granted) await requestCameraPermission();
        if (!micPermission?.granted) await requestMicPermission();
      } catch {
        // No camera device (e.g. a headless/sandboxed browser) — the
        // permission-denied fallback view covers this case either way.
      }
    })();
  }, []);

  // ── Media (captured or picked) ──
  const [media, setMedia] = useState<CapturedMedia | null>(null);
  // Stories are always 9:16 (photo or video). A freshly captured/picked photo
  // needs a crop pass before the edit step composes it; video capture is
  // already full-bleed at the device's own aspect (effectively 9:16 on
  // virtually every phone) via the camera preview and playback view, so it
  // doesn't route through the interactive cropper here — see PR notes.
  const [cropPending, setCropPending] = useState(false);

  // ── Create-mode (text-only story) state ──
  const swatches = useMemo(() => buildSwatches(theme.accent), [theme.accent]);
  const [bgIdx, setBgIdx] = useState(0);
  const [createText, setCreateText] = useState('');
  const [createColor, setCreateColor] = useState('#FFFFFF');
  const [createFontIdx, setCreateFontIdx] = useState(0);
  const [createAlign, setCreateAlign] = useState<Align>('center');

  // ── Edit-screen state ──
  const [overlays, setOverlays] = useState<StoryOverlay[]>(() => (isReshare ? [{
    id: 'ov_reshare_card',
    type: 'reshare_card',
    x: (W - RESHARE_CARD_WIDTH) / 2,
    y: Math.max(topInset + 40, (H - RESHARE_CARD_HEIGHT) / 2 - 56),
    rotation: 0,
    scale: 0.88,
    cardImageUri: reshareImage,
    cardRadius: RESHARE_CARD_RADIUS,
  }] : []));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  const [taggedSheetOpen, setTaggedSheetOpen] = useState(false);
  const [textToolOpen, setTextToolOpen] = useState(false);
  const [textDraft, setTextDraft] = useState('');
  const [textDraftColor, setTextDraftColor] = useState('#FFFFFF');
  const [textDraftFontKey, setTextDraftFontKey] = useState<StoryFontKey>('classic');
  const [textDraftSize, setTextDraftSize] = useState(30);
  const [textDraftAlign, setTextDraftAlign] = useState<Align>('center');
  const [textDraftBgStyle, setTextDraftBgStyle] = useState<'none' | 'solid' | 'translucent'>('none');
  const [textDraftEffect, setTextDraftEffect] = useState<'plain' | 'outline' | 'glow'>('plain');
  const [textDraftAnimation, setTextDraftAnimation] = useState<string | undefined>(undefined);
  const [textColorSheetOpen, setTextColorSheetOpen] = useState(false);
  const [textAnimationSheetOpen, setTextAnimationSheetOpen] = useState(false);
  const [textEffectSheetOpen, setTextEffectSheetOpen] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);
  const [stickerSheetOpen, setStickerSheetOpen] = useState(false);
  const [drawOpen, setDrawOpen] = useState(false);
  const [drawColor, setDrawColor] = useState('#FFFFFF');
  const [drawWidth, setDrawWidth] = useState(4);
  const [strokes, setStrokes] = useState<DrawStroke[]>([]);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [pollComposerOpen, setPollComposerOpen] = useState(false);
  const [questionComposerOpen, setQuestionComposerOpen] = useState(false);
  const [countdownPickerOpen, setCountdownPickerOpen] = useState(false);
  const [taggableProducts, setTaggableProducts] = useState<Product[]>([]);
  const [shopModalOpen, setShopModalOpen] = useState(false);
  const [shopUrlDraft, setShopUrlDraft] = useState('');
  const [closeFriendsOnly, setCloseFriendsOnly] = useState(false);
  const [captionDraft, setCaptionDraft] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  // Instagram's own Share sheet: tapping send opens this instead of posting
  // immediately. "Message" (send as a DM attachment before ever publishing
  // the story) is intentionally not a row here — see docs/story-flows.md.
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [pendingSharePayload, setPendingSharePayload] = useState<SharePayload | null>(null);
  // Instagram's "Also share to" sheet, shown once the story is live.
  const [alsoShareOpen, setAlsoShareOpen] = useState(false);
  const [alsoShareQuery, setAlsoShareQuery] = useState('');
  const [alsoShareResults, setAlsoShareResults] = useState<ProfileSearchResult[]>([]);
  const [alsoShareSearching, setAlsoShareSearching] = useState(false);
  const [alsoShareSendingId, setAlsoShareSendingId] = useState<string | null>(null);
  const [alsoShareSentIds, setAlsoShareSentIds] = useState<Set<string>>(new Set());
  // Drives the "Your story is uploading… NN%" pill (see doShare) — always
  // completes to 100%, same as Instagram's own composer.
  const postingProgress = useRef(new Animated.Value(0)).current;
  const [postingPercent, setPostingPercent] = useState(0);

  const canvasSize = { width: W, height: H };

  // Reshare: sample the original's dominant colour for the slide background
  // (best-effort — CORS/decode failures keep the black/silver fallback).
  useEffect(() => {
    if (!isReshare || !reshareImage) return;
    let cancelled = false;
    void sampleImageColor(reshareImage).then((hex) => { if (!cancelled && hex) setReshareBg(hex); });
    return () => { cancelled = true; };
  }, [isReshare, reshareImage]);

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

  // Boomerang: a short forward clip, same recorder as hold-to-record. True
  // bounce-loop (play forward then reverse) needs client- or server-side
  // video frame processing this session doesn't have time to build safely —
  // see docs/story-flows.md. The capture itself is real, not stubbed.
  const BOOMERANG_SECONDS = 1.5;
  const startBoomerang = useCallback(async () => {
    if (!cameraRef.current || recordingRef.current) return;
    recordingRef.current = true;
    setIsRecording(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const result = await cameraRef.current.recordAsync({ maxDuration: BOOMERANG_SECONDS });
      if (result?.uri) {
        setMedia({ kind: 'video', uri: result.uri });
        setStep('edit');
      }
    } catch {
      // Falls through — user can just try again.
    } finally {
      recordingRef.current = false;
      setIsRecording(false);
    }
    // Auto-stop after BOOMERANG_SECONDS — recordAsync's maxDuration already
    // caps it, this just guards platforms where that option is ignored.
  }, []);
  useEffect(() => {
    if (!isRecording || !boomerangOn) return;
    const t = setTimeout(() => { if (recordingRef.current) cameraRef.current?.stopRecording(); }, BOOMERANG_SECONDS * 1000 + 200);
    return () => clearTimeout(t);
  }, [isRecording, boomerangOn]);

  const compositeGrid = useCallback(async (cells: string[]) => {
    setCompositing(true);
    try {
      const uri = await captureRef(gridCompositeRef, { format: 'png', quality: 0.92, result: 'tmpfile' });
      setMedia({ kind: 'photo', uri, originalUri: uri });
      setCropPending(true);
      setStep('edit');
    } catch {
      Alert.alert('Could not combine those photos', 'Please try the layout again.');
    } finally {
      setCompositing(false);
      setGridCells([]);
      setGridSpec(null);
    }
  }, []);

  const takePhoto = useCallback(async () => {
    if (!cameraRef.current) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const result = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (!result?.uri) return;
      if (gridSpec) {
        setGridCells((prev) => {
          const next = [...prev];
          const emptyIdx = next.findIndex((c) => !c);
          if (emptyIdx >= 0) next[emptyIdx] = result.uri;
          const filled = next.every((c) => !!c);
          if (filled) setTimeout(() => void compositeGrid(next as string[]), 50);
          return next;
        });
        return;
      }
      setMedia({ kind: 'photo', uri: result.uri, originalUri: result.uri });
      setCropPending(true);
      setStep('edit');
    } catch {
      Alert.alert('Could not capture that photo', 'Please try again.');
    }
  }, [gridSpec, compositeGrid]);

  const selectGrid = useCallback((spec: GridSpec) => {
    hapticToggle();
    setGridSpec(spec);
    setGridCells(Array(spec.cols * spec.rows).fill(null));
    setGridPopoverOpen(false);
  }, []);

  const clearGrid = useCallback(() => {
    setGridSpec(null);
    setGridCells([]);
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
      const isPhoto = asset.type !== 'video';
      setMedia({ kind: isPhoto ? 'photo' : 'video', uri: asset.uri, originalUri: isPhoto ? asset.uri : undefined });
      setCropPending(isPhoto);
      setStep('edit');
    }
  }, []);

  const handleStoryCropSave = useCallback(async (result: { rect: NormalizedCropRect }) => {
    if (!media) { setCropPending(false); return; }
    const sourceUri = media.originalUri ?? media.uri;
    try {
      const croppedUri = await applyCropRect(sourceUri, result.rect);
      setMedia({ kind: 'photo', uri: croppedUri, originalUri: sourceUri, cropRect: result.rect });
    } catch {
      Alert.alert('Crop failed', 'Could not crop this photo. Please try again.');
    } finally {
      setCropPending(false);
    }
  }, [media]);

  const handleStoryCropCancel = useCallback(() => setCropPending(false), []);

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
    setSelectedId((cur) => (cur === id ? null : cur));
  }, []);

  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;
  const mentionOverlays = overlays.filter((o) => o.type === 'mention');
  const selectedMention = mentionOverlays.find((o) => o.id === selectedId) ?? null;

  const addMention = (person: MentionPerson) => {
    setMentionPickerOpen(false);
    const handle = withAt(person.username ?? person.handle);
    const existing = mentionOverlays.find((o) => o.mentionUserId === person.userId);
    if (existing) { setSelectedId(existing.id); return; }
    if (mentionOverlays.length >= MAX_MENTIONS_PER_STORY) {
      Alert.alert('Mention limit', `You can tag up to ${MAX_MENTIONS_PER_STORY} people in one story.`);
      return;
    }
    hapticLight();
    const id = `ov_${Date.now()}_${overlays.length}`;
    setOverlays((prev) => [...prev, {
      id, type: 'mention', x: W / 2 - 60, y: H / 2 - 40, rotation: 0, scale: 1, opacity: 1,
      mentionUserId: person.userId, mentionHandle: handle, mentionName: person.name, mentionStyle: 'classic',
    }]);
    setSelectedId(id);
  };

  // Tap on a placed overlay: a mention is selected and its style cycles
  // classic → outline → solid → neon; anything else just clears the selection.
  const tapOverlay = useCallback((id: string) => {
    const tapped = overlaysRef.current.find((o) => o.id === id);
    if (tapped?.type !== 'mention') { setSelectedId(null); return; }
    hapticToggle();
    setOverlays((prev) => prev.map((o) => (o.id === id ? { ...o, mentionStyle: nextMentionStyle(o.mentionStyle) } : o)));
    setSelectedId(id);
  }, []);

  const commitTextOverlay = () => {
    const text = textDraft.trim();
    if (text) {
      addOverlay({
        type: 'text',
        text,
        color: textDraftColor,
        size: textDraftSize,
        align: textDraftAlign,
        fontKey: textDraftFontKey,
        bgStyle: textDraftBgStyle,
        textEffect: textDraftEffect,
        textAnimation: textDraftAnimation,
      });
    }
    setTextDraft('');
    setTextToolOpen(false);
  };

  // The "@partial" the text tool's caret is in (drives the inline suggestions).
  const atToken = textToolOpen ? activeMentionQuery(textDraft) : null;

  const openProductPicker = async () => {
    try {
      setTaggableProducts(await getTaggableProducts());
    } catch {
      setTaggableProducts([]);
    }
    setProductPickerOpen(true);
  };

  // ── Post ──────────────────────────────────────────────────────────────────
  // Mirrors Instagram's "Your story is uploading… NN%" pill: an animated ring
  // that always reaches 100% (driven independently of the real network call,
  // same as IG's own composer UI), then the "Stories archive" info alert the
  // first time this account ever posts a story.

  const showArchiveNoticeOnce = useCallback(async () => {
    try {
      const key = `bt:story:archiveNoticeShown:${user?.id ?? 'guest'}`;
      const seen = await AsyncStorage.getItem(key);
      if (seen) return;
      await AsyncStorage.setItem(key, '1');
      Alert.alert(
        'Stories archive',
        'Stories are saved to your archive after 24 hours. Archived stories aren’t visible unless you share them.',
        [{ text: 'Manage settings', onPress: () => router.push('/buyer-privacy-settings' as never) }, { text: 'OK' }],
      );
    } catch {
      // Non-critical: skip the one-time notice rather than block posting.
    }
  }, [router, user?.id]);

  const doShare = useCallback(async (payload: SharePayload, opts?: { closeFriendsOnly?: boolean }) => {
    // Signed out (incl. the web preview) there is nothing to post to — never hit the protected API.
    if (!user?.id) {
      Alert.alert('Sign in to share', 'Sign in to post a story.');
      return;
    }
    const closeOnly = opts?.closeFriendsOnly ?? closeFriendsOnly;
    setIsPosting(true);
    setPostingPercent(0);
    postingProgress.setValue(0);
    // Drives the in-app "uploading… NN%" pill everywhere, plus the iOS Dynamic
    // Island / Lock Screen Live Activity on 16.1+ (no-op elsewhere/on Expo Go).
    const activityId = `story_${Date.now()}`;
    startUploadActivity({ kind: 'story', id: activityId, thumbnailUri: payload.uri });
    const progressListener = postingProgress.addListener(({ value }) => {
      setPostingPercent(Math.round(value));
      updateUploadActivity(activityId, value / 100);
    });
    Animated.timing(postingProgress, { toValue: 96, duration: 1100, useNativeDriver: false }).start();
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
        closeFriendsOnly: closeOnly,
      };

      // One POST. (This used to be followed by a second api.social.createStory
      // with the same media, which would have published every story — and
      // notified every @mention — twice.) media[].overlays carries the mention
      // fields (mentionUserId/mentionHandle/mentionStyle/opacity) through as-is.
      await createStory({ media, privacy, repliesDisabled: false, originalStoryId: reshareStoryId });

      hapticSuccessAction();
      // Let the ring visibly complete (matches IG's own pill, which always
      // finishes at 100% rather than snapping away mid-count) before leaving.
      await new Promise<void>((resolve) => {
        Animated.timing(postingProgress, { toValue: 100, duration: 180, useNativeDriver: false }).start(() => resolve());
      });
      postingProgress.removeListener(progressListener);
      endUploadActivity(activityId, { status: 'success' });
      await showArchiveNoticeOnce();
      setShareSheetOpen(false);
      setPendingSharePayload(null);
      // Instagram's own "Also share to" sheet appears once the story is
      // live — this replaces the previous immediate goBackOr(router).
      setAlsoShareOpen(true);
    } catch (err) {
      postingProgress.removeListener(progressListener);
      endUploadActivity(activityId, { status: 'failed' });
      setIsPosting(false);
      // The original expired / was removed (410) or I'm no longer tagged in it (403):
      // show the inline "Story unavailable" state instead of a generic alert.
      const status = (err as { status?: number } | null)?.status;
      if (reshareStoryId && (status === 403 || status === 410)) {
        setShareSheetOpen(false);
        setReshareUnavailable(true);
        return;
      }
      Alert.alert("Couldn't share your story", 'Try again.');
    }
  }, [user?.id, reshareStoryId, closeFriendsOnly, postingProgress, showArchiveNoticeOnce]);

  // Tapping send/Share opens Instagram's own Share sheet rather than posting
  // immediately (see docs/story-flows.md for what's shown there).
  const openShareSheetFromEdit = () => {
    if (!media || isPosting) return;
    hapticLight();
    setPendingSharePayload({ type: media.kind, uri: media.uri, text: captionDraft.trim() || undefined, ovs: overlays });
    setShareSheetOpen(true);
  };

  // Reshare's "Your story" / "Close Friends" buttons publish straight away, like
  // Instagram's own add-to-story screen (no extra Share sheet in between).
  const shareReshare = (closeFriends: boolean) => {
    if (isPosting || reshareUnavailable) return;
    hapticPrimaryAction();
    setSelectedId(null);
    setCloseFriendsOnly(closeFriends);
    void doShare({ type: 'text', bg: reshareBg, ovs: overlays }, { closeFriendsOnly: closeFriends });
  };

  const notNowReshare = () => {
    hapticLight();
    // Signed out there is no tag to dismiss — just leave.
    if (reshareStoryId && user?.id) api.social.dismissStoryMention(reshareStoryId).catch(() => {});
    goBackOr(router);
  };

  const openReshareOriginal = () => {
    if (!reshareStoryId) return;
    router.push(`/buyer-story-viewer?storyId=${encodeURIComponent(reshareStoryId)}&allStoryIds=${encodeURIComponent(reshareStoryId)}` as never);
  };

  const openShareSheetFromCreate = () => {
    if (!createText.trim() || isPosting) return;
    hapticLight();
    setPendingSharePayload({ type: 'text', bg: swatches[bgIdx].colors[0], text: createText.trim(), textColor: createColor, ovs: [] });
    setShareSheetOpen(true);
  };

  const confirmShareSheet = () => {
    if (!pendingSharePayload || isPosting) return;
    hapticPrimaryAction();
    void doShare(pendingSharePayload);
  };

  // "Also share to" — search people, forward the just-posted story as a DM.
  useEffect(() => {
    if (!alsoShareOpen) return;
    const q = alsoShareQuery.trim();
    if (!q) { setAlsoShareResults([]); return; }
    let cancelled = false;
    setAlsoShareSearching(true);
    const t = setTimeout(() => {
      void searchProfiles(q).then((results) => { if (!cancelled) setAlsoShareResults(results); }).finally(() => { if (!cancelled) setAlsoShareSearching(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [alsoShareOpen, alsoShareQuery]);

  const sendAlsoShareTo = async (person: ProfileSearchResult) => {
    setAlsoShareSendingId(person.userId);
    try {
      const conv = await createOrGetConversation({
        type: 'buyer_to_buyer',
        participant: { userId: person.userId, name: person.name, handle: person.handle, initials: person.initials, color: person.color, accountType: person.accountType },
      });
      await sendMessage(conv.id, 'Sent you my story ✨');
      hapticLight();
      setAlsoShareSentIds((prev) => new Set(prev).add(person.userId));
    } catch {
      Alert.alert("Couldn't send that", 'Try again.');
    } finally {
      setAlsoShareSendingId(null);
    }
  };

  const finishAlsoShare = () => {
    setAlsoShareOpen(false);
    setAlsoShareQuery('');
    setAlsoShareResults([]);
    setAlsoShareSentIds(new Set());
    goBackOr(router);
  };

  const closeAll = () => goBackOr(router);

  // ── CAMERA STEP ───────────────────────────────────────────────────────────

  if (step === 'camera') {
    // expo-camera's CameraView works in the browser (getUserMedia) too, so
    // web gets a real live preview like native — the fallback only shows
    // when permission is actually denied/unavailable (no camera hardware,
    // e.g. this app running headless), same branch either platform hits.
    const hasPermission = !!cameraPermission?.granted;
    return (
      <View style={[styles.root, { backgroundColor: '#000' }]}>
        <StatusBar style="light" />
        {hasPermission ? (
          <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} flash={flash} mode={isRecording ? 'video' : 'picture'} />
        ) : (
          <View style={[styles.root, styles.webFallback]}>
            <Feather name="camera-off" size={40} color={ON_DARK} />
            <Text style={styles.webFallbackText}>
              {IS_WEB ? 'Allow camera access in your browser to capture a story here, or choose from your library.' : 'Allow camera access to post a story.'}
            </Text>
            <TouchableOpacity
              style={[styles.permBtn, { backgroundColor: theme.accent }]}
              onPress={() => {
                // On native, once the OS prompt has already been declined
                // it can't be re-shown — the only way back in is Settings.
                if (!IS_WEB && cameraPermission?.canAskAgain === false) { Linking.openSettings(); return; }
                requestCameraPermission();
                requestMicPermission();
              }}
            >
              <Text style={[styles.permBtnText, getOnAccentTextStyle(theme)]}>
                {!IS_WEB && cameraPermission?.canAskAgain === false ? 'Open Settings' : 'Grant access'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Top bar — never under the notch */}
        <View style={[styles.camTopBar, { paddingTop: topInset + SP.sm }]}>
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

        {/* Left-side vertical tool rail — Create / Boomerang / Layout / Hands-free */}
        <View style={[styles.leftRail, { top: topInset + 90 }]}>
          <TouchableOpacity
            style={styles.railBtn}
            onPress={() => { hapticLight(); setStep('create'); }}
            accessibilityLabel="Create a text story"
            accessibilityRole="button"
          >
            <Text style={styles.railAa}>Aa</Text>
            {railExpanded && <Text style={styles.railLabel}>Create</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.railBtn}
            onPress={() => { hapticToggle(); setBoomerangOn((v) => !v); if (gridSpec) clearGrid(); }}
            accessibilityLabel="Boomerang"
            accessibilityRole="button"
            accessibilityState={{ selected: boomerangOn }}
          >
            <Feather name="repeat" size={20} color={boomerangOn ? theme.accent : ON_DARK} />
            {railExpanded && <Text style={[styles.railLabel, boomerangOn && { color: theme.accent }]}>Boomerang</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.railBtn}
            onPress={() => { hapticToggle(); setGridPopoverOpen((v) => !v); if (boomerangOn) setBoomerangOn(false); }}
            accessibilityLabel="Layout"
            accessibilityRole="button"
            accessibilityState={{ selected: !!gridSpec }}
          >
            <Feather name="grid" size={20} color={gridSpec ? theme.accent : ON_DARK} />
            {railExpanded && <Text style={[styles.railLabel, gridSpec && { color: theme.accent }]}>Layout</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.railBtn}
            onPress={() => { hapticToggle(); setHandsFree((v) => !v); }}
            accessibilityLabel="Hands-free"
            accessibilityRole="button"
            accessibilityState={{ selected: handsFree }}
          >
            <Feather name="video" size={20} color={handsFree ? theme.accent : ON_DARK} />
            {railExpanded && <Text style={[styles.railLabel, handsFree && { color: theme.accent }]}>Hands-free</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.railBtn}
            onPress={() => { hapticLight(); setRailExpanded((v) => !v); }}
            accessibilityLabel={railExpanded ? 'Collapse tools' : 'Expand tools'}
            accessibilityRole="button"
          >
            <Feather name={railExpanded ? 'chevron-up' : 'chevron-down'} size={20} color={ON_DARK} />
          </TouchableOpacity>

          {gridPopoverOpen && (
            <View style={styles.gridPopover}>
              {GRID_SPECS.map((spec) => (
                <TouchableOpacity key={spec.id} style={styles.gridOption} onPress={() => selectGrid(spec)} accessibilityRole="button" accessibilityLabel={`Grid ${spec.cols} by ${spec.rows}`}>
                  <GridIcon spec={spec} active={gridSpec?.id === spec.id} />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* "Change grid" pill — shown once a layout is active, like Instagram's own label under the rail */}
        {gridSpec && (
          <TouchableOpacity style={[styles.changeGridPill, { top: topInset + 90 + 190 }]} onPress={() => setGridPopoverOpen(true)} accessibilityRole="button" accessibilityLabel="Change grid">
            <Feather name="grid" size={14} color={ON_DARK} />
            <Text style={styles.changeGridText}>Change grid</Text>
            <Feather name="chevron-down" size={14} color={ON_DARK} />
          </TouchableOpacity>
        )}

        {/* Bottom controls */}
        <View style={[styles.camBottom, { paddingBottom: insets.bottom + SP.md }]}>
          {/* Mode carousel: STORY / POST / LIVE. LIVE is a real, working
              destination for sellers (routes to the Go Live flow) — never a
              disabled "coming soon" item. Buyers can't go live at all, so
              the item isn't rendered for them rather than shown dead. */}
          <View style={styles.modeRow}>
            {(isSeller ? (['post', 'story', 'live'] as CaptureMode[]) : (['post', 'story'] as CaptureMode[])).map((m) => {
              const active = mode === m;
              return (
                <TouchableOpacity
                  key={m}
                  style={styles.modeItem}
                  onLayout={(e) => {
                    const { x, width } = e.nativeEvent.layout;
                    setModeLayouts((prev) => ({ ...prev, [m]: { x, width } }));
                  }}
                  onPress={() => {
                    hapticToggle();
                    // Forward the REAL role, not the route param this screen
                    // was reached with (see isSeller's own doc above) — a
                    // seller tapping POST must still land on create-post's
                    // seller-gated fields, not fall back to its buyer view.
                    if (m === 'post') { router.push({ pathname: '/create-post', params: { accountType: isSeller ? 'seller' : 'buyer' } } as any); return; }
                    if (m === 'live') { router.push('/seller-go-live' as never); return; }
                    setMode(m);
                  }}
                  accessibilityLabel={`${m} mode`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.modeText, active && styles.modeTextActive]}>
                    {m.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.modeIndicator,
                { transform: [{ translateX: modeIndicatorX }], width: modeIndicatorWidth },
              ]}
            />
          </View>

          <View style={styles.controlsRow}>
            {/* Gallery thumbnail */}
            <TouchableOpacity style={styles.galleryThumb} onPress={openGallery} accessibilityLabel="Choose from camera roll" accessibilityRole="button">
              {lastGalleryUri ? (
                <Image source={{ uri: lastGalleryUri }} style={styles.galleryThumbImg} />
              ) : (
                <Feather name="image" size={20} color={ON_DARK} />
              )}
            </TouchableOpacity>

            {/* Shutter — tap for photo, hold for video (or hands-free/boomerang/grid-cell capture) */}
            <Pressable
              style={styles.shutterWrap}
              onPress={() => {
                if (compositing) return;
                if (gridSpec) { void takePhoto(); return; }
                if (boomerangOn) { void startBoomerang(); return; }
                if (handsFree) { if (isRecording) stopRecording(); else void startRecording(); return; }
                void takePhoto();
              }}
              onLongPress={gridSpec || boomerangOn || handsFree ? undefined : startRecording}
              onPressOut={() => { if (recordingRef.current && !handsFree) stopRecording(); }}
              delayLongPress={220}
              accessibilityLabel={handsFree ? (isRecording ? 'Stop recording' : 'Start recording') : gridSpec ? 'Capture next grid cell' : boomerangOn ? 'Capture Boomerang' : 'Tap for photo, hold for video'}
              accessibilityRole="button"
            >
              <View style={styles.shutterRing}>
                {isRecording ? (
                  <View style={[styles.progressRing, { transform: [{ rotate: `${recordProgress * 360}deg` }] }]} />
                ) : null}
                {compositing ? (
                  <ActivityIndicator color="#000" />
                ) : gridSpec ? (
                  <Feather name="grid" size={22} color="#000" />
                ) : (
                  <View style={[styles.shutterInner, isRecording && { backgroundColor: '#F87171' }]} />
                )}
              </View>
            </Pressable>
            {gridSpec && (
              <View style={styles.gridDots}>
                {gridCells.map((c, i) => (
                  <View key={i} style={[styles.gridDot, c && { backgroundColor: theme.accent }]} />
                ))}
              </View>
            )}

            {/* Flip camera */}
            <TouchableOpacity
              style={styles.flipBtn}
              disabled={isRecording}
              onPress={() => setFacing((v) => (v === 'back' ? 'front' : 'back'))}
              accessibilityLabel="Flip camera"
              accessibilityRole="button"
            >
              <Feather name="refresh-cw" size={28} color={isRecording ? 'rgba(255,255,255,0.35)' : ON_DARK} />
            </TouchableOpacity>
          </View>

          <Text style={styles.hint}>
            {gridSpec ? `Cell ${gridCells.filter(Boolean).length + 1} of ${gridCells.length}`
              : handsFree ? (isRecording ? 'Tap to stop' : 'Tap to start recording')
              : boomerangOn ? 'Tap for a Boomerang'
              : 'Tap for photo · Hold for video'}
          </Text>
        </View>

        {/* Off-screen grid composite — captureRef flattens this into one PNG once every cell is filled */}
        <View
          ref={gridCompositeRef}
          collapsable={false}
          style={[styles.gridComposite, { width: W, height: H }]}
          pointerEvents="none"
        >
          {gridSpec && gridCells.map((uri, i) => {
            if (!uri) return null;
            const col = i % gridSpec.cols;
            const row = Math.floor(i / gridSpec.cols);
            const cw = W / gridSpec.cols;
            const ch = H / gridSpec.rows;
            return (
              <Image
                key={i}
                source={{ uri }}
                style={{ position: 'absolute', left: col * cw, top: row * ch, width: cw, height: ch }}
                resizeMode="cover"
              />
            );
          })}
        </View>
      </View>
    );
  }

  // ── Share sheet + "Also share to" sheet — shared by CREATE and EDIT ────────
  const renderShareSheets = () => (
    <>
      <Modal visible={shareSheetOpen} transparent animationType="slide" onRequestClose={() => setShareSheetOpen(false)}>
        <ModalSafeArea>
          <Pressable style={styles.sheetBackdrop} onPress={() => setShareSheetOpen(false)} accessibilityRole="button" accessibilityLabel="Close" />
          <View style={[styles.shareSheet, { paddingBottom: insets.bottom + SP.md }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Share</Text>

            <TouchableOpacity
              style={styles.shareRow}
              onPress={() => { hapticToggle(); setCloseFriendsOnly(false); }}
              accessibilityRole="radio"
              accessibilityState={{ checked: !closeFriendsOnly }}
            >
              <View style={styles.shareRowAvatar}><Text style={styles.myAvatarText}>{myInitials}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.shareRowTitle}>Your story</Text>
                <Text style={styles.shareRowSubtitle}>Sharing options</Text>
              </View>
              <View style={[styles.radioOuter, !closeFriendsOnly && styles.radioOuterActive]}>
                {!closeFriendsOnly && <View style={styles.radioInner} />}
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.shareRow}
              onPress={() => { hapticToggle(); setCloseFriendsOnly(true); }}
              accessibilityRole="radio"
              accessibilityState={{ checked: closeFriendsOnly }}
            >
              <View style={[styles.shareRowAvatar, { backgroundColor: 'transparent' }]}>
                <Feather name="star" size={20} color={ON_DARK} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.shareRowTitle}>Close Friends</Text>
                <Text style={styles.shareRowSubtitle}>Add people</Text>
              </View>
              <View style={[styles.radioOuter, closeFriendsOnly && styles.radioOuterActive]}>
                {closeFriendsOnly && <View style={styles.radioInner} />}
              </View>
            </TouchableOpacity>

            <Button label={isPosting ? 'Sharing…' : 'Share'} onPress={confirmShareSheet} loading={isPosting} fullWidth style={{ marginTop: SP.md }} />
          </View>
        </ModalSafeArea>
      </Modal>

      <Modal visible={alsoShareOpen} transparent animationType="slide" onRequestClose={finishAlsoShare}>
        <ModalSafeArea>
          <View style={[styles.alsoShareSheet, { paddingTop: topInset + SP.md, paddingBottom: insets.bottom + SP.md }]}>
            <View style={styles.textToolTop}>
              <Text style={styles.sheetTitle}>Also share to</Text>
              <TouchableOpacity onPress={finishAlsoShare} accessibilityRole="button" accessibilityLabel="Done">
                <Text style={styles.textToolDone}>Done</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.alsoShareSearchWrap}>
              <Feather name="search" size={16} color={MUTED} />
              <TextInput
                style={[styles.alsoShareSearchInput, WEB_INPUT_RESET]}
                placeholder="Search"
                placeholderTextColor={MUTED}
                value={alsoShareQuery}
                onChangeText={setAlsoShareQuery}
              />
            </View>
            {/* Highlights aren't in this app yet (shipping in a follow-up PR),
                so this sheet doesn't show a fake "Add to Highlights" row. */}
            {alsoShareSearching ? (
              <ActivityIndicator style={{ marginTop: SP.lg }} color={ON_DARK} />
            ) : (
              <ScrollView style={{ marginTop: SP.sm }}>
                {alsoShareResults.map((p) => {
                  const sent = alsoShareSentIds.has(p.userId);
                  return (
                    <View key={p.userId} style={styles.alsoShareRow}>
                      <View style={[styles.shareRowAvatar, { backgroundColor: p.color }]}><Text style={styles.myAvatarText}>{p.initials}</Text></View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.shareRowTitle}>{p.name}</Text>
                        <Text style={styles.shareRowSubtitle}>@{p.handle}</Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.alsoShareSendBtn, sent && styles.alsoShareSendBtnSent]}
                        onPress={() => void sendAlsoShareTo(p)}
                        disabled={sent || alsoShareSendingId === p.userId}
                        accessibilityRole="button"
                        accessibilityLabel={sent ? `Sent to ${p.name}` : `Send to ${p.name}`}
                      >
                        {alsoShareSendingId === p.userId ? (
                          <ActivityIndicator size="small" color={ON_DARK} />
                        ) : (
                          <Text style={[styles.alsoShareSendText, sent && { color: ON_DARK }]}>{sent ? 'Sent' : 'Send'}</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  );
                })}
                {!alsoShareQuery.trim() && (
                  <Text style={styles.alsoShareHint}>Search for people to send this story to.</Text>
                )}
              </ScrollView>
            )}
          </View>
        </ModalSafeArea>
      </Modal>
    </>
  );

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

        <View style={[styles.camTopBar, { paddingTop: topInset + SP.sm }]}>
          <TouchableOpacity style={styles.camIconBtn} onPress={() => setStep('camera')} accessibilityLabel="Back to camera" accessibilityRole="button">
            <Feather name="arrow-left" size={22} color={swatch.id === 'off-white' ? '#000' : ON_DARK} />
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <Button
            label="Share"
            size="compact"
            onPress={openShareSheetFromCreate}
            disabled={!createText.trim() || isPosting}
          />
        </View>
        {isPosting && <PostingToast percent={postingPercent} topInset={topInset} />}

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
        {renderShareSheets()}
      </View>
    );
  }

  // ── EDIT STEP ─────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {isReshare ? (
        <LinearGradient colors={reshareGradientFromBackground(reshareBg)} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} />
      ) : media?.kind === 'video' ? <VideoPreview uri={media.uri} /> : media ? (
        <Image source={{ uri: media.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />
      )}

      {/* Tap empty canvas to clear the mention selection */}
      {selectedId ? <Pressable style={StyleSheet.absoluteFill} onPress={() => setSelectedId(null)} accessibilityLabel="Deselect" /> : null}

      {drawOpen ? <DrawCanvas strokes={strokes} onAddStroke={(s) => setStrokes((p) => [...p, s])} color={drawColor} width={drawWidth} /> : null}

      {/* Overlays */}
      {overlays.map((ov) => (
        <OverlayChip
          key={ov.id}
          overlay={ov}
          canvasSize={canvasSize}
          onChange={changeOverlay}
          onRemove={removeOverlay}
          onTap={tapOverlay}
          selected={ov.id === selectedId}
          removable={ov.type !== 'reshare_card'}
        >
          {renderOverlayContent(ov, { creditHandle: reshareHandle, onCreditPress: reshareStoryId ? openReshareOriginal : undefined })}
        </OverlayChip>
      ))}

      {/* Top bar */}
      <View style={[styles.camTopBar, { paddingTop: topInset + SP.sm }]}>
        <TouchableOpacity
          style={styles.camIconBtn}
          onPress={() => {
            const edited = overlays.some((o) => o.type !== 'reshare_card') || strokes.length > 0;
            if (isReshare) {
              if (!edited) { goBackOr(router); return; }
              Alert.alert('Discard edits?', 'Your text, stickers and drawing will be lost.', [
                { text: 'Keep editing', style: 'cancel' },
                { text: 'Discard', style: 'destructive', onPress: () => goBackOr(router) },
              ]);
              return;
            }
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
          <TouchableOpacity
            style={styles.camIconBtn}
            onPress={() => {
              setTextDraft('');
              setTextDraftColor('#FFFFFF');
              setTextDraftFontKey('classic');
              setTextDraftSize(30);
              setTextDraftAlign('center');
              setTextDraftBgStyle('none');
              setTextDraftEffect('plain');
              setTextDraftAnimation(undefined);
              setTextToolOpen(true);
              loadStoryFontsAsync().then(() => setFontsReady(true));
            }}
            accessibilityLabel="Add text"
            accessibilityRole="button"
          >
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
      {isPosting && <PostingToast percent={postingPercent} topInset={topInset} />}

      {/* Draw sub-toolbar */}
      {drawOpen ? (
        <View style={[styles.drawBar, { top: topInset + 60 }]}>
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

      {/* Mention controls: tagged-people chip (works even when every sticker is invisible) + style/opacity for the selected sticker */}
      {mentionOverlays.length > 0 ? (
        <View style={[styles.mentionDock, { bottom: insets.bottom + (isReshare ? 150 : 138) }]} pointerEvents="box-none">
          <TouchableOpacity
            style={styles.taggedChip}
            onPress={() => { hapticLight(); setTaggedSheetOpen(true); }}
            accessibilityRole="button"
            accessibilityLabel={`Tagged people, ${mentionOverlays.length}`}
            testID="story-tagged-chip"
          >
            <Feather name="at-sign" size={14} color={ON_DARK} />
            <Text style={styles.taggedChipText}>{mentionOverlays.length}</Text>
          </TouchableOpacity>
          {selectedMention ? (
            <View style={styles.mentionControls} testID="mention-controls">
              <Text style={styles.mentionControlsLabel} numberOfLines={1}>
                {selectedMention.mentionHandle} · {selectedMention.mentionStyle ?? 'classic'}
              </Text>
              <View style={styles.mentionOpacityRow}>
                <Feather name="droplet" size={14} color={MUTED} />
                <View style={{ flex: 1, paddingHorizontal: 8 }}>
                  <InlineSlider
                    value={Math.round(clampMentionOpacity(selectedMention.opacity) * 100)}
                    min={0}
                    max={100}
                    step={1}
                    onChange={(v) => changeOverlay(selectedMention.id, { opacity: clampMentionOpacity(v / 100) })}
                    accessibilityLabel="Mention opacity"
                  />
                </View>
                <Text style={styles.mentionOpacityValue}>{Math.round(clampMentionOpacity(selectedMention.opacity) * 100)}%</Text>
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Bottom bar */}
      {isReshare ? (
        <View style={[styles.editBottom, { paddingBottom: insets.bottom + SP.md }]}>
          {reshareUnavailable ? (
            <View style={styles.reshareUnavailable} testID="reshare-unavailable">
              <Feather name="slash" size={16} color={ON_DARK} />
              <View style={{ flex: 1 }}>
                <Text style={styles.reshareUnavailableTitle}>Story unavailable</Text>
                <Text style={styles.reshareUnavailableSub}>This story expired or you can no longer share it.</Text>
              </View>
              <TouchableOpacity onPress={() => goBackOr(router)} accessibilityRole="button" accessibilityLabel="Close">
                <Text style={styles.reshareNotNow}>Close</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.audienceRow}>
                <PressableScale
                  style={[styles.reshareAction, isPosting && { opacity: 0.6 }]}
                  onPress={() => shareReshare(false)}
                  disabled={isPosting}
                  accessibilityRole="button"
                  accessibilityLabel="Share to your story"
                  testID="reshare-your-story"
                >
                  <View style={styles.myAvatar}><Text style={styles.myAvatarText}>{myInitials}</Text></View>
                  <Text style={styles.reshareActionLabel}>Your story</Text>
                </PressableScale>
                <PressableScale
                  style={[styles.reshareAction, styles.reshareActionOutline, isPosting && { opacity: 0.6 }]}
                  onPress={() => shareReshare(true)}
                  disabled={isPosting}
                  accessibilityRole="button"
                  accessibilityLabel="Share to Close Friends"
                  testID="reshare-close-friends"
                >
                  <Feather name="star" size={14} color={ON_DARK} />
                  <Text style={styles.reshareActionLabel}>Close Friends</Text>
                </PressableScale>
              </View>
              <TouchableOpacity style={styles.reshareNotNowWrap} onPress={notNowReshare} accessibilityRole="button" accessibilityLabel="Not now" testID="reshare-not-now">
                <Text style={styles.reshareNotNow}>Not now</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      ) : (
      <View style={[styles.editBottom, { paddingBottom: insets.bottom + SP.md }]}>
        <TextInput
          style={styles.captionInput}
          value={captionDraft}
          onChangeText={setCaptionDraft}
          placeholder="Add a caption…"
          placeholderTextColor="rgba(255,255,255,0.5)"
          maxLength={200}
        />
        <View style={styles.audienceRow}>
          <View style={styles.myStoryChip}>
            <View style={styles.myAvatar}><Text style={styles.myAvatarText}>{myInitials}</Text></View>
            <Text style={styles.myStoryLabel}>Your story</Text>
          </View>
          <TouchableOpacity
            style={[styles.closeFriendsChip, closeFriendsOnly && { backgroundColor: ON_DARK }]}
            onPress={() => { hapticToggle(); setCloseFriendsOnly((v) => !v); }}
            accessibilityRole="button"
            accessibilityLabel="Toggle Close Friends only"
            accessibilityState={{ selected: closeFriendsOnly }}
          >
            <Feather name="star" size={13} color={closeFriendsOnly ? '#000' : 'rgba(255,255,255,0.6)'} />
            <Text style={[styles.closeFriendsLabel, closeFriendsOnly && { color: '#000' }]}>Close Friends</Text>
          </TouchableOpacity>
          <PressableScale
            style={[styles.sendBtn, isPosting && { opacity: 0.6 }]}
            onPress={openShareSheetFromEdit}
            disabled={isPosting}
            accessibilityRole="button"
            accessibilityLabel={isPosting ? 'Posting story' : 'Send story'}
          >
            {isPosting ? <Feather name="loader" size={20} color="#000" /> : <Feather name="arrow-up" size={20} color="#000" />}
          </PressableScale>
        </View>
      </View>
      )}

      {/* ── Text tool overlay ── */}
      <Modal visible={textToolOpen} transparent animationType="fade" onRequestClose={() => setTextToolOpen(false)}>
        <ModalSafeArea>
        <KeyboardAvoidingView
          style={styles.textToolBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? topInset : 0}
        >
          <View style={[styles.textToolTop, { paddingTop: topInset + SP.sm }]}>
            <TouchableOpacity onPress={() => setTextToolOpen(false)} accessibilityLabel="Close" accessibilityRole="button">
              <Feather name="x" size={22} color={ON_DARK} />
            </TouchableOpacity>
            <TouchableOpacity onPress={commitTextOverlay} accessibilityLabel="Done" accessibilityRole="button">
              <Text style={styles.textToolDone}>Done</Text>
            </TouchableOpacity>
          </View>

          {/* Vertical size slider — left edge, drag to grow/shrink text (16-64pt) */}
          <VerticalSizeSlider value={textDraftSize} min={16} max={64} onChange={setTextDraftSize} />

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
                  color: textDraftBgStyle !== 'none' ? (textDraftColor === '#FFFFFF' ? '#000' : '#FFF') : textDraftColor,
                  backgroundColor: textDraftBgStyle === 'solid' ? textDraftColor
                    : textDraftBgStyle === 'translucent' ? `${textDraftColor}CC`
                    : 'transparent',
                  textAlign: textDraftAlign,
                  fontSize: textDraftSize,
                  fontFamily: fontsReady ? storyFontFamily(textDraftFontKey) : FONT.bold,
                  textShadowColor: textDraftEffect === 'outline' ? '#000' : textDraftEffect === 'glow' ? textDraftColor : 'transparent',
                  textShadowRadius: textDraftEffect === 'outline' ? 3 : textDraftEffect === 'glow' ? 12 : 0,
                  textShadowOffset: { width: 0, height: 0 },
                },
              ]}
              maxLength={200}
            />
          </View>

          <View style={[styles.textToolBottom, { paddingBottom: insets.bottom + SP.md }]}>
            {/* Font-chip row — Instagram's scrollable "Bubble / Deco / Squeeze / Typewriter…" row */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.fontChipRow} contentContainerStyle={{ gap: SP.xs }}>
              {TEXT_FONTS.map((f) => {
                const active = textDraftFontKey === f.key;
                return (
                  <TouchableOpacity
                    key={f.key}
                    style={[styles.fontChip, active && { backgroundColor: ON_DARK }]}
                    onPress={() => { hapticToggle(); setTextDraftFontKey(f.key); }}
                    accessibilityRole="button"
                    accessibilityLabel={`Font: ${f.label}`}
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.fontChipText, { fontFamily: fontsReady ? f.fontFamily : FONT.medium }, active && { color: '#000' }]}>
                      {f.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.textToolRow}>
              <TouchableOpacity style={styles.textToolChip} onPress={() => setTextColorSheetOpen(true)} accessibilityLabel="Text color" accessibilityRole="button">
                <LinearGradient colors={['#F87171', '#FBBF24', '#34D399', '#60A5FA', '#C084FC']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.colorWheelDot} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.textToolChip} onPress={() => setTextAnimationSheetOpen(true)} accessibilityLabel="Text animation" accessibilityRole="button">
                <Text style={styles.textToolChipGlyph}>//A</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.textToolChip} onPress={() => setTextEffectSheetOpen(true)} accessibilityLabel="Text effect" accessibilityRole="button">
                <Feather name="zap" size={16} color={ON_DARK} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.textToolChip}
                onPress={() => setTextDraftAlign((a) => (a === 'left' ? 'center' : a === 'center' ? 'right' : 'left'))}
                accessibilityLabel={`Alignment ${textDraftAlign}`}
                accessibilityRole="button"
              >
                <Feather name={textDraftAlign === 'left' ? 'align-left' : textDraftAlign === 'right' ? 'align-right' : 'align-center'} size={18} color={ON_DARK} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.textToolChip, textDraftBgStyle !== 'none' && { backgroundColor: theme.accentDim }]}
                onPress={() => { hapticToggle(); setTextDraftBgStyle((v) => (v === 'none' ? 'solid' : v === 'solid' ? 'translucent' : 'none')); }}
                accessibilityLabel={`Background: ${textDraftBgStyle}`}
                accessibilityRole="button"
              >
                <Text style={[styles.textToolChipGlyph, { fontSize: 16 }]}>A</Text>
              </TouchableOpacity>
            </View>

            {/* Typing "@…" swaps the shortcuts for Instagram-style people suggestions; picking one
                inserts "@username" into the text (the server turns it into a real mention). */}
            <MentionSuggestionsBar
              active={!!atToken}
              query={atToken?.query ?? ''}
              enabled={!!user?.id}
              onPick={(p) => { hapticLight(); setTextDraft((t) => insertMention(t, (p.username ?? p.handle ?? '').replace(/^@+/, ''))); }}
            />

            {/* Above-keyboard row — Instagram's quick Mention/Location shortcuts. Rewrite is
                intentionally omitted: it needs a real LLM call, which is out of scope here
                rather than a fake button (see docs/story-flows.md). */}
            <View style={[styles.textAccessoryRow, atToken ? { display: 'none' } : null]}>
              <TouchableOpacity
                style={styles.textAccessoryItem}
                onPress={() => { hapticLight(); setTextDraft((t) => (t && !/\s$/.test(t) ? `${t} @` : `${t}@`)); }}
                accessibilityRole="button"
                accessibilityLabel="Add mention"
              >
                <Feather name="at-sign" size={14} color={ON_DARK} />
                <Text style={styles.textAccessoryLabel}>Mention</Text>
              </TouchableOpacity>
              <View style={styles.textAccessoryDivider} />
              <TouchableOpacity
                style={styles.textAccessoryItem}
                onPress={() => { addOverlay({ type: 'location', locationLabel: 'Add location' }); setTextToolOpen(false); }}
                accessibilityRole="button"
                accessibilityLabel="Add location"
              >
                <Feather name="map-pin" size={14} color={ON_DARK} />
                <Text style={styles.textAccessoryLabel}>Location</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
        </ModalSafeArea>
      </Modal>

      {/* ── Text color sheet — swatch page + hue/saturation/brightness ── */}
      <Modal visible={textColorSheetOpen} transparent animationType="fade" onRequestClose={() => setTextColorSheetOpen(false)}>
        <ModalSafeArea>
          <Pressable style={styles.sheetBackdrop} onPress={() => setTextColorSheetOpen(false)} accessibilityRole="button" accessibilityLabel="Close" />
          <View style={[styles.textColorSheet, { paddingBottom: insets.bottom + SP.md }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Text color</Text>
            <View style={styles.textToolColorRow}>
              {['#FFFFFF', '#000000', '#C084FC', '#60A5FA', '#34D399', '#FBBF24', '#F97316', '#F87171'].map((c) => (
                <PressableScale
                  key={c}
                  style={[styles.colorCircle, { backgroundColor: c }, textDraftColor === c && styles.colorCircleActive, c === '#000000' && styles.colorCircleBorder]}
                  onPress={() => { hapticToggle(); setTextDraftColor(c); }}
                  accessibilityRole="button"
                  accessibilityLabel={`Text color ${c}`}
                  accessibilityState={{ selected: textDraftColor === c }}
                />
              ))}
            </View>
            <HsbPicker color={textDraftColor} onChange={setTextDraftColor} />
          </View>
        </ModalSafeArea>
      </Modal>

      {/* ── Text animation sheet ── */}
      <Modal visible={textAnimationSheetOpen} transparent animationType="fade" onRequestClose={() => setTextAnimationSheetOpen(false)}>
        <ModalSafeArea>
          <Pressable style={styles.sheetBackdrop} onPress={() => setTextAnimationSheetOpen(false)} accessibilityRole="button" accessibilityLabel="Close" />
          <View style={[styles.textColorSheet, { paddingBottom: insets.bottom + SP.md }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Text animation</Text>
            <Text style={styles.sheetSubtitle}>Plays back when story-viewer animation support ships — selection is saved now.</Text>
            <View style={styles.animationGrid}>
              {['Emphasize', 'Drift Up', 'Loud', 'Speedy', 'Fall', 'Headline', 'Slide Up'].map((a) => {
                const active = textDraftAnimation === a;
                return (
                  <TouchableOpacity
                    key={a}
                    style={[styles.animationChip, active && { backgroundColor: ON_DARK }]}
                    onPress={() => { hapticToggle(); setTextDraftAnimation(active ? undefined : a); setTextAnimationSheetOpen(false); }}
                    accessibilityRole="button"
                    accessibilityLabel={`Animation ${a}`}
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.animationChipText, active && { color: '#000' }]}>{a}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </ModalSafeArea>
      </Modal>

      {/* ── Text effect sheet ── */}
      <Modal visible={textEffectSheetOpen} transparent animationType="fade" onRequestClose={() => setTextEffectSheetOpen(false)}>
        <ModalSafeArea>
          <Pressable style={styles.sheetBackdrop} onPress={() => setTextEffectSheetOpen(false)} accessibilityRole="button" accessibilityLabel="Close" />
          <View style={[styles.textColorSheet, { paddingBottom: insets.bottom + SP.md }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Text effect</Text>
            <View style={styles.animationGrid}>
              {([['plain', 'Plain'], ['outline', 'Outline'], ['glow', 'Neon']] as const).map(([key, label]) => {
                const active = textDraftEffect === key;
                return (
                  <TouchableOpacity
                    key={key}
                    style={[styles.animationChip, active && { backgroundColor: ON_DARK }]}
                    onPress={() => { hapticToggle(); setTextDraftEffect(key); setTextEffectSheetOpen(false); }}
                    accessibilityRole="button"
                    accessibilityLabel={`Effect ${label}`}
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.animationChipText, active && { color: '#000' }]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </ModalSafeArea>
      </Modal>

      {/* ── Sticker sheet ── */}
      <Modal visible={stickerSheetOpen} transparent animationType="slide" onRequestClose={() => setStickerSheetOpen(false)}>
        <ModalSafeArea>
          <Pressable style={styles.sheetBackdrop} onPress={() => setStickerSheetOpen(false)} accessibilityRole="button" accessibilityLabel="Close" />
          <View style={[styles.stickerSheet, { paddingBottom: insets.bottom + SP.md }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Stickers</Text>
            <View style={styles.stickerGrid}>
              <StickerTile icon="at-sign" label="Mention" onPress={() => { setStickerSheetOpen(false); setMentionPickerOpen(true); }} />
              <StickerTile icon="map-pin" label="Location" onPress={() => { addOverlay({ type: 'location', locationLabel: 'Add location' }); setStickerSheetOpen(false); }} />
              <StickerTile icon="clock" label="Time" onPress={() => { addOverlay({ type: 'time', text: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }); setStickerSheetOpen(false); }} />
              <StickerTile icon="bar-chart-2" label="Poll" onPress={() => { setStickerSheetOpen(false); setPollComposerOpen(true); }} />
              <StickerTile icon="help-circle" label="Question" onPress={() => { setStickerSheetOpen(false); setQuestionComposerOpen(true); }} />
              <StickerTile icon="link" label="Link" onPress={() => { addOverlay({ type: 'link', linkUrl: 'https://', linkText: 'Link' }); setStickerSheetOpen(false); }} />
              {isSeller ? (
                <StickerTile icon="shopping-bag" label="Product" onPress={() => { setStickerSheetOpen(false); openProductPicker(); }} />
              ) : null}
              {isSeller ? (
                <StickerTile icon="clock" label="Countdown" onPress={() => { setStickerSheetOpen(false); setCountdownPickerOpen(true); }} />
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
        </ModalSafeArea>
      </Modal>

      {/* ── Interactive sticker composers: poll, question, drop countdown ── */}
      <PollComposer
        visible={pollComposerOpen}
        onClose={() => setPollComposerOpen(false)}
        onAdd={({ question, options }) => {
          addOverlay({ type: 'poll', x: W / 2 - STICKER.card / 2, y: H * 0.34, pollQuestion: question, pollOptions: options.map((label) => ({ label, votes: 0 })) });
          setPollComposerOpen(false);
        }}
      />
      <QuestionComposer
        visible={questionComposerOpen}
        onClose={() => setQuestionComposerOpen(false)}
        onAdd={(prompt) => {
          addOverlay({ type: 'question', x: W / 2 - STICKER.card / 2, y: H * 0.34, questionPrompt: prompt });
          setQuestionComposerOpen(false);
        }}
      />
      <CountdownPicker
        visible={countdownPickerOpen}
        onClose={() => setCountdownPickerOpen(false)}
        onPick={(drop) => {
          addOverlay({ type: 'countdown', x: W / 2 - STICKER.card / 2, y: H * 0.34, dropId: drop.id, dropName: drop.name, dropReleaseAt: drop.releaseAt });
          setCountdownPickerOpen(false);
        }}
      />

      {/* ── Product tag picker (sellers) ── */}
      <Modal visible={productPickerOpen} transparent animationType="slide" onRequestClose={() => setProductPickerOpen(false)}>
        <ModalSafeArea>
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
                      x: W / 2 - STICKER.card / 2, y: H * 0.34,
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
        </ModalSafeArea>
      </Modal>

      {/* ── Mention picker (sticker tray → Mention) ── */}
      <MentionPickerSheet visible={mentionPickerOpen} enabled={!!user?.id} onClose={() => setMentionPickerOpen(false)} onPick={addMention} />

      {/* ── Tagged people: reach (or remove) a mention even when its sticker is a speck or off the edge ── */}
      <Modal visible={taggedSheetOpen} transparent animationType="slide" onRequestClose={() => setTaggedSheetOpen(false)}>
        <ModalSafeArea>
          <Pressable style={styles.sheetBackdrop} onPress={() => setTaggedSheetOpen(false)} accessibilityRole="button" accessibilityLabel="Close" />
          <View style={[styles.stickerSheet, { paddingBottom: insets.bottom + SP.md, maxHeight: '60%' }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Tagged people</Text>
            <ScrollView>
              {taggedPeople(mentionOverlays).map((p) => {
                const ov = mentionOverlays.find((o) => o.mentionUserId === p.userId);
                return (
                  <View key={p.userId} style={styles.alsoShareRow}>
                    <TouchableOpacity
                      style={{ flex: 1 }}
                      onPress={() => { if (ov) setSelectedId(ov.id); setTaggedSheetOpen(false); }}
                      accessibilityRole="button"
                      accessibilityLabel={`Select ${p.handle} sticker`}
                    >
                      <Text style={styles.shareRowTitle}>{p.handle}</Text>
                      {p.name ? <Text style={styles.shareRowSubtitle}>{p.name}</Text> : null}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.alsoShareSendBtn}
                      onPress={() => { if (ov) removeOverlay(ov.id); }}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${p.handle}`}
                    >
                      <Text style={styles.alsoShareSendText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </ModalSafeArea>
      </Modal>

      {/* ── Shop-link modal (sellers) ── */}
      <Modal visible={shopModalOpen} transparent animationType="fade" onRequestClose={() => setShopModalOpen(false)}>
        <ModalSafeArea>
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
        </ModalSafeArea>
      </Modal>
      {renderShareSheets()}

      {cropPending && media?.kind === 'photo' && (
        <MediaCropper
          visible
          uri={media.originalUri ?? media.uri}
          targetRatio={9 / 16}
          initialRect={media.cropRect ?? null}
          title="Crop photo"
          onCancel={handleStoryCropCancel}
          onSave={(result) => void handleStoryCropSave(result)}
        />
      )}
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
function renderOverlayContent(ov: StoryOverlay, ctx?: { creditHandle?: string; onCreditPress?: () => void }) {
  switch (ov.type) {
    case 'text': {
      const textColor = ov.bgStyle && ov.bgStyle !== 'none' ? (ov.color === '#FFFFFF' ? '#000' : '#FFF') : (ov.color ?? '#FFF');
      const bg = ov.bgStyle === 'solid' ? (ov.color ?? '#FFFFFF')
        : ov.bgStyle === 'translucent' ? `${ov.color ?? '#000000'}CC`
        : 'transparent';
      const effectStyle = ov.textEffect === 'outline'
        ? { textShadowColor: '#000', textShadowRadius: 3, textShadowOffset: { width: 0, height: 0 } }
        : ov.textEffect === 'glow'
        ? { textShadowColor: ov.color ?? '#FFF', textShadowRadius: 12, textShadowOffset: { width: 0, height: 0 } }
        : null;
      return (
        <View style={bg !== 'transparent' ? { backgroundColor: bg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4 } : undefined}>
          <Text style={[{ color: textColor, fontSize: ov.size ?? 28, fontFamily: storyFontFamily(ov.fontKey), textAlign: ov.align ?? 'center' }, effectStyle]}>
            {ov.text}
          </Text>
        </View>
      );
    }
    case 'mention':
      return <MentionStickerView handle={ov.mentionHandle} variant={ov.mentionStyle} />;
    case 'reshare_card':
      return <ReshareCard imageUri={ov.cardImageUri} radius={ov.cardRadius} handle={ctx?.creditHandle} onCreditPress={ctx?.onCreditPress} />;
    case 'location':
      return <View style={styles.pillChip}><Feather name="map-pin" size={12} color="#fff" /><Text style={styles.pillChipText}>{ov.locationLabel}</Text></View>;
    case 'time':
      return <View style={styles.pillChip}><Feather name="clock" size={12} color="#fff" /><Text style={styles.pillChipText}>{ov.text}</Text></View>;
    case 'question':
      return <QuestionSticker prompt={ov.questionPrompt ?? ''} mode="editor" />;
    case 'poll':
      return <PollSticker question={ov.pollQuestion ?? ''} options={(ov.pollOptions ?? []).map((o) => o.label)} mode="editor" />;
    case 'countdown':
      return <CountdownSticker name={ov.dropName ?? 'Drop'} releaseAt={ov.dropReleaseAt ?? null} mode="editor" />;
    case 'link':
      return <View style={styles.pillChip}><Feather name="link-2" size={12} color="#fff" /><Text style={styles.pillChipText}>{ov.linkText || ov.linkUrl}</Text></View>;
    case 'shop':
      return <View style={styles.pillChip}><Feather name="external-link" size={12} color="#fff" /><Text style={styles.pillChipText}>{ov.shopLabel || ov.shopUrl}</Text></View>;
    case 'product':
      return <ProductSticker name={ov.productName ?? 'Product'} imageUrl={ov.productImageUri} priceCents={ov.productPriceCents} mode="editor" />;
    case 'threadcash':
      return <View style={styles.pillChip}><ThreadCashBillIcon size={16} /><Text style={styles.pillChipText}>{ov.text}</Text></View>;    default:
      return null;
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  webFallback: { alignItems: 'center', justifyContent: 'center', gap: SP.md, paddingHorizontal: 32 },
  webFallbackText: { color: ON_DARK, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', lineHeight: 20, maxWidth: 280 },
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
  // Same 44pt width as camIconBtn (the X button directly above it), sharing
  // its left inset, so the "Aa" glyph's own center lines up exactly with
  // the X icon's center instead of sitting ~4pt further right.
  railBtn: { alignItems: 'center', gap: 4, minWidth: 44, minHeight: 44, marginBottom: SP.sm },
  railAa: { color: ON_DARK, fontSize: FS.lg, fontFamily: FONT.bold },
  railLabel: { color: TEXT_SECONDARY, fontSize: FS.xs, fontFamily: FONT.medium },
  gridPopover: {
    position: 'absolute', left: 50, top: 100, backgroundColor: 'rgba(30,30,34,0.95)',
    borderRadius: RADIUS.md, padding: SP.sm, flexDirection: 'row', flexWrap: 'wrap', width: 92,
  },
  gridOption: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', margin: 2 },
  changeGridPill: {
    position: 'absolute', alignSelf: 'center', left: 0, right: 0, marginHorizontal: 'auto', width: 140,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: radius.sm, paddingHorizontal: SP.sm, paddingVertical: 6, zIndex: 15,
  },
  changeGridText: { color: ON_DARK, fontSize: FS.xs, fontFamily: FONT.semibold },
  gridDots: { flexDirection: 'row', gap: 4, marginTop: SP.xs, justifyContent: 'center' },
  gridDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  gridComposite: { position: 'absolute', left: -9999, top: 0, backgroundColor: '#000' },

  camBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 20, alignItems: 'center' },
  modeRow: { flexDirection: 'row', gap: SP.lg, marginBottom: SP.md, position: 'relative' },
  modeItem: { minWidth: 44, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  // Slides beneath the active label on the same 150ms timing as the app's
  // other quick UI transitions — a plain timing, never a spring/bounce.
  modeIndicator: { position: 'absolute', left: 0, bottom: -6, height: 2, borderRadius: 1, backgroundColor: ON_DARK },
  modeText: { color: TEXT_TERTIARY, fontSize: FS.sm, fontFamily: FONT.semibold, letterSpacing: 0.5 },
  modeTextActive: { color: ON_DARK, fontSize: FS.base },

  controlsRow: {
    width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: SP.xl, marginBottom: SP.sm,
  },
  // Instagram-style latest-photo thumbnail: a thin solid white border, no
  // grey fill. The icon fallback (no permission / no photos yet) is on a
  // plain black background, not a translucent grey box.
  galleryThumb: {
    width: 44, height: 44, borderRadius: RADIUS.sm, overflow: 'hidden',
    backgroundColor: '#000', borderWidth: 1, borderColor: ON_DARK,
    alignItems: 'center', justifyContent: 'center',
  },
  galleryThumbImg: { width: '100%', height: '100%' },
  shutterWrap: { width: 76, height: 76, alignItems: 'center', justifyContent: 'center' },
  shutterRing: {
    width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: ON_DARK,
    alignItems: 'center', justifyContent: 'center',
  },
  progressRing: {
    position: 'absolute', width: 76, height: 76, borderRadius: 38,
    borderWidth: 4, borderColor: '#F87171', borderLeftColor: 'transparent', borderBottomColor: 'transparent',
  },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: ON_DARK },
  // Same translucent circle chip as every other floating control on this
  // screen (camIconBtn, galleryThumb) — flip used to float with no backdrop
  // at all, breaking the row's visual rhythm.
  flipBtn: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  hint: { color: TEXT_TERTIARY, fontFamily: FONT.regular, fontSize: FS.xs, marginBottom: SP.xs },

  // Create mode
  createCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl },
  createInput: { fontFamily: FONT.bold, minWidth: 60, textAlignVertical: 'center' },
  createToolbar: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', gap: SP.md, justifyContent: 'center', alignItems: 'center' },
  // 0.45 matches every other floating chip on this screen (camIconBtn,
  // flipBtn) — this one was a slightly lighter 0.4, an inconsistency in how
  // "solid" the dark chrome reads from one control to the next.
  createToolBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  createToolAa: { color: ON_DARK, fontSize: FS.base },
  colorCircle: { width: 28, height: 28, borderRadius: 14 },
  colorCircleActive: { borderWidth: 2, borderColor: ON_DARK },
  colorCircleBorder: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  bgSwatchRow: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', gap: SP.sm, justifyContent: 'center' },
  bgSwatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  bgSwatchActive: { borderWidth: 2.5, borderColor: ON_DARK },


  overlayChip: { position: 'absolute', top: 0, left: 0, zIndex: 15 },
  mentionDock: { position: 'absolute', left: SP.md, right: SP.md, zIndex: 22, flexDirection: 'row', alignItems: 'flex-end', gap: SP.sm },
  taggedChip: {
    minWidth: 44, height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingHorizontal: SP.sm, borderRadius: radius.md, backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1, borderColor: 'rgba(192,192,192,0.4)',
  },
  taggedChipText: { color: ON_DARK, fontSize: FS.sm, fontFamily: FONT.semibold },
  mentionControls: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(192,192,192,0.4)', paddingHorizontal: SP.sm, paddingVertical: 6 },
  mentionControlsLabel: { color: ON_DARK, fontSize: FS.xs, fontFamily: FONT.semibold, textTransform: 'capitalize' },
  mentionOpacityRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  mentionOpacityValue: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.medium, width: 34, textAlign: 'right' },

  reshareAction: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: radius.md, paddingHorizontal: SP.md },
  reshareActionOutline: { borderWidth: 1, borderColor: 'rgba(192,192,192,0.5)' },
  reshareActionLabel: { color: ON_DARK, fontSize: FS.sm, fontFamily: FONT.semibold },
  reshareNotNowWrap: { alignSelf: 'center', minHeight: 40, justifyContent: 'center', paddingHorizontal: SP.lg, marginTop: SP.xs, borderRadius: radius.md, backgroundColor: 'rgba(0,0,0,0.55)' },
  reshareNotNow: { color: ON_DARK, fontSize: FS.sm, fontFamily: FONT.semibold },
  reshareUnavailable: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(192,192,192,0.4)', padding: SP.md },
  reshareUnavailableTitle: { color: ON_DARK, fontSize: FS.base, fontFamily: FONT.semibold },
  reshareUnavailableSub: { color: MUTED, fontSize: FS.sm, fontFamily: FONT.regular },

  selectionOutline: { position: 'absolute', borderColor: 'rgba(255,255,255,0.9)', borderStyle: 'dashed' },
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
  captionInput: { color: ON_DARK, fontSize: FS.base, fontFamily: FONT.medium, paddingVertical: SP.sm, marginBottom: SP.xs },
  audienceRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  myStoryChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: RADIUS.pill, paddingHorizontal: SP.sm, paddingVertical: 6 },
  myAvatar: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#444', alignItems: 'center', justifyContent: 'center' },
  myAvatarText: { color: ON_DARK, fontSize: 10, fontFamily: FONT.bold },
  myStoryLabel: { color: ON_DARK, fontSize: FS.xs, fontFamily: FONT.semibold },
  closeFriendsChip: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: radius.sm, paddingHorizontal: SP.sm, paddingVertical: 6 },
  closeFriendsLabel: { color: TEXT_SECONDARY, fontSize: FS.xs, fontFamily: FONT.medium, flex: 1 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: ON_DARK, alignItems: 'center', justifyContent: 'center' },

  // Text tool
  textToolBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)' },
  textToolTop: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: SP.md },
  textToolCancel: { color: TEXT_SECONDARY, fontSize: FS.base, fontFamily: FONT.medium },
  textToolDone: { color: ON_DARK, fontSize: FS.base, fontFamily: FONT.bold },
  textToolCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl },
  textToolInput: { fontFamily: FONT.bold, minWidth: 60, paddingHorizontal: 8, borderRadius: 6 },
  textToolBottom: { paddingHorizontal: SP.md, gap: SP.sm },
  textToolRow: { flexDirection: 'row', gap: SP.sm },
  textToolChip: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  textToolChipText: { color: ON_DARK, fontSize: FS.base, fontFamily: FONT.bold },
  textToolChipGlyph: { color: ON_DARK, fontSize: 13, fontFamily: FONT.bold },
  textToolColorRow: { flexDirection: 'row', gap: SP.sm, flexWrap: 'wrap' },
  colorWheelDot: { width: 22, height: 22, borderRadius: 11 },
  fontChipRow: { maxHeight: 34 },
  fontChip: { paddingHorizontal: SP.sm, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: 'rgba(255,255,255,0.12)' },
  fontChipText: { color: ON_DARK, fontSize: FS.sm },
  textAccessoryRow: { flexDirection: 'row', alignItems: 'center', paddingTop: SP.xs },
  textAccessoryItem: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'center', paddingVertical: SP.xs },
  textAccessoryLabel: { color: ON_DARK, fontSize: FS.sm, fontFamily: FONT.medium },
  textAccessoryDivider: { width: StyleSheet.hairlineWidth, height: 16, backgroundColor: 'rgba(255,255,255,0.25)' },
  textColorSheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: CARD, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: SP.md },
  sheetSubtitle: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.regular, marginTop: -SP.sm, marginBottom: SP.md },
  animationGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginTop: SP.sm },
  animationChip: { paddingHorizontal: SP.md, paddingVertical: SP.sm, borderRadius: RADIUS.md, backgroundColor: 'rgba(255,255,255,0.1)' },
  animationChipText: { color: ON_DARK, fontFamily: FONT.semibold, fontSize: FS.sm },
  sizeSlider: { position: 'absolute', left: SP.sm, top: '25%', bottom: '25%', width: 32, alignItems: 'center', justifyContent: 'center', zIndex: 30 },
  sizeSliderTrack: { width: 3, flex: 1, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)' },
  sizeSliderThumb: { position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: ON_DARK, borderWidth: 2, borderColor: '#000' },
  hsbPicker: { marginTop: SP.md, gap: SP.sm },
  hsbLabel: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.medium },
  hsbTrack: { height: 28, borderRadius: 14, justifyContent: 'center' },
  hsbThumb: { position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', borderWidth: 2, borderColor: '#000', top: 3 },

  // Sticker sheet
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  stickerSheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: CARD, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: SP.md },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: SP.sm },
  sheetTitle: { color: FG, fontFamily: FONT.semibold, fontSize: FS.md, marginBottom: SP.md },
  stickerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  stickerTile: { width: Math.floor((W - SP.md * 2 - SP.sm * 3) / 4), height: 78, borderRadius: RADIUS.md, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center', gap: 6 },
  stickerTileLabel: { color: ON_DARK, fontSize: FS.xs, fontFamily: FONT.medium },
  emptyText: { color: MUTED, fontSize: FS.sm, textAlign: 'center', padding: SP.lg },
  productRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER },
  productRowText: { color: FG, fontSize: FS.base, fontFamily: FONT.medium },

  // Share sheet
  shareSheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: CARD, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: SP.md },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.sm },
  shareRowAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#444', alignItems: 'center', justifyContent: 'center' },
  shareRowTitle: { color: FG, fontSize: FS.base, fontFamily: FONT.semibold },
  shareRowSubtitle: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  radioOuter: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  radioOuterActive: { borderColor: ON_DARK },
  radioInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: ON_DARK },

  // "Also share to"
  alsoShareSheet: { flex: 1, backgroundColor: '#000', paddingHorizontal: SP.md },
  alsoShareSearchWrap: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: RADIUS.md, paddingHorizontal: SP.sm, marginTop: SP.sm },
  alsoShareSearchInput: { flex: 1, color: ON_DARK, fontSize: FS.base, paddingVertical: SP.sm },
  alsoShareRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.sm },
  alsoShareSendBtn: { paddingHorizontal: SP.md, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: ON_DARK, minWidth: 64, alignItems: 'center' },
  alsoShareSendBtnSent: { backgroundColor: 'rgba(255,255,255,0.15)' },
  alsoShareSendText: { color: '#000', fontFamily: FONT.semibold, fontSize: FS.sm },
  alsoShareHint: { color: MUTED, fontSize: FS.sm, textAlign: 'center', marginTop: SP.xl },

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
  questionInputMockText: { color: TEXT_TERTIARY, fontSize: FS.sm },
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
