// ─── Create Post Screen — TikTok-style full-screen media-first flow ────────────
// Screen A: media-pick   → full-screen black, bottom upload/camera row
// Screen B: video-edit   → full-screen video preview, floating right toolbar
// Screen C: post-details → caption + thumbnail at top, settings rows, dual CTA
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Modal, Animated, Dimensions, Platform,
  ActivityIndicator, Alert, Image, Pressable, PanResponder,
  StatusBar,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { FONT, FS } from '@/lib/theme';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { getTaggableProducts } from '@/services/productService';
import {
  createSellerPost, getSellerPosts, updateSellerPost,
  type SellerThreadPost,
} from '@/services/socialService';
import type { Product } from '@/services/productTypes';
import type {
  Sound, PostProductTag, PostPersonTag, PostHashtag, PostVisibility,
  MaxVideoDuration, ContentType,
} from '@/services/types';
import { useColors } from '@/hooks/useColors';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { useApi } from '@/lib/api';
import {
  markVideoClipUploaded, normalizeTrimBounds,
  createPhotoSlide, updateSlideUploadState, updateSlideOverlays, updateSlideFilter, removePhotoSlide, moveSlide,
  slidesToComposePayload,
  type EditablePhotoSlide, type ComposedSlideshowResult,
} from '@/lib/videoEditing';
import type { TextOverlay } from '@/lib/videoEditing';
import { TextOverlayEditor, OverlayChip } from '@/components/TextOverlayEditor';
import { isSellerSetupOrigin, SELLER_HOME_ROUTE } from '@/lib/setupNavigation';
import { completeSetupTaskAfter } from '@/lib/setupCompletion';
import { SheetRise } from '@/components/motion/SheetRise';
import { HapticSwitch } from '@/components/BrandthreadUI';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { MediaGrid, type MediaGridAsset } from '@/components/create-post/MediaGrid';
import { RADII } from '@/constants/radii';
import { SPACING } from '@/constants/spacing';
import { FADE_MS } from '@/constants/motion';
import { Glass } from '@/components/ui/Glass';
import { PressableScale } from '@/components/BrandthreadUI';
import {
  type CropAspect, type CropTransform, DEFAULT_CROP_TRANSFORM,
  clampCropTransform, applyPhotoCrop,
} from '@/lib/photoCrop';
import { WEB_INPUT_RESET } from '@/lib/inputReset';

// ─── Design tokens ────────────────────────────────────────────────────────────
const { width: SW } = Dimensions.get('window');
let ts: any = {};
let ms: any = {};
let dps: any = {};

// ─── Caption screen + tag-people sheet styles (colors applied inline) ────────
const cps = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: FS.md, fontFamily: FONT.bold },
  // Both inputs below drop the browser's default focus outline on web (it
  // renders as a colored ring, breaking monochrome) — same pattern as
  // components/checkout/CheckoutPrimitives.tsx's `input` style; the field's
  // own border already shows focus.
  input: {
    fontSize: FS.base, fontFamily: FONT.regular, minHeight: 140,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  tagChip: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 14,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  tagChipText: { fontSize: FS.xs, fontFamily: FONT.semibold },
  chipRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
  chip: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 16,
    paddingHorizontal: 12, height: 34,
  },
  chipText: { fontSize: FS.xs, fontFamily: FONT.semibold },
  hashtagInput: {
    fontSize: FS.sm, fontFamily: FONT.regular, borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
});

const tps = StyleSheet.create({
  title: { fontSize: FS.md, fontFamily: FONT.bold, marginBottom: 12 },
  mediaBox: { width: '100%', aspectRatio: 1, borderRadius: RADII.card, overflow: 'hidden', backgroundColor: '#111', marginBottom: 12 },
  pin: { position: 'absolute', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, overflow: 'hidden', maxWidth: 140 },
  pinText: { color: '#fff', fontSize: FS.xs, fontFamily: FONT.semibold },
  pinDot: { position: 'absolute', width: 12, height: 12, borderRadius: 6, backgroundColor: '#fff', marginLeft: -6, marginTop: -6 },
  searchInput: {
    fontSize: FS.sm, fontFamily: FONT.regular, borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  resultRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, minHeight: 44,
  },
  resultName: { fontSize: FS.sm, fontFamily: FONT.semibold },
  taggedList: { marginTop: 12, gap: 6 },
  taggedRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
  },
});

// ─── Types ────────────────────────────────────────────────────────────────────
type Step = 'media-pick' | 'photo-crop' | 'video-edit' | 'slide-edit' | 'post-details' | 'publishing' | 'done';

interface VideoClipLocal {
  uri: string; duration: number; id: string;
  speed: 0.5 | 1 | 2 | 3; filter: 'none' | 'warm' | 'cool' | 'mono';
  objectPath?: string;
}
interface ComposedVideoLocal {
  mediaUrl: string; mediaPath: string;
  thumbnailUrl: string; thumbnailPath: string; duration: number;
}
interface SlidePhotoLocal { uri: string; id: string; filter?: 'none' | 'warm' | 'cool' | 'mono'; }
interface SoundSelection {
  soundId: string; soundTitle: string; artist: string; startTime: number; volume: number;
}

const DEFAULT_VISIBILITY: PostVisibility = {
  isPublic: true, allowComments: true, allowReposts: true, showLikeCount: true,
};

// Effects tool (video-edit editor) — same clip-level filter/speed fields
// camera-capture.tsx already threads onto a VideoClipLocal, just exposed
// here as a post-capture editing surface instead of only at record time.
const EDITOR_FILTERS: Array<{ id: 'none' | 'warm' | 'cool' | 'mono'; label: string }> = [
  { id: 'none', label: 'Original' },
  { id: 'warm', label: 'Warm' },
  { id: 'cool', label: 'Cool' },
  { id: 'mono', label: 'Mono' },
];
const EDITOR_SPEEDS: Array<0.5 | 1 | 2 | 3> = [0.5, 1, 2, 3];

// ─── Full-screen video preview ─────────────────────────────────────────────────
function FullVideoPreview({ uri, seekTime, playbackRate = 1, paused = false }: {
  uri: string; seekTime?: number; playbackRate?: number; paused?: boolean;
}) {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.play(); });
  useEffect(() => {
    if (seekTime === undefined || !Number.isFinite(seekTime)) return;
    player.currentTime = Math.max(0, seekTime);
  }, [player, seekTime]);
  useEffect(() => { player.playbackRate = playbackRate; }, [playbackRate, player]);
  useEffect(() => { if (paused) player.pause(); else player.play(); }, [paused, player]);
  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
    />
  );
}

// ─── Small inline video preview (for post-details thumbnail) ──────────────────
function ThumbVideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.play(); });
  return (
    <VideoView
      player={player}
      style={{ width: '100%', height: '100%' }}
      contentFit="cover"
      nativeControls={false}
    />
  );
}

// ─── Editor tool-row chip (Text / Sticker / Audio / Clip / Overlay / Effects / Trim) ──
function EditorToolChip({ icon, label, onPress, testID }: {
  icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void; testID?: string;
}) {
  const { theme } = useAppTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={ts.edToolChip}
      activeOpacity={0.75}
      accessibilityLabel={label}
      accessibilityRole="button"
      testID={testID}
    >
      <View style={ts.edToolChipIconWrap}>
        <Feather name={icon} size={19} color={theme.text} />
      </View>
      <Text style={ts.edToolChipLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Settings row ─────────────────────────────────────────────────────────────
function SettingsRow({ label, value, onPress, children }: {
  label: string; value?: string; onPress?: () => void; children?: React.ReactNode;
}) {
  const { theme } = useAppTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      style={ts.settingsRow}
    >
      <Text style={ts.settingsRowLabel}>{label}</Text>
      <View style={ts.settingsRowRight}>
        {value ? <Text style={ts.settingsRowValue}>{value}</Text> : null}
        {children}
        {onPress ? <Feather name="chevron-right" size={16} color={theme.muted} /> : null}
      </View>
    </TouchableOpacity>
  );
}

// ─── Date/time picker state ────────────────────────────────────────────────────
interface PickerState {
  year: number; month: number; day: number;
  hour: number; minute: number; ampm: 'AM' | 'PM';
}

function makeDefaultPickerState(): PickerState {
  const d = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
  let h = d.getHours();
  const ampm: 'AM' | 'PM' = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return {
    year: d.getFullYear(), month: d.getMonth(), day: d.getDate(),
    hour: h, minute: Math.floor(d.getMinutes() / 5) * 5, ampm,
  };
}

function pickerStateToDate(s: PickerState): Date {
  let h = s.hour % 12;
  if (s.ampm === 'PM') h += 12;
  return new Date(s.year, s.month, s.day, h, s.minute, 0, 0);
}

function isoFromPickerState(s: PickerState): string {
  return pickerStateToDate(s).toISOString();
}

function pickerStateFromISO(iso: string): PickerState {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return makeDefaultPickerState();
  let h = d.getHours();
  const ampm: 'AM' | 'PM' = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return {
    year: d.getFullYear(), month: d.getMonth(), day: d.getDate(),
    hour: h, minute: d.getMinutes(), ampm,
  };
}

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DAY_NAMES = ['Su','Mo','Tu','We','Th','Fr','Sa'];

// ─── Calendar/Time Picker Modal ───────────────────────────────────────────────
interface DatePickerModalProps {
  visible: boolean;
  initial: PickerState;
  onConfirm: (state: PickerState) => void;
  onClose: () => void;
  insets: { top: number; bottom: number };
}

function DatePickerModal({ visible, initial, onConfirm, onClose, insets }: DatePickerModalProps) {
  const { theme } = useAppTheme();
  const FG = theme.text;
  const MUTED = theme.muted;
  const PURPLE = theme.accent;
  const [ps, setPs] = useState<PickerState>(initial);

  // sync when re-opened with a different initial value
  useEffect(() => { if (visible) setPs(initial); }, [visible]);

  // calendar grid helpers
  const daysInMonth = new Date(ps.year, ps.month + 1, 0).getDate();
  const firstDow    = new Date(ps.year, ps.month, 1).getDay();

  function prevMonth() {
    setPs(prev => {
      let m = prev.month - 1; let y = prev.year;
      if (m < 0) { m = 11; y -= 1; }
      const maxDay = new Date(y, m + 1, 0).getDate();
      return { ...prev, year: y, month: m, day: Math.min(prev.day, maxDay) };
    });
  }
  function nextMonth() {
    setPs(prev => {
      let m = prev.month + 1; let y = prev.year;
      if (m > 11) { m = 0; y += 1; }
      const maxDay = new Date(y, m + 1, 0).getDate();
      return { ...prev, year: y, month: m, day: Math.min(prev.day, maxDay) };
    });
  }

  function isDayPast(day: number): boolean {
    const d = new Date(ps.year, ps.month, day, 23, 59, 59);
    return d < new Date();
  }

  function handleConfirm() {
    const chosen = pickerStateToDate(ps);
    if (chosen <= new Date()) {
      Alert.alert('Choose a future time', 'Scheduled time must be in the future.');
      return;
    }
    onConfirm(ps);
  }

  // build cell grid (leading blank + day cells)
  const cells: (number | null)[] = Array(firstDow).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const selectedDateLabel = `${MONTH_NAMES[ps.month]} ${ps.day}, ${ps.year}`;
  const selectedTimeLabel = `${ps.hour}:${String(ps.minute).padStart(2, '0')} ${ps.ampm}`;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View style={dps.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <SheetRise style={[dps.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          {/* Handle */}
          <View style={dps.handle} />

          {/* Title row */}
          <View style={dps.titleRow}>
            <Text style={dps.title}>Schedule Post</Text>
            <TouchableOpacity onPress={onClose} style={dps.closeBtn} accessibilityLabel="Close date picker">
              <Feather name="x" size={18} color={FG} />
            </TouchableOpacity>
          </View>

          {/* Selected summary */}
          <View style={dps.summaryRow}>
            <Feather name="calendar" size={13} color={PURPLE} />
            <Text style={[dps.summaryText, { color: PURPLE }]}>{selectedDateLabel}</Text>
            <Feather name="clock" size={13} color={PURPLE} style={{ marginLeft: 10 }} />
            <Text style={[dps.summaryText, { color: PURPLE }]}>{selectedTimeLabel}</Text>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* ── Month navigation ── */}
            <View style={dps.monthNav}>
              <TouchableOpacity onPress={prevMonth} style={dps.monthNavBtn} accessibilityLabel="Previous month">
                <Feather name="chevron-left" size={20} color={FG} />
              </TouchableOpacity>
              <Text style={dps.monthLabel}>{MONTH_NAMES[ps.month]} {ps.year}</Text>
              <TouchableOpacity onPress={nextMonth} style={dps.monthNavBtn} accessibilityLabel="Next month">
                <Feather name="chevron-right" size={20} color={FG} />
              </TouchableOpacity>
            </View>

            {/* ── Day-of-week header ── */}
            <View style={dps.dowRow}>
              {DAY_NAMES.map(d => (
                <Text key={d} style={dps.dowText}>{d}</Text>
              ))}
            </View>

            {/* ── Calendar grid ── */}
            <View style={dps.calGrid}>
              {cells.map((day, idx) => {
                if (day === null) return <View key={`blank-${idx}`} style={dps.calCell} />;
                const selected = day === ps.day;
                const past     = isDayPast(day);
                return (
                  <TouchableOpacity
                    key={`day-${day}`}
                    style={[
                      dps.calCell,
                      selected && { backgroundColor: PURPLE, borderRadius: 20 },
                      past && !selected && { opacity: 0.3 },
                    ]}
                    onPress={() => { if (!past) { Haptics.selectionAsync(); setPs(prev => ({ ...prev, day })); } }}
                    disabled={past}
                    accessibilityLabel={`Day ${day}${past ? ', past' : ''}`}
                    testID={`calendar-day-${day}`}
                  >
                    <Text style={[dps.calDayText, selected && { color: theme.onAccent, fontFamily: FONT.bold }]}>
                      {day}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* ── Time section ── */}
            <View style={dps.timeSection}>
              <Text style={dps.timeSectionLabel}>Time</Text>

              <View style={dps.timeRow}>
                {/* Hour stepper */}
                <View style={dps.stepper}>
                  <TouchableOpacity
                    style={dps.stepBtn}
                    onPress={() => { Haptics.selectionAsync(); setPs(prev => { const h = prev.hour === 12 ? 1 : prev.hour + 1; return { ...prev, hour: h }; }); }}
                    accessibilityLabel="Increase hour"
                    testID="hour-up"
                  >
                    <Feather name="chevron-up" size={16} color={FG} />
                  </TouchableOpacity>
                  <Text style={dps.stepValue} testID="hour-display">{String(ps.hour).padStart(2, '0')}</Text>
                  <TouchableOpacity
                    style={dps.stepBtn}
                    onPress={() => { Haptics.selectionAsync(); setPs(prev => { const h = prev.hour === 1 ? 12 : prev.hour - 1; return { ...prev, hour: h }; }); }}
                    accessibilityLabel="Decrease hour"
                    testID="hour-down"
                  >
                    <Feather name="chevron-down" size={16} color={FG} />
                  </TouchableOpacity>
                </View>

                <Text style={dps.timeSep}>:</Text>

                {/* Minute stepper */}
                <View style={dps.stepper}>
                  <TouchableOpacity
                    style={dps.stepBtn}
                    onPress={() => { Haptics.selectionAsync(); setPs(prev => ({ ...prev, minute: (prev.minute + 5) % 60 })); }}
                    accessibilityLabel="Increase minute"
                    testID="minute-up"
                  >
                    <Feather name="chevron-up" size={16} color={FG} />
                  </TouchableOpacity>
                  <Text style={dps.stepValue} testID="minute-display">{String(ps.minute).padStart(2, '0')}</Text>
                  <TouchableOpacity
                    style={dps.stepBtn}
                    onPress={() => { Haptics.selectionAsync(); setPs(prev => ({ ...prev, minute: (prev.minute - 5 + 60) % 60 })); }}
                    accessibilityLabel="Decrease minute"
                    testID="minute-down"
                  >
                    <Feather name="chevron-down" size={16} color={FG} />
                  </TouchableOpacity>
                </View>

                {/* AM / PM toggle */}
                <View style={dps.ampmWrap}>
                  {(['AM', 'PM'] as const).map(val => (
                    <TouchableOpacity
                      key={val}
                      style={[dps.ampmBtn, ps.ampm === val && { backgroundColor: PURPLE, borderColor: PURPLE }]}
                      onPress={() => { Haptics.selectionAsync(); setPs(prev => ({ ...prev, ampm: val })); }}
                      accessibilityLabel={val}
                      testID={`ampm-${val}`}
                    >
                      <Text style={[dps.ampmText, ps.ampm === val && { color: theme.onAccent }]}>{val}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          </ScrollView>

          {/* Confirm */}
          <Button
            label="Confirm"
            variant="primary"
            fullWidth
            style={dps.confirmBtn}
            onPress={handleConfirm}
            accessibilityLabel="Confirm schedule"
            testID="confirm-schedule"
          />
        </SheetRise>
      </View>
    </Modal>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function CreatePostScreen() {
  const colors   = useColors();
  const { theme } = useAppTheme();
  const BG = theme.background;
  const BG_SOFT = theme.surface;
  const CARD = theme.card;
  const BORDER = theme.border;
  const FG = theme.text;
  const MUTED = theme.muted;
  const ORANGE = theme.warning;
  const RED = theme.error;
  Object.assign(ts, createTs(theme));
  Object.assign(ms, createMs(theme));
  Object.assign(dps, createDps(theme));
  const PURPLE   = colors.primary;
  const insets   = useSafeAreaInsets();
  const router   = useRouter();
  const api      = useApi();
  const params   = useLocalSearchParams<{ accountType?: string; editId?: string; from?: string; mode?: string }>();
  const isBuyer  = params.accountType === 'buyer';
  const editId   = typeof params.editId === 'string' ? params.editId : undefined;
  const isSellerSetup = isSellerSetupOrigin(params.from);

  const topPad = Platform.OS === 'web' ? Math.max(insets.top, 54) : insets.top;
  const botPad = insets.bottom;

  function leaveSetupDestination() {
    if (isSellerSetup) { router.replace(SELLER_HOME_ROUTE as never); return; }
    goBackOr(router);
  }

  // ── Step ──
  const [step, setStep] = useState<Step>('media-pick');

  // ── Media ──
  const [videoClips,    setVideoClips]   = useState<VideoClipLocal[]>([]);
  const [slidePhotos,   setSlidePhotos]  = useState<SlidePhotoLocal[]>([]);
  // ── Photo crop step (between media-pick and slide-edit for photos) ──
  const [cropAspect, setCropAspect] = useState<CropAspect>('original');
  const [cropIndex, setCropIndex] = useState(0);
  const [cropTransforms, setCropTransforms] = useState<Record<string, CropTransform>>({});
  const [croppingPhotos, setCroppingPhotos] = useState(false);

  // ── Slide edit: editable slides with per-slide overlays ──
  const [editableSlides,    setEditableSlides]    = useState<EditablePhotoSlide[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [composedSlideshow, setComposedSlideshow] = useState<ComposedSlideshowResult | null>(null);
  const [slideProcessingPhase, setSlideProcessingPhase] = useState<'idle' | 'uploading' | 'composing' | 'error' | 'ready'>('idle');
  const [slideProcessingError, setSlideProcessingError] = useState<string | null>(null);
  // ── Slide-edit text overlay editor state ──
  const [slideShowTextEditor, setSlideShowTextEditor] = useState(false);
  const [slideEditingOverlayId, setSlideEditingOverlayId] = useState<string | undefined>(undefined);
  const [slideZoomed, setSlideZoomed] = useState(false);
  const [maxDuration,   setMaxDuration]  = useState<MaxVideoDuration>(30);
  const [trimStart,     setTrimStart]    = useState(0);
  const [trimEnd,       setTrimEnd]      = useState(0);
  const [scrubTime,     setScrubTime]    = useState(0);
  const [previewSeekTime,setPreviewSeekTime] = useState(0);
  const [previewClipIndex,setPreviewClipIndex] = useState(0);
  const [composedVideo, setComposedVideo] = useState<ComposedVideoLocal | null>(null);
  const [settingCover, setSettingCover] = useState(false);
  const [processingPhase, setProcessingPhase] = useState<'idle'|'uploading'|'processing'|'error'|'ready'>('idle');
  const [processingError, setProcessingError] = useState<string | null>(null);
  const timelineWidthRef = useRef(1);

  // ── Editor chrome (Instagram-style rounded card) ──
  const [videoPaused, setVideoPaused] = useState(false);
  const [showTrimSheet, setShowTrimSheet] = useState(false);
  const [showEffectsSheet, setShowEffectsSheet] = useState(false);
  const [showSlideEffectsSheet, setShowSlideEffectsSheet] = useState(false);
  const pauseGlyphAnim = useRef(new Animated.Value(0)).current;
  const [showPauseGlyph, setShowPauseGlyph] = useState(false);
  const pauseGlyphTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Post details ──
  const [caption,            setCaption]            = useState('');
  const [hashtags,           setHashtags]           = useState<PostHashtag[]>([]);
  const [hashtagInput,       setHashtagInput]       = useState('');
  const [location,           setLocation]           = useState('');
  const [visibility,         setVisibility]         = useState<PostVisibility>(DEFAULT_VISIBILITY);
  // `?mode=schedule` (the profile Schedule tab's empty-state CTA) opens with scheduling preselected.
  const [scheduleMode,       setScheduleMode]       = useState<'now'|'schedule'>(params.mode === 'schedule' ? 'schedule' : 'now');
  const [scheduledAt,        setScheduledAt]        = useState<string | null>(null);
  const [pickerState,        setPickerState]        = useState<PickerState>(makeDefaultPickerState);
  const [showDatePicker,     setShowDatePicker]     = useState(false);
  const [productTags,        setProductTags]        = useState<PostProductTag[]>([]);
  const [taggedPeople,       setTaggedPeople]        = useState<PostPersonTag[]>([]);
  const [showCaptionScreen,  setShowCaptionScreen]   = useState(false);
  const [showTagPeopleSheet, setShowTagPeopleSheet]  = useState(false);
  const [taggableProducts,   setTaggableProducts]   = useState<Product[]>([]);
  const [loadingTaggable,    setLoadingTaggable]    = useState(false);
  const [styleTags,          setStyleTags]          = useState<string[]>([]);

  // ── Sound / overlays ──
  const [selectedSound,  setSelectedSound]  = useState<SoundSelection | null>(null);

  // ── Text overlays ──
  const [textOverlays,        setTextOverlays]        = useState<TextOverlay[]>([]);
  const [showTextEditor,      setShowTextEditor]       = useState(false);
  const [editingOverlayId,    setEditingOverlayId]     = useState<string | undefined>(undefined);
  const videoCanvasRef = useRef<View>(null);
  const [canvasLayout,        setCanvasLayout]         = useState({ width: SW, height: SW * (16 / 9) });

  // ── Modals ──
  const [showSoundModal,   setShowSoundModal]   = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);

  // ── Sound modal ──
  const [soundTab,    setSoundTab]    = useState<'trending'|'saved'|'recent'|'original'|'royalty_free'>('trending');
  const [soundSearch, setSoundSearch] = useState('');

  // ── Product modal ──
  const [productSearch, setProductSearch] = useState('');

  // ── Publishing / saving ──
  const [isPublishing, setIsPublishing] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [editingPost,  setEditingPost]  = useState<SellerThreadPost | null>(null);
  const [loadingEdit,  setLoadingEdit]  = useState(!!editId);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  function fetchTaggableProducts() {
    setLoadingTaggable(true);
    getTaggableProducts()
      .then(p  => setTaggableProducts(p))
      .catch(() => setTaggableProducts([]))
      .finally(() => setLoadingTaggable(false));
  }

  useEffect(() => { fetchTaggableProducts(); }, []);

  useEffect(() => {
    if (!editId) return;
    let active = true;
    setLoadingEdit(true);
    getSellerPosts()
      .then((posts) => {
        if (!active) return;
        const post = posts.find(item => item.id === editId);
        if (!post) { leaveSetupDestination(); return; }
        setEditingPost(post);
        setCaption(post.caption);
        setHashtags(post.hashtags.map(tag => ({ tag })));
        setStyleTags(post.styleTags ?? []);
        setProductTags(post.productTags.map(tag => ({
          productId: tag.productId, productName: tag.productName, priceCents: tag.priceCents,
        })));
        setTaggedPeople((post.taggedPeople ?? []).map(tag => ({
          userId: tag.userId, displayName: tag.displayName, avatarUrl: tag.avatarUrl, x: tag.x, y: tag.y, slideIndex: tag.slideIndex,
        })));
        setSelectedSound(post.sound ?? null);
        setVisibility({ isPublic: true, ...post.visibility });
        if (post.scheduledAt) {
          setScheduledAt(post.scheduledAt);
          setPickerState(pickerStateFromISO(post.scheduledAt));
        }
        setScheduleMode(post.postStatus === 'scheduled' ? 'schedule' : 'now');
        if (post.contentType === 'video' && post.mediaUris[0]) {
          setVideoClips([{ uri: post.mediaUris[0], duration: 0, id: `edit-video-${post.id}`, speed: 1, filter: 'none' }]);
          setSlidePhotos([]);
          setEditableSlides([]);
        } else if (post.contentType === 'slideshow' && post.mediaUris.length > 0) {
          // Restore slideshow: rebuild editable slides from saved mediaUris + slideOverlays
          const savedOverlayMap = new Map<number, TextOverlay[]>();
          if (Array.isArray(post.slideOverlays)) {
            for (const entry of post.slideOverlays) {
              if (typeof entry.slideIndex === 'number' && Array.isArray(entry.overlays)) {
                savedOverlayMap.set(entry.slideIndex, entry.overlays as TextOverlay[]);
              }
            }
          }
          const restoredSlides: EditablePhotoSlide[] = post.mediaUris.map((uri, idx) => ({
            id: `edit-slide-${post.id}-${idx}`,
            uri,
            overlays: savedOverlayMap.get(idx) ?? [],
            uploadState: 'idle' as const,
            filter: 'none' as const,
          }));
          setSlidePhotos(post.mediaUris.map((uri, idx) => ({ uri, id: `edit-slide-${post.id}-${idx}` })));
          setEditableSlides(restoredSlides);
          setCurrentSlideIndex(0);
          setVideoClips([]);
          // Restore composed result if we have mediaPaths (so re-publish doesn't re-compose)
          if (Array.isArray(post.mediaPaths) && post.mediaPaths.length > 0) {
            setComposedSlideshow({
              mediaPaths: post.mediaPaths,
              mediaUrls: post.mediaUris,
              thumbnailPath: '',
              thumbnailUrl: post.thumbnailUri ?? '',
              slideCount: post.mediaUris.length,
            });
            setSlideProcessingPhase('ready');
          }
        } else {
          setSlidePhotos(post.mediaUris.map((uri, index) => ({ uri, id: `edit-photo-${post.id}-${index}` })));
          setEditableSlides([]);
          setVideoClips([]);
        }
        setStep('post-details');
      })
      .catch(() => { if (!active) return; leaveSetupDestination(); })
      .finally(() => { if (active) setLoadingEdit(false); });
    return () => { active = false; };
  }, [editId]);

  useFocusEffect(
    useCallback(() => {
      const result = (global as any).__cameraCaptureResult as
        | { type: 'video'; clips?: Array<{ id: string; uri: string; duration: number; speed: 0.5|1|2|3; filter: 'none'|'warm'|'cool'|'mono' }>; uri?: string; duration: number; }
        | { type: 'photo'; uri: string; filter?: 'none'|'warm'|'cool'|'mono' }
        | null | undefined;
      if (!result) return;
      (global as any).__cameraCaptureResult = null;
      if (result.type === 'video') {
        const captured = result.clips?.length
          ? result.clips
          : result.uri
            ? [{ uri: result.uri, duration: result.duration, id: `cam_${Date.now()}`, speed: 1 as const, filter: 'none' as const }]
            : [];
        const total = captured.reduce((sum, clip) => sum + clip.duration / clip.speed, 0);
        setVideoClips(captured); setTrimStart(0); setTrimEnd(total); setScrubTime(0);
        setPreviewSeekTime(0); setPreviewClipIndex(0); setComposedVideo(null);
        setProcessingPhase('idle'); setProcessingError(null); setSlidePhotos([]);
      } else {
        setSlidePhotos(prev => [...prev, { uri: result.uri, id: `cam_${Date.now()}`, filter: result.filter ?? 'none' }]);
      }
    }, [])
  );

  // Auto-advance to post-details when slideshow is ready
  useEffect(() => {
    if (step === 'slide-edit' && slideProcessingPhase === 'ready' && composedSlideshow) {
      setStep('post-details');
    }
  }, [slideProcessingPhase, composedSlideshow, step]);

  useEffect(() => {
    if (step !== 'publishing') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [step]);

  // ── Derived ──
  const hasMedia   = videoClips.length > 0 || slidePhotos.length > 0;
  const canProceed = hasMedia;
  const previewClipIndexSafe = Math.min(previewClipIndex, Math.max(0, videoClips.length - 1));

  function inferContentType(): ContentType {
    if (isBuyer) return 'story';
    if (videoClips.length > 0) return 'video';
    if (slidePhotos.length > 0) return 'slideshow';
    return 'video';
  }

  function haptic(fn: () => void) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); fn(); }

  /** Tap-to-pause on the editor's rounded media card: toggles playback and
   *  fades a centered pause/play glyph in, then back out. */
  function toggleCardPlayback() {
    Haptics.selectionAsync();
    setVideoPaused(prev => !prev);
    setShowPauseGlyph(true);
    pauseGlyphAnim.setValue(1);
    if (pauseGlyphTimer.current) clearTimeout(pauseGlyphTimer.current);
    Animated.timing(pauseGlyphAnim, { toValue: 1, duration: 0, useNativeDriver: true }).start(() => {
      pauseGlyphTimer.current = setTimeout(() => {
        Animated.timing(pauseGlyphAnim, { toValue: 0, duration: FADE_MS, useNativeDriver: true })
          .start(() => setShowPauseGlyph(false));
      }, 500);
    });
  }

  /** Discard-changes confirm used by the editor's close (X) button — mirrors
   *  camera-capture.tsx's "Discard clips?" alert (Keep editing / Discard). */
  function confirmDiscardEdits(hasUnsavedEdits: boolean, onDiscard: () => void) {
    if (!hasUnsavedEdits) { haptic(onDiscard); return; }
    Alert.alert('Discard changes?', 'Your edits to this Thread will be lost.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => haptic(onDiscard) },
    ]);
  }

  function setClipFilter(filterValue: VideoClipLocal['filter']) {
    Haptics.selectionAsync();
    setVideoClips(prev => prev.map((c, i) => i === previewClipIndexSafe ? { ...c, filter: filterValue } : c));
    setComposedVideo(null); setProcessingPhase('idle'); setProcessingError(null);
  }

  function setClipSpeed(speedValue: VideoClipLocal['speed']) {
    Haptics.selectionAsync();
    setVideoClips(prev => prev.map((c, i) => i === previewClipIndexSafe ? { ...c, speed: speedValue } : c));
    setComposedVideo(null); setProcessingPhase('idle'); setProcessingError(null);
  }

  async function pickFromLibrary() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission required', 'Please allow access to your media library.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (result.canceled || result.assets.length === 0) return;
    const videos = result.assets.filter(a => a.type === 'video');
    const photos = result.assets.filter(a => a.type !== 'video');
    if (videos.length > 0) {
      const d = Math.max(0.1, (videos[0].duration ?? 0) / 1000);
      setVideoClips([{ uri: videos[0].uri, duration: d, id: `clip-${Date.now()}`, speed: 1, filter: 'none' }]);
      setTrimStart(0); setTrimEnd(d); setScrubTime(0); setPreviewSeekTime(0);
      setPreviewClipIndex(0); setComposedVideo(null); setProcessingPhase('idle');
      setProcessingError(null); setSlidePhotos([]);
    } else {
      setSlidePhotos(prev => [...prev, ...photos.map((a, i) => ({ uri: a.uri, id: `photo-${Date.now()}-${i}` }))]);
      setVideoClips([]);
    }
  }

  function addHashtag(raw: string) {
    const tag = raw.trim().startsWith('#') ? raw.trim() : `#${raw.trim()}`;
    if (tag.length > 1 && !hashtags.find(h => h.tag === tag)) setHashtags(prev => [...prev, { tag }]);
    setHashtagInput('');
  }

  function useSound(sound: Sound) {
    setSelectedSound({ soundId: sound.id, soundTitle: sound.title, artist: sound.artist, startTime: 0, volume: 1 });
    setShowSoundModal(false);
  }

  function openTextEditor(overlayId?: string) {
    setEditingOverlayId(overlayId);
    setShowTextEditor(true);
  }

  function handleTextOverlayDone(overlay: TextOverlay) {
    setTextOverlays(prev => {
      const existing = prev.find(o => o.id === overlay.id);
      if (existing) return prev.map(o => o.id === overlay.id ? overlay : o);
      return [...prev, overlay];
    });
    setShowTextEditor(false);
    setEditingOverlayId(undefined);
  }

  function handleTextOverlayCancel() {
    setShowTextEditor(false);
    setEditingOverlayId(undefined);
  }

  function moveOverlay(id: string, x: number, y: number) {
    setTextOverlays(prev => prev.map(o => o.id === id ? { ...o, x, y } : o));
  }

  function deleteOverlay(id: string) {
    setTextOverlays(prev => prev.filter(o => o.id !== id));
  }

  function tagProduct(p: Product) {
    const already = productTags.find(t => t.productId === p.id);
    if (already) setProductTags(prev => prev.filter(t => t.productId !== p.id));
    else setProductTags(prev => [...prev, { productId: p.id, productName: p.name, priceCents: p.pricing.priceCents }]);
  }

  function resetAll() {
    setStep('media-pick');
    setVideoClips([]); setSlidePhotos([]); setMaxDuration(30);
    setTrimStart(0); setTrimEnd(0); setScrubTime(0); setPreviewSeekTime(0); setPreviewClipIndex(0);
    setComposedVideo(null); setProcessingPhase('idle'); setProcessingError(null);
    setEditableSlides([]); setCurrentSlideIndex(0); setComposedSlideshow(null);
    setSlideProcessingPhase('idle'); setSlideProcessingError(null);
    setCaption(''); setHashtags([]); setHashtagInput(''); setStyleTags([]);
    setLocation(''); setVisibility(DEFAULT_VISIBILITY); setScheduleMode('now');
    setScheduledAt(null); setPickerState(makeDefaultPickerState()); setProductTags([]);
    setTaggedPeople([]);
    setSelectedSound(null); setTextOverlays([]);
  }

  /** Persists a draft or published post. Returns the created/updated SellerThreadPost. */
  async function persistSellerPost(isDraft: boolean): Promise<SellerThreadPost> {
    const contentType = inferContentType();
    const postStatus: SellerThreadPost['postStatus'] = isDraft
      ? 'draft'
      : scheduleMode === 'schedule' && scheduledAt
        ? 'scheduled' : 'published';

    // For slideshows: use composedSlideshow paths/URLs if ready
    const isSlideshow = contentType === 'slideshow';
    const mediaUris = composedSlideshow
      ? composedSlideshow.mediaUrls
      : composedVideo
        ? [composedVideo.mediaUrl]
        : videoClips.length > 0 ? videoClips.map(c => c.uri) : slidePhotos.map(p => p.uri);

    // Build slide overlays payload for persistence
    const slideOverlays = isSlideshow
      ? editableSlides.map((slide, idx) => ({
          slideIndex: idx,
          overlays: slide.overlays,
        })).filter(entry => entry.overlays.length > 0)
      : undefined;

    const values = {
      contentType, caption,
      hashtags: hashtags.map(h => h.tag),
      styleTags, mediaUris,
      mediaUrl: composedSlideshow?.mediaUrls[0] ?? composedVideo?.mediaUrl ?? mediaUris[0],
      mediaPath: composedVideo?.mediaPath,
      thumbnailPath: composedVideo?.thumbnailPath ?? composedSlideshow?.thumbnailPath,
      thumbnailUri: composedSlideshow?.thumbnailUrl ?? composedVideo?.thumbnailUrl ?? editingPost?.thumbnailUri,
      aspectRatio: '9:16' as const,
      mediaPaths: composedSlideshow?.mediaPaths ?? [],
      slideOverlays,
      productTags: productTags.map(pt => ({
        productId: pt.productId, productName: pt.productName, priceCents: pt.priceCents,
      })),
      taggedPeople: taggedPeople.map(pt => ({
        userId: pt.userId, displayName: pt.displayName, avatarUrl: pt.avatarUrl, x: pt.x, y: pt.y, slideIndex: pt.slideIndex,
      })),
      sound: selectedSound ?? undefined,
      visibility, isDraft,
      scheduledAt: isDraft || scheduleMode === 'now' ? null : scheduledAt,
    };
    let result: SellerThreadPost;
    if (editId) {
      result = await updateSellerPost(editId, { ...values, postStatus });
    } else {
      result = await createSellerPost(values);
    }
    // Guard: verify result is truly a draft when saving as draft
    if (isDraft && result.postStatus !== 'draft' && result.isDraft !== true) {
      // Treat as success anyway (server may normalise differently), but flag in dev
      if (__DEV__) {
        console.warn('[CreatePost] persistSellerPost(isDraft=true) returned non-draft record', result);
      }
    }
    return result;
  }

  /** Upload raw slides and compose them via the server. Sets composedSlideshow on success. */
  async function processSlideshow() {
    if (editableSlides.length === 0 || slideProcessingPhase === 'uploading' || slideProcessingPhase === 'composing') return;
    setSlideProcessingError(null);
    setSlideProcessingPhase('uploading');
    let localSlides = [...editableSlides];
    try {
      // Phase 1: Upload any slides that haven't been uploaded yet
      for (let i = 0; i < localSlides.length; i++) {
        if (localSlides[i].uploadState === 'uploaded' && localSlides[i].objectPath) continue;
        setEditableSlides(prev => updateSlideUploadState(prev, localSlides[i].id, 'uploading'));
        try {
          const result = await api.posts.uploadPhotoSlide(localSlides[i].uri, localSlides[i].mimeType);
          localSlides = updateSlideUploadState(localSlides, localSlides[i].id, 'uploaded', result.objectPath);
          setEditableSlides([...localSlides]);
        } catch (uploadErr) {
          const msg = `Couldn't upload slide ${i + 1}. Tap Retry.`;
          localSlides = updateSlideUploadState(localSlides, localSlides[i].id, 'error', undefined, msg);
          setEditableSlides([...localSlides]);
          throw new Error(msg);
        }
      }
      // Phase 2: Compose slideshow with overlays
      setSlideProcessingPhase('composing');
      const composePayload = slidesToComposePayload(localSlides);
      const composed = await api.posts.composeSlideshow({ slides: composePayload });
      setComposedSlideshow(composed);
      setSlideProcessingPhase('ready');
    } catch (err) {
      setSlideProcessingPhase('error');
      setSlideProcessingError(err instanceof Error && err.message.startsWith("Couldn't upload slide") ? err.message : "Couldn't upload slide. Tap Retry.");
    }
  }

  const totalVideoDuration = videoClips.reduce((sum, clip) => sum + clip.duration / clip.speed, 0);

  function updateTrim(nextStart: number, nextEnd: number) {
    const { start, end } = normalizeTrimBounds(totalVideoDuration, nextStart, nextEnd);
    setTrimStart(start); setTrimEnd(end);
    setScrubTime(Math.max(start, Math.min(scrubTime, end)));
    setComposedVideo(null); setProcessingPhase('idle'); setProcessingError(null);
  }

  async function processVideo() {
    if (videoClips.length === 0 || processingPhase === 'uploading' || processingPhase === 'processing') return;
    setProcessingError(null);
    setProcessingPhase('uploading');
    const uploaded = [...videoClips];
    try {
      for (let i = 0; i < uploaded.length; i += 1) {
        if (uploaded[i].objectPath) continue;
        const result = await api.posts.uploadVideoClip(uploaded[i].uri);
        const next = markVideoClipUploaded(uploaded, uploaded[i].id, result.objectPath);
        uploaded.splice(0, uploaded.length, ...next);
        setVideoClips([...uploaded]);
      }
      setProcessingPhase('processing');
      const result = await api.posts.composeVideo({
        clips: uploaded.map((clip) => ({
          objectPath: clip.objectPath!, duration: clip.duration,
          speed: clip.speed, filter: clip.filter,
        })),
        trimStart, trimEnd,
        textOverlays: textOverlays.length > 0 ? textOverlays.map(ov => ({
          id: ov.id,
          text: ov.text,
          x: ov.x,
          y: ov.y,
          color: ov.color,
          fontStyle: ov.fontStyle,
          align: ov.align,
          bgStyle: ov.bgStyle,
          fontSize: ov.fontSize,
          startTime: ov.startTime,
          endTime: ov.endTime,
        })) : undefined,
      });
      setComposedVideo(result);
      setVideoClips(uploaded.map(({ objectPath: _op, ...clip }) => clip));
      setScrubTime(0); setPreviewSeekTime(0); setProcessingPhase('ready');
    } catch (error) {
      setVideoClips([...uploaded]);
      setProcessingPhase('error');
      setProcessingError("Couldn't process your video. Tap Retry.");
    }
  }

  // Uses the video-edit step's own scrub position as the chosen cover frame
  // — re-extracts just that frame from the already-composed video instead
  // of re-encoding the whole clip. Previously "Edit cover" only reopened
  // the trim screen with no way to actually change which frame was used.
  async function useCurrentFrameAsCover() {
    if (!composedVideo || settingCover) return;
    setSettingCover(true);
    try {
      const result = await api.posts.composeVideoThumbnail(composedVideo.mediaPath, scrubTime);
      setComposedVideo(prev => prev ? { ...prev, thumbnailUrl: result.thumbnailUrl, thumbnailPath: result.thumbnailPath } : prev);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStep('post-details');
    } catch {
      Alert.alert("Couldn't set cover", 'Please try a different frame or try again.');
    } finally {
      setSettingCover(false);
    }
  }

  if (loadingEdit) {
    return (
      <View style={[ts.root, ts.center, { backgroundColor: BG }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[ts.muted, { marginTop: 12, fontSize: FS.sm }]}>Loading post...</Text>
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SCREEN A: MEDIA PICK — Instagram-style grid picker (ref: 01-picker-new-reel,
  // 01b-picker-new-post). Header "New Thread" · X close · Next (once media is
  // chosen). Large selection preview, "Recents" album row, camera tile + real
  // device photo/video grid (components/create-post/MediaGrid.tsx), and a
  // floating Thread/Story mode pill at the bottom.
  // ─────────────────────────────────────────────────────────────────────────────
  if (step === 'media-pick') {
    const selectedVideoUri = videoClips[0]?.uri ?? null;

    function goToNext() {
      haptic(() => {
        if (videoClips.length > 0) {
          setStep('video-edit');
        } else {
          setCropAspect('original');
          setCropIndex(0);
          setCropTransforms({});
          setStep('photo-crop');
        }
      });
    }

    function handleTogglePhoto(asset: MediaGridAsset) {
      setSlidePhotos(prev => {
        const exists = prev.some(p => p.uri === asset.uri);
        if (exists) return prev.filter(p => p.uri !== asset.uri);
        return [...prev, { uri: asset.uri, id: asset.id }];
      });
      setVideoClips([]);
    }

    function handleSelectVideo(asset: MediaGridAsset) {
      const alreadySelected = selectedVideoUri === asset.uri;
      if (alreadySelected) { setVideoClips([]); return; }
      const d = Math.max(0.1, asset.duration || 1);
      setVideoClips([{ uri: asset.uri, duration: d, id: `lib-${asset.id}`, speed: 1, filter: 'none' }]);
      setTrimStart(0); setTrimEnd(d); setScrubTime(0); setPreviewSeekTime(0);
      setPreviewClipIndex(0); setComposedVideo(null); setProcessingPhase('idle');
      setProcessingError(null); setSlidePhotos([]);
    }

    return (
      <View style={[ts.root, { backgroundColor: BG }]}>
        <StatusBar barStyle="light-content" backgroundColor={BG} />

        {/* ── HEADER ──────────────────────────────────────────── */}
        <View style={[ts.pkHeader, { paddingTop: topPad + 4 }]}>
          <TouchableOpacity
            onPress={() => haptic(leaveSetupDestination)}
            style={ts.pkHeaderBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Close"
            accessibilityRole="button"
          >
            <Feather name="x" size={24} color={FG} />
          </TouchableOpacity>
          <Text style={ts.pkHeaderTitle}>New Thread</Text>
          <View style={ts.pkHeaderRight}>
            {hasMedia && (
              <Button label="Next" variant="primary" size="compact" onPress={goToNext} testID="picker-next-btn" />
            )}
          </View>
        </View>

        {/* ── SELECTION PREVIEW ─────────────────────────────────── */}
        <View style={ts.pkPreviewBox}>
          {videoClips.length > 0 ? (
            <FullVideoPreview uri={videoClips[0].uri} />
          ) : slidePhotos.length > 0 ? (
            <Image source={{ uri: slidePhotos[slidePhotos.length - 1].uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <View style={ts.pkPreviewEmpty}>
              <Feather name="image" size={30} color={MUTED} />
            </View>
          )}
          {slidePhotos.length > 1 && (
            <View style={ts.pkMultiBadge}>
              <Feather name="copy" size={12} color={FG} />
              <Text style={ts.pkMultiBadgeText}>{slidePhotos.length}</Text>
            </View>
          )}
        </View>

        {/* ── GRID (Recents dropdown + camera tile + device photos/videos) ── */}
        <View style={ts.pkGridArea}>
          <MediaGrid
            selectedPhotoUris={slidePhotos.map(p => p.uri)}
            selectedVideoUri={selectedVideoUri}
            onTogglePhoto={handleTogglePhoto}
            onSelectVideo={handleSelectVideo}
            onPressCamera={() => router.push((`/camera-capture?maxDuration=${maxDuration}`) as never)}
            onPressWebUpload={pickFromLibrary}
          />
        </View>

        {/* ── FLOATING MODE PILL: Thread (selected) / Story ─────── */}
        <View style={[ts.pkModePillWrap, { bottom: botPad + 16 }]}>
          <View style={ts.pkModePill}>
            <View style={[ts.pkModePillBtn, ts.pkModePillBtnActive]}>
              <Text style={ts.pkModePillTextActive}>Thread</Text>
            </View>
            <TouchableOpacity
              style={ts.pkModePillBtn}
              onPress={() => { Haptics.selectionAsync(); router.replace('/buyer-story-create' as never); }}
              accessibilityLabel="Switch to Story"
              accessibilityRole="button"
            >
              <Text style={ts.pkModePillText}>Story</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Sound modal (still reachable — see editor's Audio tool) */}
        <SoundModal
          visible={showSoundModal} onClose={() => setShowSoundModal(false)}
          soundTab={soundTab} setSoundTab={setSoundTab}
          soundSearch={soundSearch} setSoundSearch={setSoundSearch}
          onUse={useSound} insets={insets}
        />
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SCREEN A2: PHOTO CROP — Instagram's post-creation crop screen (ref:
  // 01b-picker-new-post's follow-on crop step). Aspect toggle (Original /
  // Square / 4:5) shared across every selected photo, pinch-to-zoom-and-pan
  // crop box per photo. Crop is applied for real via expo-image-manipulator
  // on "Next" (lib/photoCrop.ts) — a no-op crop (Original, no zoom/pan) skips
  // re-encoding untouched photos.
  // ─────────────────────────────────────────────────────────────────────────────
  if (step === 'photo-crop') {
    const photo = slidePhotos[Math.min(cropIndex, Math.max(0, slidePhotos.length - 1))];
    const transform = (photo && cropTransforms[photo.id]) ?? DEFAULT_CROP_TRANSFORM;

    async function confirmCrop() {
      if (croppingPhotos) return;
      setCroppingPhotos(true);
      try {
        const cropped = await Promise.all(slidePhotos.map(async (p) => {
          const t = cropTransforms[p.id] ?? DEFAULT_CROP_TRANSFORM;
          const uri = await applyPhotoCrop(p.uri, cropAspect, t);
          return { ...p, uri };
        }));
        setSlidePhotos(cropped);
        const slides = cropped.map(p => ({ ...createPhotoSlide(p.id, p.uri), filter: p.filter ?? 'none' as const }));
        setEditableSlides(slides);
        setCurrentSlideIndex(0);
        setComposedSlideshow(null);
        setSlideProcessingPhase('idle');
        setSlideProcessingError(null);
        haptic(() => setStep('slide-edit'));
      } finally {
        setCroppingPhotos(false);
      }
    }

    return (
      <View style={[ts.root, { backgroundColor: BG }]}>
        <StatusBar barStyle="light-content" backgroundColor={BG} />

        <View style={[ts.pkHeader, { paddingTop: topPad + 4 }]}>
          <TouchableOpacity
            onPress={() => haptic(() => setStep('media-pick'))}
            style={ts.pkHeaderBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Back"
            accessibilityRole="button"
          >
            <Feather name="arrow-left" size={22} color={FG} />
          </TouchableOpacity>
          <Text style={ts.pkHeaderTitle}>Edit</Text>
          <View style={ts.pkHeaderRight}>
            <Button
              label="Next" variant="primary" size="compact"
              loading={croppingPhotos}
              onPress={confirmCrop}
              testID="crop-next-btn"
            />
          </View>
        </View>

        {photo && (
          <PhotoCropBox
            key={photo.id}
            uri={photo.uri}
            aspect={cropAspect}
            transform={transform}
            onChange={(next) => setCropTransforms(prev => ({ ...prev, [photo.id]: next }))}
          />
        )}

        {slidePhotos.length > 1 && (
          <View style={ts.cropPagerRow} pointerEvents="box-none">
            <PressableScale
              onPress={() => setCropIndex(i => Math.max(0, i - 1))}
              disabled={cropIndex === 0}
              style={[ts.cropPagerBtn, { opacity: cropIndex === 0 ? 0.3 : 1 }]}
              accessibilityLabel="Previous photo"
            >
              <Glass variant="regular" tint="dark" radius={18} style={StyleSheet.absoluteFill} />
              <Feather name="chevron-left" size={18} color={FG} />
            </PressableScale>
            <View style={ts.cropDotsRow}>
              {slidePhotos.map((p, i) => (
                <View key={p.id} style={[ts.slideDot, i === cropIndex && ts.slideDotActive]} />
              ))}
            </View>
            <PressableScale
              onPress={() => setCropIndex(i => Math.min(slidePhotos.length - 1, i + 1))}
              disabled={cropIndex === slidePhotos.length - 1}
              style={[ts.cropPagerBtn, { opacity: cropIndex === slidePhotos.length - 1 ? 0.3 : 1 }]}
              accessibilityLabel="Next photo"
            >
              <Glass variant="regular" tint="dark" radius={18} style={StyleSheet.absoluteFill} />
              <Feather name="chevron-right" size={18} color={FG} />
            </PressableScale>
          </View>
        )}

        <View style={[ts.cropAspectRow, { paddingBottom: botPad + 16 }]}>
          {(['original', 'square', '4:5'] as CropAspect[]).map(a => (
            <PressableScale
              key={a}
              onPress={() => { void Haptics.selectionAsync(); setCropAspect(a); }}
              style={ts.cropAspectChip}
              accessibilityLabel={a === 'original' ? 'Original aspect' : a === 'square' ? 'Square aspect' : '4 by 5 aspect'}
              testID={`crop-aspect-${a}`}
            >
              <Glass variant={cropAspect === a ? 'pressed' : 'regular'} tint="dark" radius={18} style={StyleSheet.absoluteFill} />
              <Text style={[ts.cropAspectText, { color: cropAspect === a ? FG : MUTED }]}>
                {a === 'original' ? 'Original' : a === 'square' ? 'Square' : '4:5'}
              </Text>
            </PressableScale>
          ))}
        </View>
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SCREEN B2: SLIDE EDIT — same rounded-card editor chrome as video-edit, for
  // a photo/slideshow. Tap the card to view it large; tool row covers what
  // applies to a photo (Text/Sticker/Overlay share the text-overlay system;
  // Trim doesn't apply to a still photo so it's dropped). Effects now carries
  // the slide's own colour filter (see the Effects tool chip below), applied
  // for real by compose-slideshow's ffmpeg render — same mechanism as a video
  // clip's filter. Next uploads + composes then goes on to post-details.
  // ─────────────────────────────────────────────────────────────────────────────
  if (step === 'slide-edit') {
    const currentSlide = editableSlides[Math.min(currentSlideIndex, Math.max(0, editableSlides.length - 1))];
    const isBusy = slideProcessingPhase === 'uploading' || slideProcessingPhase === 'composing';
    const isReady = slideProcessingPhase === 'ready' && !!composedSlideshow;
    const hasUnsavedSlideEdits = editableSlides.some(s => s.overlays.length > 0);

    function handleSlideTextOverlayDone(overlay: TextOverlay) {
      if (!currentSlide) return;
      setEditableSlides(prev => updateSlideOverlays(
        prev, currentSlide.id,
        prev.find(s => s.id === currentSlide.id)?.overlays.some(o => o.id === overlay.id)
          ? prev.find(s => s.id === currentSlide.id)!.overlays.map(o => o.id === overlay.id ? overlay : o)
          : [...(prev.find(s => s.id === currentSlide.id)?.overlays ?? []), overlay],
      ));
      setSlideShowTextEditor(false);
      setSlideEditingOverlayId(undefined);
      // Clear any composed result since overlays changed
      setComposedSlideshow(null);
      setSlideProcessingPhase('idle');
    }

    function handleSlideTextOverlayCancel() {
      setSlideShowTextEditor(false);
      setSlideEditingOverlayId(undefined);
    }

    function moveSlideOverlay(id: string, x: number, y: number) {
      if (!currentSlide) return;
      setEditableSlides(prev => updateSlideOverlays(
        prev, currentSlide.id,
        (prev.find(s => s.id === currentSlide.id)?.overlays ?? []).map(o => o.id === id ? { ...o, x, y } : o),
      ));
      setComposedSlideshow(null);
      setSlideProcessingPhase('idle');
    }

    function deleteSlideOverlay(id: string) {
      if (!currentSlide) return;
      setEditableSlides(prev => updateSlideOverlays(
        prev, currentSlide.id,
        (prev.find(s => s.id === currentSlide.id)?.overlays ?? []).filter(o => o.id !== id),
      ));
      setComposedSlideshow(null);
      setSlideProcessingPhase('idle');
    }

    return (
      <View style={[ts.root, { backgroundColor: BG }]}>
        <StatusBar barStyle="light-content" backgroundColor={BG} />

        {/* Rounded media card — ends above the tool row / bottom pills */}
        <View style={[ts.edCardOuter, { paddingTop: topPad + 16 }]}>
          <View style={ts.edCard}>
            {currentSlide && (
              <Image source={{ uri: currentSlide.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            )}

            {/* Tap-to-view-large layer — sits behind the overlay canvas and
                the retry button below (later siblings win hit-testing), so
                it never nests a Pressable inside another one. */}
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setSlideZoomed(true)}
              accessibilityLabel="View photo large"
              accessibilityRole="button"
            />

            {/* Overlay chips on current slide */}
            {currentSlide && !slideShowTextEditor && (
              <View style={[StyleSheet.absoluteFill, { zIndex: 5 }]}
                onLayout={(e) => {
                  const { width, height } = e.nativeEvent.layout;
                  setCanvasLayout({ width, height });
                }}
              >
                {currentSlide.overlays.map(overlay => (
                  <OverlayChip
                    key={overlay.id}
                    overlay={overlay}
                    containerWidth={canvasLayout.width}
                    containerHeight={canvasLayout.height}
                    onTap={() => { setSlideEditingOverlayId(overlay.id); setSlideShowTextEditor(true); }}
                    onMove={(x, y) => moveSlideOverlay(overlay.id, x, y)}
                    onDelete={() => deleteSlideOverlay(overlay.id)}
                  />
                ))}
              </View>
            )}

            {/* Slide count dots */}
            {editableSlides.length > 1 && (
              <View style={ts.slideDotsWrap} pointerEvents="none">
                {editableSlides.map((slide, idx) => (
                  <View key={slide.id} style={[ts.slideDot, idx === currentSlideIndex && ts.slideDotActive]} />
                ))}
              </View>
            )}

            {slideProcessingPhase === 'error' && slideProcessingError && (
              <View style={ts.errorBanner}>
                <Feather name="alert-triangle" size={14} color={ORANGE} style={{ marginRight: 8 }} />
                <Text style={ts.errorBannerText} numberOfLines={2}>{slideProcessingError}</Text>
                <TouchableOpacity onPress={processSlideshow} style={ts.errorRetryBtn}>
                  <Text style={ts.errorRetryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Dark circular X — over the card's top-left corner */}
          <TouchableOpacity
            disabled={isBusy}
            onPress={() => confirmDiscardEdits(hasUnsavedSlideEdits, () => setStep('media-pick'))}
            style={[ts.edCloseBtn, { top: topPad + 10 }]}
            accessibilityLabel="Close editor"
          >
            <Feather name="x" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Slide selector strip — pick / reorder / remove a slide */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
          <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingVertical: 8 }}>
            {editableSlides.map((slide, idx) => {
              const isActive = idx === currentSlideIndex;
              return (
                <View key={slide.id} style={{ alignItems: 'center' }}>
                  <TouchableOpacity
                    style={[ts.slideThumb, isActive && { borderColor: FG, borderWidth: 2 }]}
                    onPress={() => setCurrentSlideIndex(idx)}
                    accessibilityLabel={`Slide ${idx + 1}`}
                  >
                    <Image source={{ uri: slide.uri }} style={ts.slideThumbImg} resizeMode="cover" />
                    {slide.overlays.length > 0 && (
                      <View style={ts.slideOverlayBadge}>
                        <Text style={ts.slideOverlayBadgeText}>{slide.overlays.length}</Text>
                      </View>
                    )}
                    {slide.uploadState === 'error' && (
                      <View style={[ts.slideOverlayBadge, { backgroundColor: RED }]}>
                        <Feather name="alert-circle" size={8} color={theme.onAccent} />
                      </View>
                    )}
                  </TouchableOpacity>
                  {isActive && editableSlides.length > 1 && (
                    <View style={ts.slideReorderRow}>
                      <TouchableOpacity
                        disabled={idx === 0}
                        onPress={() => {
                          setEditableSlides(prev => moveSlide(prev, idx, idx - 1));
                          setCurrentSlideIndex(idx - 1);
                          setComposedSlideshow(null);
                        }}
                        accessibilityLabel="Move slide earlier"
                        style={[ts.slideReorderBtn, idx === 0 && { opacity: 0.3 }]}
                      >
                        <Feather name="chevron-left" size={14} color={FG} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        disabled={idx === editableSlides.length - 1}
                        onPress={() => {
                          setEditableSlides(prev => moveSlide(prev, idx, idx + 1));
                          setCurrentSlideIndex(idx + 1);
                          setComposedSlideshow(null);
                        }}
                        accessibilityLabel="Move slide later"
                        style={[ts.slideReorderBtn, idx === editableSlides.length - 1 && { opacity: 0.3 }]}
                      >
                        <Feather name="chevron-right" size={14} color={FG} />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </ScrollView>

        {/* Tool row: Text · Sticker · Overlay (share the text-overlay system) · Audio · Delete */}
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          style={ts.edToolRow}
          contentContainerStyle={ts.edToolRowContent}
        >
          <EditorToolChip
            icon="type" label="Text"
            onPress={() => { setSlideEditingOverlayId(undefined); setSlideShowTextEditor(true); }}
            testID="slide-tool-text"
          />
          <EditorToolChip
            icon="smile" label="Sticker"
            onPress={() => { setSlideEditingOverlayId(undefined); setSlideShowTextEditor(true); }}
            testID="slide-tool-sticker"
          />
          <EditorToolChip
            icon="layers" label="Overlay"
            onPress={() => { setSlideEditingOverlayId(undefined); setSlideShowTextEditor(true); }}
            testID="slide-tool-overlay"
          />
          <EditorToolChip icon="sliders" label="Effects" onPress={() => setShowSlideEffectsSheet(true)} testID="slide-tool-effects" />
          <EditorToolChip icon="music" label="Audio" onPress={() => setShowSoundModal(true)} testID="slide-tool-audio" />
          {editableSlides.length > 1 && (
            <EditorToolChip
              icon="trash-2" label="Delete"
              onPress={() => {
                if (!currentSlide) return;
                const newSlides = removePhotoSlide(editableSlides, currentSlide.id);
                setEditableSlides(newSlides);
                setCurrentSlideIndex(idx => Math.min(idx, newSlides.length - 1));
                setComposedSlideshow(null);
                setSlideProcessingPhase('idle');
              }}
              testID="slide-tool-delete"
            />
          )}
        </ScrollView>

        {/* Bottom row: Edit photo (secondary) | Next (primary) */}
        <View style={[ts.edBottomRow, { paddingBottom: botPad + 8 }]}>
          <Button
            label="Edit photo" variant="secondary"
            onPress={() => { setSlideEditingOverlayId(undefined); setSlideShowTextEditor(true); }}
            style={{ flex: 1 }}
            disabled={isBusy}
            accessibilityLabel="Edit photo"
          />
          <Button
            label={isBusy
              ? (slideProcessingPhase === 'uploading' ? 'Uploading…' : 'Composing…')
              : (isReady ? 'Next' : 'Process')}
            icon={isReady && !isBusy ? 'arrow-right' : undefined}
            variant="primary"
            loading={isBusy}
            onPress={async () => {
              if (isReady) { haptic(() => setStep('post-details')); return; }
              haptic(() => {});
              await processSlideshow();
            }}
            style={{ flex: 1 }}
            testID="slide-editor-next-btn"
          />
        </View>

        {/* Effects bottom sheet — the current slide's own filter, applied for
            real by compose-slideshow's ffmpeg render, same as a video clip. */}
        <BottomSheet visible={showSlideEffectsSheet} onClose={() => setShowSlideEffectsSheet(false)}>
          <View style={{ paddingHorizontal: SPACING.md, paddingBottom: SPACING.md }}>
            <Text style={[ts.sheetTitle, { color: FG }]}>Filter</Text>
            <View style={ts.effectsRow}>
              {EDITOR_FILTERS.map(f => {
                const active = (currentSlide?.filter ?? 'none') === f.id;
                return (
                  <TouchableOpacity
                    key={f.id}
                    style={[ts.effectsChip, active && { borderColor: FG }]}
                    onPress={() => {
                      if (!currentSlide) return;
                      setEditableSlides(prev => updateSlideFilter(prev, currentSlide.id, f.id));
                      setComposedSlideshow(null);
                      setSlideProcessingPhase('idle');
                    }}
                    accessibilityLabel={f.label}
                  >
                    <Text style={[ts.effectsChipText, { color: active ? FG : MUTED }]}>{f.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </BottomSheet>

        {/* Text overlay editor modal */}
        <TextOverlayEditor
          visible={slideShowTextEditor}
          editingOverlay={
            slideEditingOverlayId
              ? currentSlide?.overlays.find(o => o.id === slideEditingOverlayId)
              : undefined
          }
          onDone={handleSlideTextOverlayDone}
          onCancel={handleSlideTextOverlayCancel}
        />

        {/* Zoomed slide viewer */}
        <Modal visible={slideZoomed} transparent animationType="fade" onRequestClose={() => setSlideZoomed(false)}>
          <Pressable style={ts.slideZoomBackdrop} onPress={() => setSlideZoomed(false)}>
            {currentSlide && (
              <Image source={{ uri: currentSlide.uri }} style={ts.slideZoomImage} resizeMode="contain" />
            )}
          </Pressable>
        </Modal>

        <SoundModal
          visible={showSoundModal} onClose={() => setShowSoundModal(false)}
          soundTab={soundTab} setSoundTab={setSoundTab}
          soundSearch={soundSearch} setSoundSearch={setSoundSearch}
          onUse={useSound} insets={insets}
        />
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SCREEN B: VIDEO EDIT — rounded clip card, tap-to-pause, tool row, Edit
  // video/Next (ref: 03-editor-pause, 03b-editor-tools, 03c-editor-tool-row)
  // ─────────────────────────────────────────────────────────────────────────────
  if (step === 'video-edit') {
    const busy         = processingPhase === 'uploading' || processingPhase === 'processing';
    const previewClip  = videoClips[previewClipIndexSafe];
    const previewUri   = composedVideo?.mediaUrl ?? previewClip?.uri;
    const hasUnsavedEdits = textOverlays.length > 0
      || trimStart > 0 || (trimEnd > 0 && trimEnd < totalVideoDuration)
      || videoClips.some(c => c.filter !== 'none' || c.speed !== 1);
    const progressPct = Math.max(0, Math.min(100,
      (scrubTime / Math.max(0.1, composedVideo?.duration ?? totalVideoDuration)) * 100));

    const seekFromLocation = (locationX: number) => {
      const width = Math.max(1, timelineWidthRef.current);
      const rangeStart = composedVideo ? 0 : trimStart;
      const rangeEnd   = composedVideo ? composedVideo.duration : trimEnd;
      const next = rangeStart + Math.max(0, Math.min(1, locationX / width)) * Math.max(0.1, rangeEnd - rangeStart);
      setScrubTime(next);
      if (composedVideo) { setPreviewSeekTime(next); return; }
      let elapsed = 0;
      for (let idx = 0; idx < videoClips.length; idx += 1) {
        const od = videoClips[idx].duration / videoClips[idx].speed;
        if (next <= elapsed + od || idx === videoClips.length - 1) {
          setPreviewClipIndex(idx);
          setPreviewSeekTime(Math.max(0, next - elapsed) * videoClips[idx].speed);
          break;
        }
        elapsed += od;
      }
    };

    return (
      <View style={[ts.root, { backgroundColor: BG }]}>
        <StatusBar barStyle="light-content" backgroundColor={BG} />

        {/* Rounded media card — ends above the tool row / bottom pills */}
        <View style={[ts.edCardOuter, { paddingTop: topPad + 16 }]}>
          <View style={ts.edCard}>
            {previewUri ? (
              <FullVideoPreview
                uri={previewUri}
                seekTime={previewSeekTime}
                playbackRate={composedVideo ? 1 : (previewClip?.speed ?? 1)}
                paused={videoPaused}
              />
            ) : null}

            {/* Tap-to-pause layer — sits behind the overlay canvas and the
                cover/retry buttons below (later siblings win hit-testing),
                so it never nests a Pressable inside another one. */}
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={toggleCardPlayback}
              accessibilityLabel={videoPaused ? 'Play' : 'Pause'}
              accessibilityRole="button"
            />

            {showPauseGlyph && (
              <Animated.View style={[ts.edPauseGlyph, { opacity: pauseGlyphAnim }]} pointerEvents="none">
                <Feather name={videoPaused ? 'play' : 'pause'} size={30} color="#fff" />
              </Animated.View>
            )}

            {/* Overlay canvas — text chips draggable on the video */}
            <View
              ref={videoCanvasRef}
              style={StyleSheet.absoluteFill}
              pointerEvents="box-none"
              onLayout={(e) => setCanvasLayout({
                width: e.nativeEvent.layout.width,
                height: e.nativeEvent.layout.height,
              })}
              accessibilityLabel="Text overlay canvas"
              testID="overlay-canvas"
            >
              {textOverlays.map((ov) => (
                <OverlayChip
                  key={ov.id}
                  overlay={ov}
                  containerWidth={canvasLayout.width}
                  containerHeight={canvasLayout.height}
                  onTap={() => openTextEditor(ov.id)}
                  onMove={(x, y) => moveOverlay(ov.id, x, y)}
                  onDelete={() => deleteOverlay(ov.id)}
                />
              ))}
            </View>

            {/* Processing / ready / error, positioned over the card only */}
            {busy && (
              <View style={ts.processingBanner}>
                <ActivityIndicator size="small" color={PURPLE} />
                <Text style={ts.processingBannerText}>
                  {processingPhase === 'uploading' ? 'Uploading...' : 'Processing...'}
                </Text>
              </View>
            )}
            {processingError && !busy && (
              <View style={ts.errorBanner}>
                <Feather name="alert-circle" size={15} color={ORANGE} />
                <Text style={ts.errorBannerText} numberOfLines={2}>{processingError}</Text>
              </View>
            )}
            {composedVideo && !busy && (
              <View style={ts.readyBanner}>
                <Feather name="check-circle" size={15} color={PURPLE} />
                <Text style={ts.readyBannerText}>Ready · {composedVideo.duration.toFixed(1)}s</Text>
              </View>
            )}
            {composedVideo && !busy && (
              <TouchableOpacity
                style={ts.coverFrameBtn}
                onPress={useCurrentFrameAsCover}
                disabled={settingCover}
                accessibilityLabel="Use this frame as cover"
              >
                {settingCover ? (
                  <ActivityIndicator size="small" color={FG} />
                ) : (
                  <>
                    <Feather name="image" size={13} color={FG} />
                    <Text style={ts.coverFrameBtnText}>Use this frame as cover</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>

          {/* Dark circular X — over the card's top-left corner */}
          <TouchableOpacity
            disabled={busy}
            onPress={() => confirmDiscardEdits(hasUnsavedEdits, () => setStep('media-pick'))}
            style={[ts.edCloseBtn, { top: topPad + 10 }]}
            accessibilityLabel="Close editor"
            testID="editor-close-btn"
          >
            <Feather name="x" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Tool row: Text · Sticker · Audio · Clip · Overlay · Effects · Trim */}
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          style={ts.edToolRow}
          contentContainerStyle={ts.edToolRowContent}
        >
          <EditorToolChip icon="type" label="Text" onPress={() => openTextEditor()} testID="tool-text" />
          <EditorToolChip icon="smile" label="Sticker" onPress={() => openTextEditor()} testID="tool-sticker" />
          <EditorToolChip icon="music" label="Audio" onPress={() => setShowSoundModal(true)} testID="tool-audio" />
          <EditorToolChip
            icon="film" label="Clip"
            onPress={() => router.push((`/camera-capture?maxDuration=${maxDuration}`) as never)}
            testID="tool-clip"
          />
          <EditorToolChip icon="layers" label="Overlay" onPress={() => openTextEditor()} testID="tool-overlay" />
          <EditorToolChip icon="sliders" label="Effects" onPress={() => setShowEffectsSheet(true)} testID="tool-effects" />
          <EditorToolChip icon="scissors" label="Trim" onPress={() => setShowTrimSheet(true)} testID="tool-trim" />
        </ScrollView>

        {/* Swipe-up hint + thin non-interactive progress line (taps into Trim) */}
        <TouchableOpacity
          style={ts.edHintWrap}
          activeOpacity={0.7}
          onPress={() => setShowTrimSheet(true)}
          accessibilityLabel="Edit trim"
        >
          <Feather name="chevron-up" size={14} color={MUTED} />
          <Text style={ts.edHintText}>Swipe up to edit</Text>
        </TouchableOpacity>
        <View style={ts.edProgressLine} pointerEvents="none">
          <View style={[ts.edProgressFill, { width: `${progressPct}%` as any }]} />
        </View>

        {/* Bottom row: Edit video (secondary) | Next (primary) */}
        <View style={[ts.edBottomRow, { paddingBottom: botPad + 8 }]}>
          <Button
            label="Edit video" variant="secondary"
            onPress={() => setShowTrimSheet(true)}
            style={{ flex: 1 }}
            disabled={busy}
            accessibilityLabel="Edit video"
          />
          <Button
            label={processingPhase === 'error' ? 'Retry' : composedVideo ? 'Next' : 'Process'}
            icon={composedVideo && !busy ? 'arrow-right' : undefined}
            variant="primary"
            loading={busy}
            onPress={() => { if (composedVideo) haptic(() => setStep('post-details')); else void processVideo(); }}
            style={{ flex: 1 }}
            testID="editor-next-btn"
          />
        </View>

        {/* Trim bottom sheet */}
        <BottomSheet visible={showTrimSheet} onClose={() => setShowTrimSheet(false)}>
          <View style={{ paddingHorizontal: SPACING.md, paddingBottom: SPACING.md }}>
            <Text style={[ts.sheetTitle, { color: FG }]}>Trim</Text>
            <View style={ts.timelineMeta}>
              <Text style={ts.timelineMetaText}>
                {videoClips.length} clip{videoClips.length === 1 ? '' : 's'}
              </Text>
              <Text style={ts.timelineMetaText}>
                {(composedVideo?.duration ?? (trimEnd - trimStart)).toFixed(1)}s
              </Text>
            </View>
            <Pressable
              style={ts.timeline}
              onLayout={(e) => { timelineWidthRef.current = e.nativeEvent.layout.width; }}
              onPress={(e)      => seekFromLocation(e.nativeEvent.locationX)}
              onTouchMove={(e)  => seekFromLocation(e.nativeEvent.touches[0]?.locationX ?? 0)}
            >
              {videoClips.map((clip, idx) => (
                <View
                  key={clip.id}
                  style={[
                    ts.timelineClip,
                    { flex: Math.max(0.05, (clip.duration / clip.speed) / Math.max(0.1, totalVideoDuration)),
                      backgroundColor: idx % 2 === 0 ? PURPLE : BORDER },
                  ]}
                >
                  <Text style={ts.timelineClipText}>{idx + 1}</Text>
                </View>
              ))}
              <View
                pointerEvents="none"
                style={[ts.scrubber, {
                  left: `${Math.max(0, Math.min(100, (scrubTime / Math.max(0.1, composedVideo?.duration ?? totalVideoDuration)) * 100))}%` as any,
                }]}
              />
            </Pressable>
            <View style={ts.trimRow}>
              <TouchableOpacity style={ts.trimBtn} disabled={busy} onPress={() => updateTrim(trimStart - 0.5, trimEnd)}>
                <Feather name="minus" size={12} color={FG} /><Text style={ts.trimBtnText}>Start</Text>
              </TouchableOpacity>
              <TouchableOpacity style={ts.trimBtn} disabled={busy} onPress={() => updateTrim(trimStart + 0.5, trimEnd)}>
                <Feather name="plus" size={12} color={FG} /><Text style={ts.trimBtnText}>Start</Text>
              </TouchableOpacity>
              <View style={ts.trimSpacer} />
              <TouchableOpacity style={ts.trimBtn} disabled={busy} onPress={() => updateTrim(trimStart, trimEnd - 0.5)}>
                <Feather name="minus" size={12} color={FG} /><Text style={ts.trimBtnText}>End</Text>
              </TouchableOpacity>
              <TouchableOpacity style={ts.trimBtn} disabled={busy} onPress={() => updateTrim(trimStart, trimEnd + 0.5)}>
                <Feather name="plus" size={12} color={FG} /><Text style={ts.trimBtnText}>End</Text>
              </TouchableOpacity>
            </View>
          </View>
        </BottomSheet>

        {/* Effects bottom sheet — the clip's own filter/speed fields */}
        <BottomSheet visible={showEffectsSheet} onClose={() => setShowEffectsSheet(false)}>
          <View style={{ paddingHorizontal: SPACING.md, paddingBottom: SPACING.md }}>
            <Text style={[ts.sheetTitle, { color: FG }]}>Filter</Text>
            <View style={ts.effectsRow}>
              {EDITOR_FILTERS.map(f => {
                const active = (previewClip?.filter ?? 'none') === f.id;
                return (
                  <TouchableOpacity
                    key={f.id}
                    style={[ts.effectsChip, active && { borderColor: FG }]}
                    onPress={() => setClipFilter(f.id)}
                    accessibilityLabel={f.label}
                  >
                    <Text style={[ts.effectsChipText, { color: active ? FG : MUTED }]}>{f.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={[ts.sheetTitle, { color: FG, marginTop: SPACING.md }]}>Speed</Text>
            <View style={ts.effectsRow}>
              {EDITOR_SPEEDS.map(s => {
                const active = (previewClip?.speed ?? 1) === s;
                return (
                  <TouchableOpacity
                    key={s}
                    style={[ts.effectsChip, active && { borderColor: FG }]}
                    onPress={() => setClipSpeed(s)}
                    accessibilityLabel={`${s}x speed`}
                  >
                    <Text style={[ts.effectsChipText, { color: active ? FG : MUTED }]}>{s}x</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </BottomSheet>

        <SoundModal
          visible={showSoundModal} onClose={() => setShowSoundModal(false)}
          soundTab={soundTab} setSoundTab={setSoundTab}
          soundSearch={soundSearch} setSoundSearch={setSoundSearch}
          onUse={useSound} insets={insets}
        />

        {/* Text overlay editor */}
        <TextOverlayEditor
          visible={showTextEditor}
          editingOverlay={editingOverlayId
            ? textOverlays.find(o => o.id === editingOverlayId)
            : undefined}
          onDone={handleTextOverlayDone}
          onCancel={handleTextOverlayCancel}
        />
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SCREEN C: POST DETAILS — caption+thumbnail, settings rows, dual CTA
  // ─────────────────────────────────────────────────────────────────────────────
  if (step === 'post-details') {
    const ct = inferContentType();

    // Thumbnail source
    const thumbUri = composedVideo?.thumbnailUrl
      ?? (slidePhotos.length > 0 ? slidePhotos[0].uri : null);
    const hasVideo = videoClips.length > 0;

    // Formatted display value for the schedule row
    const scheduleDisplayValue = scheduledAt
      ? (() => {
          const d = new Date(scheduledAt);
          if (isNaN(d.getTime())) return 'Pick date & time';
          return d.toLocaleString(undefined, {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: 'numeric', minute: '2-digit',
          });
        })()
      : 'Pick date & time';

    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[ts.root, { backgroundColor: BG_SOFT }]}>
          <StatusBar barStyle="light-content" backgroundColor={BG_SOFT} />

          {/* Header */}
          <View style={[ts.detailsHeader, { paddingTop: topPad + 4 }]}>
            <TouchableOpacity
              onPress={() => haptic(() => setStep(videoClips.length > 0 ? 'video-edit' : 'media-pick'))}
              style={ts.headerIconBtn}
            >
              <Feather name="arrow-left" size={24} color={FG} />
            </TouchableOpacity>
            <Text style={ts.headerTitle}>{editId ? 'Edit Post' : 'Post'}</Text>
            <View style={{ width: 44 }} />
          </View>

          <ScrollView
            contentContainerStyle={{ paddingBottom: 120 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Caption + thumbnail row — tapping opens the full-screen caption
                editor (Instagram's caption screen), rather than editing
                inline here; the TextInput below is display-only. */}
            <View style={ts.captionRow}>
              <Pressable
                style={{ flex: 1 }}
                onPress={() => haptic(() => setShowCaptionScreen(true))}
                accessibilityLabel="Edit caption"
                accessibilityRole="button"
                testID="post-details-caption-row"
              >
                <TextInput
                  style={ts.captionInput}
                  value={caption}
                  editable={false}
                  pointerEvents="none"
                  multiline
                  maxLength={2200}
                  placeholder="Write a caption..."
                  placeholderTextColor={MUTED}
                  textAlignVertical="top"
                />
              </Pressable>
              {/* Thumbnail */}
              <View style={ts.thumbContainer}>
                {hasVideo && videoClips[0]?.uri ? (
                  <ThumbVideoPreview uri={videoClips[0].uri} />
                ) : thumbUri ? (
                  <Image source={{ uri: thumbUri }} style={ts.thumbImg} resizeMode="cover" />
                ) : (
                  <View style={ts.thumbPlaceholder}>
                    <Feather name="image" size={20} color={MUTED} />
                  </View>
                )}
                <TouchableOpacity
                  style={ts.thumbEditOverlay}
                  onPress={() => haptic(() => setStep(videoClips.length > 0 ? 'video-edit' : 'media-pick'))}
                  activeOpacity={0.8}
                >
                  <Text style={ts.thumbEditText}>Edit cover</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Char count */}
            <Text style={[ts.muted, { fontSize: 11, textAlign: 'right', paddingHorizontal: 16, marginTop: 4 }]}>
              {caption.length} / 2200
            </Text>

            {/* Hashtag + mention pills */}
            <View style={ts.pillRow}>
              <TouchableOpacity
                style={ts.pill}
                onPress={() => {
                  if (hashtagInput.trim().length > 1) addHashtag(hashtagInput);
                  else setHashtagInput('#');
                }}
              >
                <Feather name="hash" size={14} color={FG} style={{ marginRight: 6 }} />
                <Text style={ts.pillText}>Hashtags</Text>
              </TouchableOpacity>
              {/* Tag people — both buyer and seller posts can carry these
                  (only product tagging below is seller-only). */}
              <TouchableOpacity style={ts.pill} onPress={() => setShowTagPeopleSheet(true)} testID="post-details-tag-people-pill">
                <Feather name="user" size={14} color={FG} style={{ marginRight: 6 }} />
                <Text style={ts.pillText}>
                  {taggedPeople.length > 0 ? `${taggedPeople.length} tagged` : 'Tag people'}
                </Text>
              </TouchableOpacity>
              {!isBuyer && (
                <TouchableOpacity style={ts.pill} onPress={() => setShowProductModal(true)}>
                  <Feather name="tag" size={14} color={FG} style={{ marginRight: 6 }} />
                  <Text style={ts.pillText}>Tag products</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Hashtag input (visible) */}
            {(hashtagInput.length > 0 || hashtags.length > 0) && (
              <View style={ts.hashtagSection}>
                <TextInput
                  style={ts.hashtagInput}
                  value={hashtagInput}
                  onChangeText={setHashtagInput}
                  placeholder="#add tag..."
                  placeholderTextColor={MUTED}
                  returnKeyType="done"
                  onSubmitEditing={() => { if (hashtagInput.trim().length > 1) addHashtag(hashtagInput); }}
                  blurOnSubmit={false}
                  autoCapitalize="none"
                />
                {hashtags.length > 0 && (
                  <View style={ts.tagWrap}>
                    {hashtags.map((h) => (
                      <TouchableOpacity
                        key={h.tag}
                        style={ts.tagChip}
                        onPress={() => setHashtags(prev => prev.filter(hh => hh.tag !== h.tag))}
                      >
                        <Text style={ts.tagChipText}>{h.tag}</Text>
                        <Feather name="x" size={10} color={PURPLE} style={{ marginLeft: 4 }} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* Tagged people — monochrome chip, unlike the product-tag chip
                below (which predates this feature and isn't in scope here). */}
            {taggedPeople.length > 0 && (
              <View style={[ts.hashtagSection, { paddingTop: 0 }]}>
                <View style={ts.tagWrap}>
                  {taggedPeople.map((pt) => (
                    <View key={pt.userId} style={[ts.tagChip, { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: BORDER }]}>
                      <Text style={[ts.tagChipText, { color: FG }]}>@{pt.displayName}</Text>
                      <TouchableOpacity onPress={() => setTaggedPeople(prev => prev.filter(t => t.userId !== pt.userId))}>
                        <Feather name="x" size={10} color={MUTED} style={{ marginLeft: 4 }} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Product tags */}
            {!isBuyer && productTags.length > 0 && (
              <View style={[ts.hashtagSection, { paddingTop: 0 }]}>
                <View style={ts.tagWrap}>
                  {productTags.map((pt) => (
                    <View key={pt.productId} style={[ts.tagChip, { backgroundColor: PURPLE + '18', borderColor: PURPLE + '40' }]}>
                      <Text style={[ts.tagChipText, { color: FG }]}>{pt.productName}</Text>
                      <TouchableOpacity onPress={() => setProductTags(prev => prev.filter(t => t.productId !== pt.productId))}>
                        <Feather name="x" size={10} color={MUTED} style={{ marginLeft: 4 }} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Divider */}
            <View style={ts.settingsSeparator} />

            {/* Location */}
            <View style={ts.settingsRow}>
              <Feather name="map-pin" size={16} color={MUTED} style={{ marginRight: 10 }} />
              <TextInput
                style={ts.locationInput}
                value={location}
                onChangeText={setLocation}
                placeholder="Add location"
                placeholderTextColor={MUTED}
              />
            </View>

            <View style={ts.settingsSeparator} />

            {/* Visibility */}
            <SettingsRow
              label="Who can view this post"
              value={visibility.isPublic ? 'Everyone' : 'Followers'}
              onPress={() => setVisibility(prev => ({ ...prev, isPublic: !prev.isPublic }))}
            />

            <View style={ts.settingsSeparator} />

            {/* More settings */}
            <View style={ts.sectionBlock}>
              <Text style={ts.sectionLabel}>Settings</Text>
              {([
                { label: 'Allow comments', key: 'allowComments' as const },
                { label: 'Allow reposts',  key: 'allowReposts'  as const },
                { label: 'Show like count', key: 'showLikeCount' as const },
              ]).map(({ label, key }) => (
                <View key={key} style={ts.toggleRow}>
                  <Text style={ts.toggleLabel}>{label}</Text>
                  <HapticSwitch
                    value={visibility[key] as boolean}
                    onValueChange={(v) => setVisibility(prev => ({ ...prev, [key]: v }))}
                    thumbColor={(visibility[key] as boolean) ? PURPLE : theme.muted}
                    trackColor={{ false: BORDER, true: PURPLE + '44' }}
                  />
                </View>
              ))}
            </View>

            <View style={ts.settingsSeparator} />

            {/* Schedule */}
            <View style={ts.sectionBlock}>
              <Text style={ts.sectionLabel}>Schedule</Text>
              <View style={ts.scheduleRow}>
                {(['now', 'schedule'] as const).map((mode) => (
                  <TouchableOpacity
                    key={mode}
                    style={[ts.schedulePill, scheduleMode === mode && { backgroundColor: PURPLE + '22', borderColor: PURPLE + '55' }]}
                    onPress={() => {
                      setScheduleMode(mode);
                      if (mode === 'schedule' && !scheduledAt) {
                        // open picker immediately with a sensible default
                        setPickerState(makeDefaultPickerState());
                        setShowDatePicker(true);
                      }
                    }}
                    testID={`schedule-mode-${mode}`}
                  >
                    {scheduleMode === mode && <Feather name="check" size={11} color={PURPLE} style={{ marginRight: 4 }} />}
                    <Text style={[ts.schedulePillText, scheduleMode === mode && { color: PURPLE }]}>
                      {mode === 'now' ? 'Publish now' : 'Schedule'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Scheduled time display row — tap to re-open picker */}
              {scheduleMode === 'schedule' && (
                <TouchableOpacity
                  style={ts.scheduleDisplayRow}
                  onPress={() => setShowDatePicker(true)}
                  activeOpacity={0.75}
                  accessibilityLabel="Open date and time picker"
                  testID="open-date-picker"
                >
                  <Feather name="calendar" size={14} color={PURPLE} style={{ marginRight: 8 }} />
                  <Text style={[ts.scheduleDisplayText, { color: scheduledAt ? FG : MUTED }]}>
                    {scheduleDisplayValue}
                  </Text>
                  <Feather name="chevron-right" size={14} color={MUTED} style={{ marginLeft: 'auto' }} />
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>

          {/* Dual CTA bottom bar — Drafts | Post */}
          <View style={[ts.dualCTA, { paddingBottom: botPad + 8 }]}>
            <TouchableOpacity
              style={[ts.draftBtn, isSavingDraft && { opacity: 0.55 }]}
              activeOpacity={0.8}
              disabled={isSavingDraft}
              testID="save-draft-btn"
              onPress={async () => {
                if (isSavingDraft) return;
                haptic(() => {});
                setIsSavingDraft(true);
                try {
                  const saved = await persistSellerPost(true);
                  // Verify it came back as a draft
                  const confirmedDraft = saved.isDraft === true || saved.postStatus === 'draft';
                  if (!confirmedDraft) {
                    Alert.alert(
                      'Draft not confirmed',
                      'The post was saved but its status could not be verified. Check your Content library.',
                      [{ text: 'Go to Content', onPress: () => router.replace('/content?tab=draft' as never) }],
                    );
                    return;
                  }
                  // Route to Content library with Draft tab active
                  router.replace('/content?tab=draft' as never);
                } catch (error) {
                  Alert.alert(
                    'Draft not saved',
                    "Couldn't save your draft. Check your connection and try again.",
                  );
                } finally {
                  setIsSavingDraft(false);
                }
              }}
            >
              {isSavingDraft
                ? <ActivityIndicator size="small" color={FG} style={{ marginRight: 6 }} />
                : <Feather name="bookmark" size={15} color={FG} style={{ marginRight: 6 }} />
              }
              <Text style={ts.draftBtnText}>{isSavingDraft ? 'Saving…' : 'Drafts'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[ts.postBtn, isPublishing && { opacity: 0.55 }]}
              activeOpacity={0.85}
              disabled={isPublishing}
              onPress={async () => {
                haptic(() => {});
                if (isPublishing) return;
                if (scheduleMode === 'schedule') {
                  const t = scheduledAt ? new Date(scheduledAt).getTime() : Number.NaN;
                  if (!Number.isFinite(t) || t <= Date.now()) {
                    Alert.alert('Choose a future time', 'Tap the schedule row to pick a valid date and time in the future.');
                    return;
                  }
                }
                setIsPublishing(true);
                setStep('publishing');
                try {
                  if (editId) {
                    await persistSellerPost(false);
                  } else {
                    await completeSetupTaskAfter('first_post', () => persistSellerPost(false));
                  }
                  setStep('done');
                } catch (error) {
                  setStep('post-details');
                  Alert.alert('Publish failed', "Couldn't post. Your edits are safe — try again.");
                } finally {
                  setIsPublishing(false);
                }
              }}
            >
              <LinearGradient
                colors={theme.primaryGradient}
                style={ts.postBtnGrad}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              >
                {isPublishing
                  ? <ActivityIndicator size="small" color={theme.onAccent} />
                  : (
                    <>
                      <Feather name="send" size={15} color={theme.onAccent} style={{ marginRight: 6 }} />
                      <Text style={[ts.postBtnText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>
                        {scheduleMode === 'schedule' ? 'Schedule' : editId ? 'Save' : 'Post'}
                      </Text>
                    </>
                  )
                }
              </LinearGradient>
            </TouchableOpacity>
          </View>

          <ProductModal
            visible={showProductModal} onClose={() => setShowProductModal(false)}
            productSearch={productSearch} setProductSearch={setProductSearch}
            productTags={productTags} onTag={tagProduct}
            taggableProducts={taggableProducts}
            insets={insets}
          />
          <CaptionScreen
            visible={showCaptionScreen}
            onClose={() => setShowCaptionScreen(false)}
            caption={caption} setCaption={setCaption}
            hashtagInput={hashtagInput} setHashtagInput={setHashtagInput}
            hashtags={hashtags} addHashtag={addHashtag}
            removeHashtag={(tag) => setHashtags(prev => prev.filter(h => h.tag !== tag))}
            isBuyer={isBuyer}
            taggedPeopleCount={taggedPeople.length}
            productTagsCount={productTags.length}
            onOpenTagPeople={() => setShowTagPeopleSheet(true)}
            onOpenTagProducts={() => setShowProductModal(true)}
            insets={insets}
          />
          <TagPeopleSheet
            visible={showTagPeopleSheet}
            onClose={() => setShowTagPeopleSheet(false)}
            taggedPeople={taggedPeople}
            onAdd={(person) => setTaggedPeople(prev => [...prev, person])}
            onRemove={(userId) => setTaggedPeople(prev => prev.filter(p => p.userId !== userId))}
            mediaUri={thumbUri}
            insets={insets}
          />
          <SoundModal
            visible={showSoundModal} onClose={() => setShowSoundModal(false)}
            soundTab={soundTab} setSoundTab={setSoundTab}
            soundSearch={soundSearch} setSoundSearch={setSoundSearch}
            onUse={useSound} insets={insets}
          />
          {/* Date/time picker modal */}
          <DatePickerModal
            visible={showDatePicker}
            initial={pickerState}
            onConfirm={(ps) => {
              setPickerState(ps);
              const iso = isoFromPickerState(ps);
              setScheduledAt(iso);
              setShowDatePicker(false);
            }}
            onClose={() => setShowDatePicker(false)}
            insets={insets}
          />
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Publishing screen
  // ─────────────────────────────────────────────────────────────────────────────
  if (step === 'publishing') {
    return (
      <View style={[ts.root, ts.center, { backgroundColor: BG }]}>
        <StatusBar barStyle="light-content" backgroundColor={BG} />
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <LinearGradient
            colors={theme.primaryGradient}
            style={ts.publishingCircle}
          >
            <Feather name="upload-cloud" size={36} color={theme.onAccent} />
          </LinearGradient>
        </Animated.View>
        <Text style={[ts.doneTitle, { marginTop: 28 }]}>Publishing...</Text>
        <Text style={ts.doneSub}>Preparing your content</Text>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Done screen
  // ─────────────────────────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <View style={[ts.root, ts.center, { backgroundColor: BG, paddingBottom: botPad }]}>
        <StatusBar barStyle="light-content" backgroundColor={BG} />
        <LinearGradient colors={theme.primaryGradient} style={ts.publishingCircle}>
          <Feather name="check" size={40} color={theme.onAccent} />
        </LinearGradient>
        <Text style={ts.doneTitle}>
          {editId ? 'Post updated' : scheduleMode === 'schedule' ? 'Scheduled' : 'Posted'}
        </Text>
        <Text style={ts.doneSub}>
          {scheduleMode === 'schedule'
            ? 'Your post will go live at the scheduled time.'
            : 'Your post is live on your profile.'}
        </Text>
        <TouchableOpacity
          style={[ts.nextBtn, { marginTop: 32, alignSelf: 'stretch', marginHorizontal: 32 }]}
          activeOpacity={0.85}
          onPress={() => haptic(() => router.replace((isSellerSetup ? SELLER_HOME_ROUTE : '/(tabs)/profile') as never))}
        >
          <LinearGradient colors={theme.primaryGradient} style={ts.nextBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
            <Text style={[ts.nextBtnText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>View Profile</Text>
          </LinearGradient>
        </TouchableOpacity>
        <TouchableOpacity
          style={[ts.draftBtn, { marginTop: 14, alignSelf: 'center', paddingHorizontal: 32 }]}
          activeOpacity={0.8}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); resetAll(); }}
        >
          <Text style={ts.draftBtnText}>Create Another</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return null;
}

// ─── Sound Modal ──────────────────────────────────────────────────────────────
// ─── Photo crop box — pinch-to-zoom-and-pan crop window (SCREEN A2) ───────────
interface PhotoCropBoxProps {
  uri: string;
  aspect: CropAspect;
  transform: CropTransform;
  onChange: (next: CropTransform) => void;
}
function PhotoCropBox({ uri, aspect, transform, onChange }: PhotoCropBoxProps) {
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null);
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const gestureStartRef = useRef<{ scale: number; tx: number; ty: number } | null>(null);
  const pinchDistanceRef = useRef<number | null>(null);
  const panStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let active = true;
    Image.getSize(uri, (width, height) => { if (active) setSourceSize({ width, height }); }, () => {});
    return () => { active = false; };
  }, [uri]);

  const sourceW = sourceSize?.width ?? 1;
  const sourceH = sourceSize?.height ?? 1;
  const ratio = aspect === 'square' ? 1 : aspect === '4:5' ? 4 / 5 : (sourceW / Math.max(1, sourceH));
  // The crop box itself: the largest box of `ratio` that fits the measured container.
  let boxW = containerSize.width;
  let boxH = boxW / ratio;
  if (boxH > containerSize.height && containerSize.height > 0) {
    boxH = containerSize.height;
    boxW = boxH * ratio;
  }
  const baseScale = sourceSize && boxW > 0 ? Math.max(boxW / sourceW, boxH / sourceH) : 1;
  const displayScale = baseScale * transform.scale;
  const imageW = sourceW * displayScale;
  const imageH = sourceH * displayScale;
  const translateX = -transform.tx * displayScale;
  const translateY = -transform.ty * displayScale;

  // PanResponder is created once (useRef) but its handlers read gesture math
  // from these refs rather than render-time closures, since baseScale/aspect
  // change after the responder is created (source image loads async, aspect
  // toggle changes after mount).
  const baseScaleRef = useRef(baseScale);
  baseScaleRef.current = baseScale;
  const sourceSizeRef = useRef(sourceSize);
  sourceSizeRef.current = sourceSize;
  const aspectRef = useRef(aspect);
  aspectRef.current = aspect;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        gestureStartRef.current = { ...transformRef.current };
        const touches = event.nativeEvent.touches;
        if (touches.length >= 2) {
          const [a, b] = touches;
          pinchDistanceRef.current = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
          panStartRef.current = null;
        } else if (touches.length === 1) {
          panStartRef.current = { x: touches[0].pageX, y: touches[0].pageY };
          pinchDistanceRef.current = null;
        }
      },
      onPanResponderMove: (event) => {
        const touches = event.nativeEvent.touches;
        const start = gestureStartRef.current;
        const size = sourceSizeRef.current;
        if (!start || !size) return;
        if (touches.length >= 2) {
          const [a, b] = touches;
          const distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
          if (pinchDistanceRef.current == null) { pinchDistanceRef.current = distance; return; }
          const nextScale = start.scale + (distance - pinchDistanceRef.current) / 200;
          onChange(clampCropTransform({ ...start, scale: nextScale }, size.width, size.height, aspectRef.current));
        } else if (touches.length === 1 && panStartRef.current) {
          const dx = touches[0].pageX - panStartRef.current.x;
          const dy = touches[0].pageY - panStartRef.current.y;
          const s = baseScaleRef.current * start.scale;
          const screenToSource = s > 0 ? 1 / s : 1;
          onChange(clampCropTransform({
            ...start, tx: start.tx - dx * screenToSource, ty: start.ty - dy * screenToSource,
          }, size.width, size.height, aspectRef.current));
        }
      },
      onPanResponderRelease: () => { gestureStartRef.current = null; pinchDistanceRef.current = null; panStartRef.current = null; },
      onPanResponderTerminate: () => { gestureStartRef.current = null; pinchDistanceRef.current = null; panStartRef.current = null; },
    }),
  ).current;

  return (
    <View
      style={ts.cropBoxWrap}
      onLayout={(e) => setContainerSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      {...panResponder.panHandlers}
    >
      {containerSize.width > 0 && (
        <View style={{ width: boxW, height: boxH, overflow: 'hidden' }}>
          {sourceSize && (
            <Image
              source={{ uri }}
              style={{
                width: imageW, height: imageH,
                marginLeft: (boxW - imageW) / 2 + translateX,
                marginTop: (boxH - imageH) / 2 + translateY,
              }}
              resizeMode="cover"
            />
          )}
        </View>
      )}
    </View>
  );
}

// ─── Caption — full-screen entry (SCREEN 5, ref: 05-caption) ──────────────────
interface CaptionScreenProps {
  visible: boolean; onClose: () => void;
  caption: string; setCaption: (c: string) => void;
  hashtagInput: string; setHashtagInput: (s: string) => void;
  hashtags: PostHashtag[]; addHashtag: (raw: string) => void;
  removeHashtag: (tag: string) => void;
  isBuyer: boolean;
  taggedPeopleCount: number;
  productTagsCount: number;
  onOpenTagPeople: () => void;
  onOpenTagProducts: () => void;
  insets: { top: number; bottom: number };
}
function CaptionScreen({
  visible, onClose, caption, setCaption, hashtagInput, setHashtagInput,
  hashtags, addHashtag, removeHashtag, isBuyer, taggedPeopleCount, productTagsCount,
  onOpenTagPeople, onOpenTagProducts, insets,
}: CaptionScreenProps) {
  const { theme } = useAppTheme();
  const FG = theme.text;
  const MUTED = theme.muted;
  const BORDER = theme.border;
  const BG = theme.background;
  const topPad = Platform.OS === 'web' ? Math.max(insets.top, 54) : insets.top;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: BG }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <StatusBar barStyle="light-content" backgroundColor={BG} />
        <View style={[cps.header, { paddingTop: topPad + 4, borderBottomColor: BORDER }]}>
          <TouchableOpacity onPress={onClose} style={cps.headerBtn} accessibilityLabel="Back" accessibilityRole="button">
            <Feather name="arrow-left" size={22} color={FG} />
          </TouchableOpacity>
          <Text style={[cps.headerTitle, { color: FG }]}>Caption</Text>
          <TouchableOpacity onPress={onClose} style={cps.headerBtn} accessibilityLabel="Done" accessibilityRole="button" testID="caption-done-btn">
            {/* Success/confirm checkmark — always white, never a colored accent. */}
            <Feather name="check" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16 }}>
          <TextInput
            style={[cps.input, { color: FG }]}
            value={caption}
            onChangeText={setCaption}
            placeholder="Write a caption..."
            placeholderTextColor={MUTED}
            multiline
            maxLength={2200}
            autoFocus={visible}
            textAlignVertical="top"
          />
          {hashtags.length > 0 && (
            <View style={cps.tagWrap}>
              {hashtags.map((h) => (
                <TouchableOpacity key={h.tag} style={[cps.tagChip, { borderColor: BORDER }]} onPress={() => removeHashtag(h.tag)}>
                  <Text style={[cps.tagChipText, { color: FG }]}>{h.tag}</Text>
                  <Feather name="x" size={10} color={MUTED} style={{ marginLeft: 4 }} />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>

        {/* Chip row above the keyboard: Tag people / Tag products (seller
            only) / Add hashtag. */}
        <View style={[cps.chipRow, { borderTopColor: BORDER, paddingBottom: Math.max(insets.bottom, 10) }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 12 }}>
            <TouchableOpacity style={[cps.chip, { borderColor: BORDER }]} onPress={onOpenTagPeople} testID="caption-chip-tag-people">
              <Feather name="user" size={13} color={FG} style={{ marginRight: 6 }} />
              <Text style={[cps.chipText, { color: FG }]}>
                {taggedPeopleCount > 0 ? `${taggedPeopleCount} tagged` : 'Tag people'}
              </Text>
            </TouchableOpacity>
            {!isBuyer && (
              <TouchableOpacity style={[cps.chip, { borderColor: BORDER }]} onPress={onOpenTagProducts} testID="caption-chip-tag-products">
                <Feather name="tag" size={13} color={FG} style={{ marginRight: 6 }} />
                <Text style={[cps.chipText, { color: FG }]}>
                  {productTagsCount > 0 ? `${productTagsCount} products` : 'Tag products'}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[cps.chip, { borderColor: BORDER }]}
              onPress={() => { if (hashtagInput.length === 0) setHashtagInput('#'); }}
              testID="caption-chip-hashtag"
            >
              <Feather name="hash" size={13} color={FG} style={{ marginRight: 6 }} />
              <Text style={[cps.chipText, { color: FG }]}>Add hashtag</Text>
            </TouchableOpacity>
          </ScrollView>
          {hashtagInput.length > 0 && (
            <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
              <TextInput
                style={[cps.hashtagInput, { color: FG, borderColor: BORDER }]}
                value={hashtagInput}
                onChangeText={setHashtagInput}
                placeholder="#add tag..."
                placeholderTextColor={MUTED}
                returnKeyType="done"
                onSubmitEditing={() => { if (hashtagInput.trim().length > 1) addHashtag(hashtagInput); }}
                autoCapitalize="none"
              />
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Tag people — sheet reused for both the caption chip and post-details ────
const PEOPLE_SEARCH_DEBOUNCE_MS = 150;
const MAX_TAGGED_PEOPLE = 10;
interface TagPeopleSheetProps {
  visible: boolean; onClose: () => void;
  taggedPeople: PostPersonTag[];
  onAdd: (person: PostPersonTag) => void;
  onRemove: (userId: string) => void;
  mediaUri: string | null;
  insets: { top: number; bottom: number };
}
function TagPeopleSheet({ visible, onClose, taggedPeople, onAdd, onRemove, mediaUri, insets }: TagPeopleSheetProps) {
  const { theme } = useAppTheme();
  const api = useApi();
  const FG = theme.text;
  const MUTED = theme.muted;
  const BORDER = theme.border;
  const BG = theme.background;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ userId: string; name: string; avatarUrl: string | null }>>([]);
  const [searching, setSearching] = useState(false);
  const [pendingSpot, setPendingSpot] = useState<{ x: number; y: number } | null>(null);
  const [mediaBoxSize, setMediaBoxSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const rows = await api.social.search(q, 20);
        if (!cancelled) setResults(rows.map(r => ({ userId: r.userId, name: r.name, avatarUrl: r.avatarUrl })));
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, PEOPLE_SEARCH_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, api]);

  function placeTag(person: { userId: string; name: string; avatarUrl: string | null }) {
    if (taggedPeople.some(p => p.userId === person.userId)) return;
    if (taggedPeople.length >= MAX_TAGGED_PEOPLE) return;
    const spot = pendingSpot ?? { x: 0.5, y: 0.5 };
    onAdd({ userId: person.userId, displayName: person.name, avatarUrl: person.avatarUrl ?? undefined, x: spot.x, y: spot.y, slideIndex: 0 });
    setQuery('');
    setResults([]);
    setPendingSpot(null);
    void Haptics.selectionAsync();
  }

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={{ paddingHorizontal: SPACING.md, paddingBottom: Math.max(insets.bottom, SPACING.md) }}>
        <Text style={[tps.title, { color: FG }]}>Tag people</Text>

        {mediaUri && (
          <Pressable
            style={tps.mediaBox}
            onLayout={(e) => setMediaBoxSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
            onPress={(e) => {
              if (mediaBoxSize.width <= 0 || mediaBoxSize.height <= 0) return;
              const { locationX, locationY } = e.nativeEvent;
              setPendingSpot({
                x: Math.max(0, Math.min(1, locationX / mediaBoxSize.width)),
                y: Math.max(0, Math.min(1, locationY / mediaBoxSize.height)),
              });
            }}
            accessibilityLabel="Tap a spot to place the next tag"
          >
            <Image source={{ uri: mediaUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            {taggedPeople.map((p) => (
              <View key={p.userId} style={[tps.pin, { left: `${p.x * 100}%`, top: `${p.y * 100}%` }]}>
                <Glass variant="regular" tint="dark" radius={10} style={StyleSheet.absoluteFill} />
                <Text style={tps.pinText} numberOfLines={1}>@{p.displayName}</Text>
              </View>
            ))}
            {pendingSpot && (
              <View style={[tps.pinDot, { left: `${pendingSpot.x * 100}%`, top: `${pendingSpot.y * 100}%` }]} />
            )}
          </Pressable>
        )}

        <TextInput
          style={[tps.searchInput, { color: FG, borderColor: BORDER }]}
          value={query}
          onChangeText={setQuery}
          placeholder="Search people"
          placeholderTextColor={MUTED}
          autoCapitalize="none"
          testID="tag-people-search"
        />

        {searching && <ActivityIndicator color={FG} style={{ marginTop: 12 }} />}

        {!searching && results.length > 0 && (
          <View style={{ maxHeight: 220, marginTop: 8 }}>
            <ScrollView keyboardShouldPersistTaps="handled">
              {results.map((r) => {
                const already = taggedPeople.some(p => p.userId === r.userId);
                return (
                  <PressableScale
                    key={r.userId}
                    onPress={() => placeTag(r)}
                    disabled={already}
                    style={[tps.resultRow, { opacity: already ? 0.4 : 1 }]}
                    testID={`tag-people-result-${r.userId}`}
                  >
                    <Text style={[tps.resultName, { color: FG }]}>{r.name}</Text>
                    {already && <Feather name="check" size={16} color="#fff" />}
                  </PressableScale>
                );
              })}
            </ScrollView>
          </View>
        )}

        {taggedPeople.length > 0 && (
          <View style={tps.taggedList}>
            {taggedPeople.map((p) => (
              <View key={p.userId} style={[tps.taggedRow, { borderColor: BORDER }]}>
                <Text style={[tps.resultName, { color: FG }]}>@{p.displayName}</Text>
                <TouchableOpacity onPress={() => onRemove(p.userId)} accessibilityLabel={`Remove ${p.displayName}`}>
                  <Feather name="x" size={16} color={MUTED} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <Button label="Done" variant="primary" onPress={onClose} style={{ marginTop: 16 }} testID="tag-people-done-btn" />
      </View>
    </BottomSheet>
  );
}

interface SoundModalProps {
  visible: boolean; onClose: () => void;
  soundTab: 'trending'|'saved'|'recent'|'original'|'royalty_free';
  setSoundTab: (t: 'trending'|'saved'|'recent'|'original'|'royalty_free') => void;
  soundSearch: string; setSoundSearch: (s: string) => void;
  onUse: (sound: Sound) => void;
  insets: { top: number; bottom: number };
}
function SoundModal({ visible, onClose, soundTab, setSoundTab, soundSearch, setSoundSearch, onUse, insets }: SoundModalProps) {
  const colors = useColors();
  const { theme } = useAppTheme();
  const FG = theme.text;
  const MUTED = theme.muted;
  const ORANGE = theme.warning;
  const PURPLE = colors.primary;
  const tabs = [
    { id: 'trending'    as const, label: 'Trending' },
    { id: 'saved'       as const, label: 'Saved'    },
    { id: 'recent'      as const, label: 'Recent'   },
    { id: 'original'    as const, label: 'Original' },
    { id: 'royalty_free'as const, label: 'Free'     },
  ];
  const filtered: Sound[] = [];
  return (
    <Modal visible={visible} animationType="slide" presentationStyle={Platform.OS === 'android' ? 'fullScreen' : 'pageSheet'} onRequestClose={onClose}>
      <View style={[ms.root, { paddingBottom: insets.bottom + 16 }]}>
        <View style={ms.header}>
          <Text style={ms.title}>Sounds</Text>
          <TouchableOpacity onPress={onClose} style={ms.closeBtn}>
            <Feather name="x" size={20} color={FG} />
          </TouchableOpacity>
        </View>
        <View style={ms.searchWrap}>
          <Feather name="search" size={14} color={MUTED} style={{ marginRight: 8 }} />
          <TextInput style={[ms.searchInput, WEB_INPUT_RESET]} value={soundSearch} onChangeText={setSoundSearch} placeholder="Search sounds..." placeholderTextColor={MUTED} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 44 }}>
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, alignItems: 'center' }}>
            {tabs.map((t) => (
              <TouchableOpacity key={t.id} style={[ms.tabPill, soundTab === t.id && { backgroundColor: PURPLE + '22', borderColor: PURPLE + '55' }]} onPress={() => setSoundTab(t.id)}>
                <Text style={[ms.tabText, soundTab === t.id && { color: PURPLE }]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20 }}>
          {filtered.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: 48 }}>
              <Feather name="music" size={32} color={MUTED} />
              <Text style={{ color: MUTED, marginTop: 12, fontFamily: FONT.regular, textAlign: 'center', fontSize: FS.sm }}>Sound library coming soon.</Text>
            </View>
          ) : filtered.map((sound) => (
            <View key={sound.id} style={ms.soundRow}>
              <View style={ms.soundIcon}><Feather name="music" size={16} color={PURPLE} /></View>
              <View style={{ flex: 1 }}>
                <Text style={ms.soundTitle}>{sound.title}</Text>
                <Text style={ms.soundArtist}>{sound.artist}</Text>
              </View>
              <Text style={ms.soundDur}>{sound.duration}s</Text>
              <TouchableOpacity style={ms.useBtn} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onUse(sound); }}>
                <Text style={ms.useBtnText}>Use</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Product Modal ────────────────────────────────────────────────────────────
interface ProductModalProps {
  visible: boolean; onClose: () => void;
  productSearch: string; setProductSearch: (v: string) => void;
  productTags: PostProductTag[]; onTag: (p: Product) => void;
  taggableProducts: Product[];
  insets: { top: number; bottom: number };
}
function ProductModal({ visible, onClose, productSearch, setProductSearch, productTags, onTag, taggableProducts, insets }: ProductModalProps) {
  const colors = useColors();
  const { theme } = useAppTheme();
  const FG = theme.text;
  const MUTED = theme.muted;
  const ORANGE = theme.warning;
  const PURPLE = colors.primary;
  const filtered = taggableProducts.filter(p => productSearch === '' || p.name.toLowerCase().includes(productSearch.toLowerCase()));
  const statusColor = (st: string) => st === 'active' ? PURPLE : st === 'scheduled' ? ORANGE : MUTED;
  return (
    <Modal visible={visible} animationType="slide" presentationStyle={Platform.OS === 'android' ? 'fullScreen' : 'pageSheet'} onRequestClose={onClose}>
      <View style={[ms.root, { paddingBottom: insets.bottom + 16 }]}>
        <View style={ms.header}>
          <Text style={ms.title}>Tag Products</Text>
          <TouchableOpacity onPress={onClose} style={ms.closeBtn}><Feather name="x" size={20} color={FG} /></TouchableOpacity>
        </View>
        {productTags.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 44, paddingHorizontal: 16 }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              {productTags.map((pt) => {
                const prod = taggableProducts.find(p => p.id === pt.productId);
                return (
                  <View key={pt.productId} style={ms.taggedChip}>
                    <Text style={ms.taggedChipText}>{pt.productName}</Text>
                    <TouchableOpacity onPress={() => prod && onTag(prod)}>
                      <Feather name="x" size={11} color={PURPLE} style={{ marginLeft: 4 }} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        )}
        <View style={[ms.searchWrap, { marginTop: 8 }]}>
          <Feather name="search" size={14} color={MUTED} style={{ marginRight: 8 }} />
          <TextInput style={[ms.searchInput, WEB_INPUT_RESET]} value={productSearch} onChangeText={setProductSearch} placeholder="Search products..." placeholderTextColor={MUTED} />
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20 }}>
          {filtered.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: 48 }}>
              <Feather name="tag" size={32} color={MUTED} />
              <Text style={{ color: MUTED, marginTop: 12, fontFamily: FONT.regular, fontSize: FS.sm }}>
                {productSearch ? 'No products match your search' : 'No products available to tag'}
              </Text>
            </View>
          ) : filtered.map((p) => {
            const isTagged = productTags.some(t => t.productId === p.id);
            return (
              <View key={p.id} style={ms.productRow}>
                <View style={ms.productSwatch} />
                <View style={{ flex: 1 }}>
                  <Text style={ms.productName}>{p.name}</Text>
                  <Text style={ms.productPrice}>{formatCents(p.pricing.priceCents)}</Text>
                </View>
                <View style={[ms.statusBadge, { backgroundColor: statusColor(p.status) + '22' }]}>
                  <Text style={[ms.statusBadgeText, { color: statusColor(p.status) }]}>{p.status}</Text>
                </View>
                <TouchableOpacity
                  style={[ms.tagBtn, isTagged && { backgroundColor: PURPLE, borderColor: PURPLE }]}
                  onPress={() => { Haptics.selectionAsync(); onTag(p); }}
                >
                  <Text style={[ms.tagBtnText, isTagged && { color: theme.onAccent }]}>{isTagged ? 'Remove' : 'Tag'}</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
        <View style={{ paddingHorizontal: 16 }}>
          <TouchableOpacity onPress={onClose} style={[ms.doneBtn]}>
            <Text style={ms.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const createTs = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const BG = theme.background;
  const BG_SOFT = theme.surface;
  const CARD = theme.card;
  const BORDER = theme.border;
  const FG = theme.text;
  const MUTED = theme.muted;
  const ORANGE = theme.warning;
  return StyleSheet.create({
  root:   { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },

  // ── Shared: post-details header ──
  detailsHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER,
  },
  headerIconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle:   { fontSize: FS.md, fontFamily: FONT.bold, color: FG },

  // ── Next / Post buttons (reused in done screen) ──
  nextBtn:     { borderRadius: 12, overflow: 'hidden' },
  nextBtnGrad: { paddingVertical: 15, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  nextBtnText: { fontSize: FS.base, fontFamily: FONT.bold },

  // ══════════════════════════════════════════════════════════════════
  // SCREEN A — Instagram-style grid picker (pk = media-pick)
  // ══════════════════════════════════════════════════════════════════

  pkHeader: {
    position: 'relative',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingBottom: 10, minHeight: 44,
  },
  pkHeaderBtn:   { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  pkHeaderRight: { minWidth: 40, alignItems: 'flex-end' },
  pkHeaderTitle: {
    position: 'absolute', left: 0, right: 0, textAlign: 'center',
    fontSize: FS.md, fontFamily: FONT.bold, color: FG,
  },

  pkPreviewBox: {
    height: SW * 0.62, backgroundColor: '#0A0A0A',
    position: 'relative', overflow: 'hidden',
  },
  pkPreviewEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pkMultiBadge: {
    position: 'absolute', top: 10, right: 10,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  pkMultiBadgeText: { fontSize: FS.xs, fontFamily: FONT.bold, color: FG },

  pkGridArea: { flex: 1 },

  pkModePillWrap: {
    position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 30,
  },
  pkModePill: {
    flexDirection: 'row', backgroundColor: 'rgba(30,30,30,0.88)',
    borderRadius: RADII.pill, padding: 3,
  },
  pkModePillBtn: {
    paddingHorizontal: 18, paddingVertical: 8, borderRadius: RADII.pill,
  },
  pkModePillBtnActive: { backgroundColor: FG },
  pkModePillText:       { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
  pkModePillTextActive: { fontSize: FS.sm, fontFamily: FONT.bold, color: BG },

  // ── Video edit ──
  timelinePanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(0,0,0,0.70)',
  },
  timelineMeta:     { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 12, marginBottom: 6 },
  timelineMetaText: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  timeline:         { height: 48, flexDirection: 'row', borderRadius: 8, overflow: 'hidden', backgroundColor: CARD, position: 'relative', marginBottom: 10 },
  timelineClip:     { minWidth: 16, alignItems: 'center', justifyContent: 'center', borderRightWidth: 2, borderRightColor: BG },
  timelineClipText: { color: FG, fontSize: FS.xs, fontFamily: FONT.bold },
  scrubber:         { position: 'absolute', top: 0, bottom: 0, width: 3, marginLeft: -1, backgroundColor: FG },
  trimRow:          { flexDirection: 'row', gap: 6, marginBottom: 14 },
  trimBtn:          { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  trimBtnText:      { fontSize: FS.xs, fontFamily: FONT.medium, color: FG },
  trimSpacer:       { flex: 1 },

  processingBanner: { position: 'absolute', bottom: 90, left: 20, right: 20, zIndex: 15, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(20,20,20,0.90)', borderRadius: 12, padding: 12 },
  processingBannerText:{ fontSize: FS.sm, fontFamily: FONT.medium, color: FG, flex: 1 },
  errorBanner:      { position: 'absolute', bottom: 90, left: 20, right: 20, zIndex: 15, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(20,20,20,0.90)', borderRadius: 12, padding: 12 },
  errorBannerText:  { fontSize: FS.xs, fontFamily: FONT.medium, color: ORANGE, flex: 1 },
  readyBanner:      { position: 'absolute', bottom: 90, left: 20, right: 20, zIndex: 15, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(20,20,20,0.90)', borderRadius: 12, padding: 12 },
  readyBannerText:  { fontSize: FS.xs, fontFamily: FONT.medium, color: FG },
  coverFrameBtn:    { position: 'absolute', bottom: 145, alignSelf: 'center', zIndex: 15, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(20,20,20,0.90)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  coverFrameBtnText:{ fontSize: FS.xs, fontFamily: FONT.semibold, color: FG },

  videoBottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20,
    paddingHorizontal: 20, paddingTop: 8,
    backgroundColor: 'rgba(0,0,0,0.60)',
  },

  // ── Editor (video-edit / slide-edit): rounded card + tool row chrome ──
  edCardOuter: {
    flex: 1, paddingHorizontal: 16, paddingBottom: 12, position: 'relative',
  },
  edCard: {
    flex: 1, borderRadius: RADII.sheet, overflow: 'hidden',
    backgroundColor: '#000', position: 'relative',
  },
  edCloseBtn: {
    position: 'absolute', left: 26, width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },
  edPauseGlyph: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center',
  },
  edToolRow: { flexGrow: 0 },
  edToolRowContent: { flexDirection: 'row', gap: 14, paddingHorizontal: 16, paddingVertical: 10 },
  edHintWrap: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingBottom: 6,
  },
  edHintText: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  edProgressLine: {
    height: 2, marginHorizontal: 16, borderRadius: 1,
    backgroundColor: BORDER, overflow: 'hidden', marginBottom: 10,
  },
  edProgressFill: { height: 2, backgroundColor: FG },
  edBottomRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 4 },
  sheetTitle: { fontSize: FS.sm, fontFamily: FONT.bold },
  effectsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  effectsChip: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: RADII.chip,
    borderWidth: 1, borderColor: BORDER,
  },
  effectsChipText: { fontSize: FS.xs, fontFamily: FONT.semibold },

  edToolChip: { alignItems: 'center', justifyContent: 'center', gap: 4, width: 56 },
  edToolChipIconWrap: {
    width: 44, height: 44, borderRadius: RADII.pill,
    backgroundColor: 'rgba(120,120,128,0.16)', alignItems: 'center', justifyContent: 'center',
  },
  edToolChipLabel: { fontSize: 10, fontFamily: FONT.medium, color: MUTED },

  // ── Post details ──
  captionRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 16, paddingTop: 16, gap: 12,
  },
  captionInput: {
    flex: 1, minHeight: 90, color: FG,
    fontFamily: FONT.regular, fontSize: FS.sm,
    textAlignVertical: 'top',
  },
  thumbContainer: { width: 80, height: 100, borderRadius: 8, overflow: 'hidden', backgroundColor: CARD },
  thumbImg:       { width: '100%', height: '100%' },
  thumbPlaceholder:{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  thumbEditOverlay:{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', paddingVertical: 5 },
  thumbEditText:  { fontSize: FS.xs, fontFamily: FONT.medium, color: FG },

  pillRow: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BORDER,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER,
  },
  pill:     { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  pillText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: FG },

  hashtagSection: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  hashtagInput:   { color: FG, fontFamily: FONT.regular, fontSize: FS.sm, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER, marginBottom: 10 },
  tagWrap:        { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tagChip:        { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 14, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 10, paddingVertical: 5 },
  tagChipText:    { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },

  sectionBlock: { paddingHorizontal: 16, paddingVertical: 14 },
  sectionLabel: { fontSize: 11, fontFamily: FONT.semibold, color: MUTED, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 },

  settingsSeparator: { height: StyleSheet.hairlineWidth, backgroundColor: BORDER, marginHorizontal: 16 },
  settingsRow:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  settingsRowLabel:  { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: FG },
  settingsRowRight:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  settingsRowValue:  { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },

  soundRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14 },
  soundRowText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: FG },

  locationInput:{ flex: 1, color: FG, fontFamily: FONT.regular, fontSize: FS.sm },

  toggleRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER },
  toggleLabel: { fontSize: FS.sm, fontFamily: FONT.regular, color: FG },

  scheduleRow:     { flexDirection: 'row', gap: 10 },
  schedulePill:    { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 20, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 16, paddingVertical: 8 },
  schedulePillText:{ fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  scheduleDisplayRow: {
    flexDirection: 'row', alignItems: 'center', marginTop: 12,
    backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  scheduleDisplayText: { fontSize: FS.sm, fontFamily: FONT.regular, flex: 1 },

  // ── Dual CTA ──
  dualCTA: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BORDER,
    backgroundColor: BG_SOFT,
  },
  draftBtn:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: BORDER, paddingVertical: 14, backgroundColor: 'rgba(255,255,255,0.06)' },
  draftBtnText: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  postBtn:      { flex: 1, borderRadius: 12, overflow: 'hidden' },
  postBtnGrad:  { paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  postBtnText:  { fontSize: FS.base, fontFamily: FONT.bold },

  // ── Publishing / done ──
  publishingCircle: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  doneTitle:        { fontSize: FS.xl, fontFamily: FONT.bold, color: FG, marginTop: 20 },
  doneSub:          { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', marginTop: 8, paddingHorizontal: 40 },

  muted: { fontFamily: FONT.regular, color: MUTED },

  // ── Slide-edit step ──
  slideThumb:    { width: 60, height: 80, borderRadius: 6, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', position: 'relative' },
  slideThumbImg: { width: 60, height: 80 },
  slideOverlayBadge: { position: 'absolute', top: 3, right: 3, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  slideReorderRow: { flexDirection: 'row', gap: 4, marginTop: 4 },
  slideReorderBtn: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  slideOverlayBadgeText: { fontSize: FS.xs, fontFamily: FONT.bold, color: '#fff' },
  errorRetryBtn: { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  errorRetryText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: FG },

  slideDotsWrap: {
    position: 'absolute', top: 10, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', gap: 4,
  },
  slideDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(255,255,255,0.4)' },
  slideDotActive: { backgroundColor: '#fff', width: 14 },
  slideZoomBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  slideZoomImage: { width: '100%', height: '80%' },

  // ── SCREEN A2 — Photo crop step ──
  cropBoxWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: '#000' },
  cropPagerRow: {
    position: 'absolute', left: 0, right: 0, bottom: 96,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14,
  },
  cropPagerBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  cropDotsRow: { flexDirection: 'row', gap: 4 },
  cropAspectRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, paddingTop: 14 },
  cropAspectChip: { minWidth: 84, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', paddingHorizontal: 14 },
  cropAspectText: { fontSize: FS.sm, fontFamily: FONT.semibold },
  });
};

// ─── Modal styles ─────────────────────────────────────────────────────────────
const createMs = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const BG_SOFT = theme.surface;
  const CARD = theme.card;
  const BORDER = theme.border;
  const FG = theme.text;
  const MUTED = theme.muted;
  return StyleSheet.create({
  root:    { flex: 1, backgroundColor: BG_SOFT },
  header:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER },
  title:   { fontSize: FS.md, fontFamily: FONT.bold, color: FG },
  closeBtn:{ width: 36, height: 36, backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  searchWrap:{ flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 10, marginHorizontal: 16, marginTop: 12 },
  searchInput:{ flex: 1, color: FG, fontFamily: FONT.regular, fontSize: FS.sm },
  tabPill:  { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 6 },
  tabText:  { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  soundRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER, gap: 10 },
  soundIcon:{ width: 36, height: 36, backgroundColor: CARD, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  soundTitle:{ fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  soundArtist:{ fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  soundDur: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  useBtn:   { backgroundColor: CARD, borderRadius: 8, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 6 },
  useBtnText:{ fontSize: FS.xs, fontFamily: FONT.semibold, color: FG },
  taggedChip:{ flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 10, paddingVertical: 5 },
  taggedChipText:{ fontSize: FS.xs, fontFamily: FONT.semibold, color: FG },
  productRow:{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER, gap: 10 },
  productSwatch:{ width: 40, height: 40, borderRadius: 8, backgroundColor: CARD },
  productName:{ fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  productPrice:{ fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  statusBadge:{ borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusBadgeText:{ fontSize: FS.xs, fontFamily: FONT.semibold },
  tagBtn:    { backgroundColor: CARD, borderRadius: 8, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 6 },
  tagBtnText:{ fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED },
  doneBtn:   { borderRadius: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, paddingVertical: 14, alignItems: 'center' },
  doneBtnText:{ fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  });
};

// ─── Date picker modal styles ─────────────────────────────────────────────────
const createDps = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const BG_SOFT = theme.surface;
  const CARD = theme.card;
  const BORDER = theme.border;
  const FG = theme.text;
  const MUTED = theme.muted;
  return StyleSheet.create({
  overlay:   { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet:     { backgroundColor: BG_SOFT, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 12, maxHeight: '92%' },
  handle:    { width: 36, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: 'center', marginBottom: 14 },
  titleRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title:     { fontSize: FS.md, fontFamily: FONT.bold, color: FG },
  closeBtn:  { width: 34, height: 34, backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  summaryRow:{ flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 14, gap: 4 },
  summaryText:{ fontSize: FS.xs, fontFamily: FONT.semibold },
  monthNav:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  monthNavBtn:{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER },
  monthLabel:{ fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  dowRow:    { flexDirection: 'row', marginBottom: 4 },
  dowText:   { flex: 1, textAlign: 'center', fontSize: 11, fontFamily: FONT.semibold, color: MUTED, paddingVertical: 4 },
  calGrid:   { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 18 },
  calCell:   { width: `${100 / 7}%` as any, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  calDayText:{ fontSize: FS.sm, fontFamily: FONT.regular, color: FG },
  timeSection:{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BORDER, paddingTop: 16, marginBottom: 12 },
  timeSectionLabel:{ fontSize: 11, fontFamily: FONT.semibold, color: MUTED, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 14 },
  timeRow:   { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepper:   { alignItems: 'center', gap: 6, backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER, paddingVertical: 8, paddingHorizontal: 16 },
  stepBtn:   { width: 32, height: 28, alignItems: 'center', justifyContent: 'center' },
  stepValue: { fontSize: 22, fontFamily: FONT.bold, color: FG, minWidth: 32, textAlign: 'center' },
  timeSep:   { fontSize: 22, fontFamily: FONT.bold, color: FG },
  ampmWrap:  { gap: 8 },
  ampmBtn:   { backgroundColor: CARD, borderRadius: 8, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 14, paddingVertical: 9 },
  ampmText:  { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
  confirmBtn:{ marginTop: 8 },
  });
};
