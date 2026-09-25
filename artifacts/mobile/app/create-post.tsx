// ─── Create Post Screen — TikTok-style full-screen media-first flow ────────────
// Screen A: media-pick   → full-screen black, bottom upload/camera row
// Screen B: video-edit   → full-screen video preview, floating right toolbar
// Screen C: post-details → caption + thumbnail at top, settings rows, dual CTA
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Modal, Animated, Dimensions, Platform,
  ActivityIndicator, Alert, KeyboardAvoidingView, Image, Pressable,
  StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { FONT, FS } from '@/lib/theme';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { getTaggableProducts } from '@/services/productService';
import {
  createSellerPost, getSellerPosts, updateSellerPost,
  type SellerThreadPost,
} from '@/services/socialService';
import type { Product } from '@/services/productTypes';
import type {
  Sound, PostProductTag, PostHashtag, PostVisibility,
  MaxVideoDuration, ContentType,
} from '@/services/types';
import { useColors } from '@/hooks/useColors';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { useApi } from '@/lib/api';
import {
  markVideoClipUploaded, normalizeTrimBounds,
  createPhotoSlide, updateSlideUploadState, updateSlideOverlays, removePhotoSlide, moveSlide,
  slidesToComposePayload,
  type EditablePhotoSlide, type ComposedSlideshowResult,
} from '@/lib/videoEditing';
import type { TextOverlay } from '@/lib/videoEditing';
import { TextOverlayEditor, OverlayChip } from '@/components/TextOverlayEditor';
import { isSellerSetupOrigin, SELLER_HOME_ROUTE } from '@/lib/setupNavigation';
import { completeSetupTaskAfter } from '@/lib/setupCompletion';
import { SheetRise } from '@/components/motion/SheetRise';
import { HapticSwitch } from '@/components/BrandthreadUI';

// ─── Design tokens ────────────────────────────────────────────────────────────
const { width: SW } = Dimensions.get('window');
let ts: any = {};
let ms: any = {};
let dps: any = {};

// ─── Types ────────────────────────────────────────────────────────────────────
type Step = 'media-pick' | 'video-edit' | 'slide-edit' | 'post-details' | 'publishing' | 'done';

interface VideoClipLocal {
  uri: string; duration: number; id: string;
  speed: 0.5 | 1 | 2 | 3; filter: 'none' | 'warm' | 'cool' | 'mono';
  objectPath?: string;
}
interface ComposedVideoLocal {
  mediaUrl: string; mediaPath: string;
  thumbnailUrl: string; thumbnailPath: string; duration: number;
}
interface SlidePhotoLocal { uri: string; id: string; }
interface SoundSelection {
  soundId: string; soundTitle: string; artist: string; startTime: number; volume: number;
}

const DEFAULT_VISIBILITY: PostVisibility = {
  isPublic: true, allowComments: true, allowReposts: true, showLikeCount: true,
};

// ─── Full-screen video preview ─────────────────────────────────────────────────
function FullVideoPreview({ uri, seekTime, playbackRate = 1 }: {
  uri: string; seekTime?: number; playbackRate?: number;
}) {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.play(); });
  useEffect(() => {
    if (seekTime === undefined || !Number.isFinite(seekTime)) return;
    player.currentTime = Math.max(0, seekTime);
  }, [player, seekTime]);
  useEffect(() => { player.playbackRate = playbackRate; }, [playbackRate, player]);
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

// ─── Floating right toolbar button ────────────────────────────────────────────
function ToolBtn({ icon, label, onPress, accessibilityLabel, testID }: {
  icon: keyof typeof Feather.glyphMap; label?: string; onPress?: () => void;
  accessibilityLabel?: string; testID?: string;
}) {
  const { theme } = useAppTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={ts.toolBtn}
      activeOpacity={0.75}
      accessibilityLabel={accessibilityLabel ?? label ?? icon}
      accessibilityRole="button"
      testID={testID}
    >
      <Feather name={icon} size={26} color={theme.text} />
      {label ? <Text style={ts.toolBtnLabel}>{label}</Text> : null}
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
          <TouchableOpacity
            style={[dps.confirmBtn, { backgroundColor: PURPLE }]}
            onPress={handleConfirm}
            accessibilityLabel="Confirm schedule"
            testID="confirm-schedule"
          >
            <Text style={dps.confirmText}>Confirm</Text>
          </TouchableOpacity>
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
  const params   = useLocalSearchParams<{ accountType?: string; editId?: string; from?: string }>();
  const isBuyer  = params.accountType === 'buyer';
  const editId   = typeof params.editId === 'string' ? params.editId : undefined;
  const isSellerSetup = isSellerSetupOrigin(params.from);

  const topPad = Platform.OS === 'web' ? 20 : insets.top;
  const botPad = Platform.OS === 'web' ? 20 : insets.bottom;

  function leaveSetupDestination() {
    if (isSellerSetup) { router.replace(SELLER_HOME_ROUTE as never); return; }
    router.back();
  }

  // ── Step ──
  const [step, setStep] = useState<Step>('media-pick');

  // ── Media ──
  const [videoClips,    setVideoClips]   = useState<VideoClipLocal[]>([]);
  const [slidePhotos,   setSlidePhotos]  = useState<SlidePhotoLocal[]>([]);
  // ── Slide edit: editable slides with per-slide overlays ──
  const [editableSlides,    setEditableSlides]    = useState<EditablePhotoSlide[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [composedSlideshow, setComposedSlideshow] = useState<ComposedSlideshowResult | null>(null);
  const [slideProcessingPhase, setSlideProcessingPhase] = useState<'idle' | 'uploading' | 'composing' | 'error' | 'ready'>('idle');
  const [slideProcessingError, setSlideProcessingError] = useState<string | null>(null);
  // ── Slide-edit text overlay editor state ──
  const [slideShowTextEditor, setSlideShowTextEditor] = useState(false);
  const [slideEditingOverlayId, setSlideEditingOverlayId] = useState<string | undefined>(undefined);
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

  // ── Post details ──
  const [caption,            setCaption]            = useState('');
  const [hashtags,           setHashtags]           = useState<PostHashtag[]>([]);
  const [hashtagInput,       setHashtagInput]       = useState('');
  const [location,           setLocation]           = useState('');
  const [visibility,         setVisibility]         = useState<PostVisibility>(DEFAULT_VISIBILITY);
  const [scheduleMode,       setScheduleMode]       = useState<'now'|'schedule'>('now');
  const [scheduledAt,        setScheduledAt]        = useState<string | null>(null);
  const [pickerState,        setPickerState]        = useState<PickerState>(makeDefaultPickerState);
  const [showDatePicker,     setShowDatePicker]     = useState(false);
  const [productTags,        setProductTags]        = useState<PostProductTag[]>([]);
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
        | { type: 'photo'; uri: string }
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
        setSlidePhotos(prev => [...prev, { uri: result.uri, id: `cam_${Date.now()}` }]);
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

  function inferContentType(): ContentType {
    if (isBuyer) return 'story';
    if (videoClips.length > 0) return 'video';
    if (slidePhotos.length > 0) return 'slideshow';
    return 'video';
  }

  function haptic(fn: () => void) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); fn(); }

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
  // SCREEN A: MEDIA PICK — camera-composer layout (ref: screenshot 1)
  // Pure black. X top-left. Sound pill top-center. Right-edge tool column.
  // Large canvas. Duration row above shutter. Effects | Shutter | Upload bottom.
  // Camera / Story mode labels. Once media picked: full preview + Next pill.
  // ─────────────────────────────────────────────────────────────────────────────
  if (step === 'media-pick') {
    const DURATIONS: MaxVideoDuration[] = [15, 30, 60];
    const durLabel: Record<number, string> = { 15: '15s', 30: '30s', 60: '60s' };

    // ── State for selected tab label (no functional routing — just visual) ──
    const modeLabels = isBuyer
      ? ['Story']
      : ['Camera', 'Story'];

    return (
      <View style={[ts.root, { backgroundColor: BG }]}>
        <StatusBar barStyle="light-content" backgroundColor={BG} />

        {/* ── TOP BAR ─────────────────────────────────────────── */}
        <View style={[ts.mpTopBar, { paddingTop: topPad + 4 }]}>
          {/* X close */}
          <TouchableOpacity
            onPress={() => haptic(leaveSetupDestination)}
            style={ts.mpTopBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="x" size={26} color={FG} />
          </TouchableOpacity>

          {/* Right-top placeholder (keeps close button balanced) */}
          <View style={ts.mpTopBtn} />
          <View style={ts.mpTopBtn} />
        </View>

        {/* ── RIGHT-EDGE TOOL COLUMN ───────────────────────────── */}
        <View style={[ts.mpRightTools, { top: topPad + 60 }]}>
          <TouchableOpacity style={ts.mpToolBtn} activeOpacity={0.7} onPress={() => openTextEditor()}>
            <Text style={ts.mpTextTool}>Aa</Text>
          </TouchableOpacity>
        </View>

        {/* ── CANVAS ──────────────────────────────────────────── */}
        <View style={ts.mpCanvas}>
          {videoClips.length > 0 && (
            <>
              <FullVideoPreview uri={videoClips[0].uri} />
              {/* Replace chip */}
              <TouchableOpacity
                style={ts.mpReplaceChip}
                onPress={pickFromLibrary}
                activeOpacity={0.8}
              >
                <Feather name="refresh-cw" size={12} color={FG} />
                <Text style={ts.mpReplaceChipText}>Replace</Text>
              </TouchableOpacity>
            </>
          )}
          {slidePhotos.length > 0 && (
            <>
              <Image
                source={{ uri: slidePhotos[0].uri }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
              />
              {/* Thumbnail strip */}
              <View style={ts.mpPhotoStrip}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{ flexDirection: 'row', gap: 5, paddingHorizontal: 8, paddingVertical: 6 }}>
                    {slidePhotos.map((photo, idx) => (
                      <View key={photo.id} style={ts.mpPhotoThumb}>
                        <Image source={{ uri: photo.uri }} style={ts.mpPhotoThumbImg} resizeMode="cover" />
                        <TouchableOpacity
                          style={ts.mpRemoveChip}
                          onPress={() => setSlidePhotos(prev => prev.filter(p => p.id !== photo.id))}
                        >
                          <Feather name="x" size={9} color={FG} />
                        </TouchableOpacity>
                        {idx === 0 && (
                          <View style={ts.mpCoverBadge}>
                            <Text style={ts.mpCoverBadgeText}>cover</Text>
                          </View>
                        )}
                      </View>
                    ))}
                    {/* Add more */}
                    <TouchableOpacity
                      style={ts.mpAddMoreThumb}
                      onPress={pickFromLibrary}
                      activeOpacity={0.8}
                    >
                      <Feather name="plus" size={20} color={MUTED} />
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              </View>
              {/* Replace chip */}
              <TouchableOpacity
                style={ts.mpReplaceChip}
                onPress={pickFromLibrary}
                activeOpacity={0.8}
              >
                <Feather name="plus" size={12} color={FG} />
                <Text style={ts.mpReplaceChipText}>Add more</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* ── BOTTOM COMPOSER ZONE ─────────────────────────────── */}
        <View style={[ts.mpBottom, { paddingBottom: botPad + 4 }]}>

          {/* Duration selector row — always visible, above shutter */}
          <View style={ts.mpDurationRow}>
            {DURATIONS.map((d) => {
              const sel = maxDuration === d;
              return (
                <TouchableOpacity
                  key={d}
                  onPress={() => { Haptics.selectionAsync(); setMaxDuration(d); }}
                  style={ts.mpDurationBtn}
                >
                  <Text style={[ts.mpDurationText, sel && { color: FG, fontFamily: FONT.bold }]}>
                    {durLabel[d]}
                  </Text>
                  {sel && <View style={ts.mpDurationUnderline} />}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Shutter row: Effects | Shutter | Upload */}
          <View style={ts.mpShutterRow}>
            {/* Effects (left) */}
            <TouchableOpacity
              style={ts.mpEffectsBtn}
              activeOpacity={0.8}
              onPress={() => router.push((`/camera-capture?maxDuration=${maxDuration}`) as never)}
            >
              <View style={ts.mpEffectsIcon}>
                <Feather name="sliders" size={22} color={FG} />
              </View>
              <Text style={ts.mpEffectsLabel}>Effects</Text>
            </TouchableOpacity>

            {/* Shutter / Next (center) */}
            {hasMedia ? (
              /* Media selected — shutter becomes a Next pill */
              <TouchableOpacity
                style={ts.mpNextShutter}
                activeOpacity={0.88}
                onPress={() => haptic(() => {
                  if (videoClips.length > 0) {
                    setStep('video-edit');
                  } else {
                    // Enter slide-edit: build EditablePhotoSlide from slidePhotos
                    const slides = slidePhotos.map(p =>
                      createPhotoSlide(p.id, p.uri)
                    );
                    setEditableSlides(slides);
                    setCurrentSlideIndex(0);
                    setComposedSlideshow(null);
                    setSlideProcessingPhase('idle');
                    setSlideProcessingError(null);
                    setStep('slide-edit');
                  }
                })}
              >
                <LinearGradient
                  colors={theme.primaryGradient}
                  style={ts.mpNextShutterGrad}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                >
                  <Text style={[ts.mpNextShutterText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>
                    Next
                  </Text>
                  <Feather name="arrow-right" size={18} color={theme.onAccent} style={{ marginLeft: 6 }} />
                </LinearGradient>
              </TouchableOpacity>
            ) : (
              /* No media — white shutter ring */
              <TouchableOpacity
                style={ts.mpShutter}
                activeOpacity={0.85}
                onPress={() => router.push((`/camera-capture?maxDuration=${maxDuration}`) as never)}
              >
                <View style={ts.mpShutterInner} />
              </TouchableOpacity>
            )}

            {/* Upload (right) */}
            <TouchableOpacity
              style={ts.mpUploadBtn}
              activeOpacity={0.8}
              onPress={pickFromLibrary}
            >
              {slidePhotos.length > 0 ? (
                /* Show last-selected thumbnail */
                <Image
                  source={{ uri: slidePhotos[slidePhotos.length - 1].uri }}
                  style={ts.mpUploadThumb}
                  resizeMode="cover"
                />
              ) : videoClips.length > 0 ? (
                <View style={[ts.mpUploadThumb, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#1c1c1e' }]}>
                  <Feather name="video" size={18} color={FG} />
                </View>
              ) : (
                <View style={ts.mpUploadThumb}>
                  <Feather name="image" size={18} color={MUTED} />
                </View>
              )}
              <Text style={ts.mpUploadLabel}>Upload</Text>
            </TouchableOpacity>
          </View>

          {/* Mode tabs: Camera / Story */}
          <View style={ts.mpModeRow}>
            {modeLabels.map((label, i) => {
              const active = i === 0;
              return (
                <View key={label} style={ts.mpModeItem}>
                  <Text style={[ts.mpModeText, active && ts.mpModeTextActive]}>
                    {label}
                  </Text>
                  {active && <View style={ts.mpModeDot} />}
                </View>
              );
            })}
          </View>
        </View>

        {/* Sound modal (accessible from Add sound pill) */}
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
  // SCREEN B2: SLIDE EDIT — photo slideshow editor with per-slide text overlays
  // Shows the current slide full-screen, thumbnail strip at bottom,
  // Aa button to add/edit text overlays. Next uploads + composes then goes to post-details.
  // ─────────────────────────────────────────────────────────────────────────────
  if (step === 'slide-edit') {
    const currentSlide = editableSlides[Math.min(currentSlideIndex, Math.max(0, editableSlides.length - 1))];
    const isBusy = slideProcessingPhase === 'uploading' || slideProcessingPhase === 'composing';
    const isReady = slideProcessingPhase === 'ready' && !!composedSlideshow;

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

        {/* Full-screen slide preview */}
        {currentSlide && (
          <Image
            source={{ uri: currentSlide.uri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        )}

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

        {/* Top bar */}
        <View style={[ts.videoTopBar, { paddingTop: topPad + 6, zIndex: 20 }]}>
          <TouchableOpacity
            disabled={isBusy}
            onPress={() => haptic(() => setStep('media-pick'))}
            style={ts.videoTopBtn}
          >
            <Feather name="arrow-left" size={24} color={isBusy ? MUTED : FG} />
          </TouchableOpacity>

          <Text style={[ts.soundPillText, { color: FG, fontFamily: FONT.bold }]}>
            Edit Slides ({currentSlideIndex + 1}/{editableSlides.length})
          </Text>

          <View style={{ width: 44 }} />
        </View>

        {/* Right tools — Aa (text overlay) + slide delete */}
        <View style={[ts.rightToolbar, { paddingTop: topPad + 56, zIndex: 20 }]}>
          <ToolBtn
            icon="type"
            label="Aa"
            onPress={() => { setSlideEditingOverlayId(undefined); setSlideShowTextEditor(true); }}
            accessibilityLabel="Add text overlay"
          />
          {editableSlides.length > 1 && (
            <ToolBtn
              icon="trash-2"
              label="Del"
              onPress={() => {
                if (!currentSlide) return;
                const newSlides = removePhotoSlide(editableSlides, currentSlide.id);
                setEditableSlides(newSlides);
                setCurrentSlideIndex(idx => Math.min(idx, newSlides.length - 1));
                setComposedSlideshow(null);
                setSlideProcessingPhase('idle');
              }}
              accessibilityLabel="Remove slide"
            />
          )}
        </View>

        {/* Slide selector strip at bottom */}
        <View style={[ts.slideStripContainer, { bottom: botPad + 80 }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 8 }}>
              {editableSlides.map((slide, idx) => {
                const isActive = idx === currentSlideIndex;
                return (
                  <View key={slide.id} style={{ alignItems: 'center' }}>
                    <TouchableOpacity
                      style={[
                        ts.slideThumb,
                        isActive && { borderColor: ORANGE, borderWidth: 2 },
                      ]}
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
        </View>

        {/* Processing error banner */}
        {slideProcessingPhase === 'error' && slideProcessingError && (
          <View style={[ts.errorBanner, { bottom: botPad + 140 }]}>
            <Feather name="alert-triangle" size={14} color={ORANGE} style={{ marginRight: 8 }} />
            <Text style={ts.errorBannerText} numberOfLines={2}>{slideProcessingError}</Text>
            <TouchableOpacity onPress={processSlideshow} style={ts.errorRetryBtn}>
              <Text style={ts.errorRetryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Bottom Next button */}
        <View style={[ts.slideNextBar, { paddingBottom: botPad + 8 }]}>
          {isBusy ? (
            <View style={ts.slideNextBusy}>
              <ActivityIndicator color={FG} size="small" style={{ marginRight: 10 }} />
              <Text style={ts.slideNextBusyText}>
                {slideProcessingPhase === 'uploading' ? 'Uploading slides…' : 'Composing slideshow…'}
              </Text>
            </View>
          ) : (
            <TouchableOpacity
              style={ts.nextBtn}
              activeOpacity={0.85}
              onPress={async () => {
                haptic(() => {});
                if (isReady) {
                  // Already composed — go straight to post details
                  setStep('post-details');
                  return;
                }
                // Need to upload+compose first
                await processSlideshow();
                // processSlideshow sets phase to 'ready' on success; watch via effect
              }}
            >
              <LinearGradient
                colors={theme.primaryGradient}
                style={ts.nextBtnGrad}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              >
                <Text style={[ts.nextBtnText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>
                  {isReady ? 'Next →' : 'Process & Next'}
                </Text>
                <Feather name="arrow-right" size={18} color={theme.onAccent} style={{ marginLeft: 6 }} />
              </LinearGradient>
            </TouchableOpacity>
          )}
        </View>

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
  // SCREEN B: VIDEO EDIT — full-screen preview, floating right toolbar
  // ─────────────────────────────────────────────────────────────────────────────
  if (step === 'video-edit') {
    const busy         = processingPhase === 'uploading' || processingPhase === 'processing';
    const previewClip  = videoClips[Math.min(previewClipIndex, Math.max(0, videoClips.length - 1))];
    const previewUri   = composedVideo?.mediaUrl ?? previewClip?.uri;

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

        {/* Full-screen video */}
        {previewUri ? (
          <FullVideoPreview
            uri={previewUri}
            seekTime={previewSeekTime}
            playbackRate={composedVideo ? 1 : (previewClip?.speed ?? 1)}
          />
        ) : null}

        {/* Top bar */}
        <View style={[ts.videoTopBar, { paddingTop: topPad + 6 }]}>
          <TouchableOpacity
            disabled={busy}
            onPress={() => haptic(() => setStep('media-pick'))}
            style={ts.videoTopBtn}
          >
            <Feather name="arrow-left" size={24} color={busy ? MUTED : FG} />
          </TouchableOpacity>

          <View style={{ width: 44 }} />

          <View style={{ width: 44 }} />
        </View>

        {/* Right floating toolbar */}
        <View style={[ts.rightToolbar, { paddingTop: topPad + 56 }]}>
          <ToolBtn
            icon="type"
            label="Text"
            onPress={() => openTextEditor()}
            accessibilityLabel="Add text overlay"
            testID="toolbar-text-btn"
          />
        </View>

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

        {/* Timeline + trim overlay at middle-bottom */}
        <View style={[ts.timelinePanel, { paddingBottom: botPad + 100 }]}>
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
          {/* Trim controls */}
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

        {/* Processing status */}
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

        {/* Bottom CTA */}
        <View style={[ts.videoBottomBar, { paddingBottom: botPad + 8 }]}>
          <TouchableOpacity
            style={[ts.nextBtn, busy && { opacity: 0.5 }]}
            disabled={busy}
            onPress={() => {
              if (composedVideo) setStep('post-details');
              else void processVideo();
            }}
          >
            <LinearGradient
              colors={busy ? [theme.cardElevated, theme.cardElevated] : theme.primaryGradient}
              style={ts.nextBtnGrad}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            >
              {busy
                ? <ActivityIndicator size="small" color={theme.onAccent} />
                : (
                  <Text style={[ts.nextBtnText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>
                    {processingPhase === 'error' ? 'Retry' : composedVideo ? 'Next' : 'Process'}
                  </Text>
                )
              }
            </LinearGradient>
          </TouchableOpacity>
        </View>

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
            {/* Caption + thumbnail row */}
            <View style={ts.captionRow}>
              <TextInput
                style={ts.captionInput}
                value={caption}
                onChangeText={setCaption}
                multiline
                maxLength={2200}
                placeholder="Write a caption..."
                placeholderTextColor={MUTED}
                textAlignVertical="top"
              />
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
          <TextInput style={ms.searchInput} value={soundSearch} onChangeText={setSoundSearch} placeholder="Search sounds..." placeholderTextColor={MUTED} />
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
          <TextInput style={ms.searchInput} value={productSearch} onChangeText={setProductSearch} placeholder="Search products..." placeholderTextColor={MUTED} />
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
  // SCREEN A — camera composer (mp = media-pick)
  // ══════════════════════════════════════════════════════════════════

  // Top bar: X | sound pill | spacer
  mpTopBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingBottom: 10,
  },
  mpTopBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  mpSoundPill: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(40,40,40,0.88)',
    borderRadius: 22, paddingHorizontal: 14, paddingVertical: 9,
    marginHorizontal: 8, maxWidth: SW * 0.52,
    alignSelf: 'center',
  },
  mpSoundPillText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: FG, flex: 1 },

  // Right-edge tool column
  mpRightTools: {
    position: 'absolute', right: 10, zIndex: 25,
    alignItems: 'center', gap: 2,
  },
  mpToolBtn:     { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  mpTextTool:    { color: FG, fontSize: 18, fontFamily: FONT.bold },
  mpToolDivider: { width: 24, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 4 },

  // Canvas (fills between top bar and bottom zone)
  mpCanvas: { flex: 1 },

  // Media-in-canvas overlays
  mpReplaceChip: {
    position: 'absolute', top: 14, right: 12,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,0,0,0.62)', borderRadius: 18,
    paddingHorizontal: 11, paddingVertical: 6,
  },
  mpReplaceChipText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: FG },

  mpPhotoStrip: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.52)',
  },
  mpPhotoThumb:    { width: 70, height: 70, borderRadius: 6, overflow: 'hidden', position: 'relative' },
  mpPhotoThumbImg: { width: 70, height: 70 },
  mpRemoveChip:    { position: 'absolute', top: 4, right: 4, width: 16, height: 16, borderRadius: 8, backgroundColor: '#000000AA', alignItems: 'center', justifyContent: 'center' },
  mpCoverBadge:    { position: 'absolute', bottom: 4, left: 4, backgroundColor: '#000000AA', borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1 },
  mpCoverBadgeText:{ fontSize: FS.xs, fontFamily: FONT.bold, color: FG },
  mpAddMoreThumb:  { width: 70, height: 70, borderRadius: 6, borderWidth: 1, borderColor: BORDER, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },

  // Bottom composer zone
  mpBottom: {
    backgroundColor: BG,
    paddingTop: 10,
  },

  // Duration row (above shutter)
  mpDurationRow: {
    flexDirection: 'row', justifyContent: 'center',
    gap: 0, marginBottom: 14, paddingHorizontal: 16,
  },
  mpDurationBtn:      { alignItems: 'center', paddingHorizontal: 14, paddingBottom: 4 },
  mpDurationText:     { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  mpDurationUnderline:{ height: 2, width: 20, backgroundColor: FG, borderRadius: 1, marginTop: 4, alignSelf: 'center' },

  // Shutter row: Effects | Shutter/Next | Upload
  mpShutterRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28, marginBottom: 18,
  },

  // Effects button (left)
  mpEffectsBtn:   { alignItems: 'center', gap: 6, width: 70 },
  mpEffectsIcon:  { width: 52, height: 52, borderRadius: 14, backgroundColor: '#1C1C1E', alignItems: 'center', justifyContent: 'center' },
  mpEffectsLabel: { fontSize: 11, fontFamily: FONT.medium, color: FG },

  // White shutter ring (no media)
  mpShutter: {
    width: 76, height: 76, borderRadius: 38,
    borderWidth: 4, borderColor: FG,
    alignItems: 'center', justifyContent: 'center',
  },
  mpShutterInner: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: FG,
  },

  // Gradient Next pill (media selected, replaces shutter)
  mpNextShutter: {
    width: 130, height: 52, borderRadius: 26,
    overflow: 'hidden',
  },
  mpNextShutterGrad: {
    flex: 1, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center',
  },
  mpNextShutterText: { fontSize: FS.base, fontFamily: FONT.bold },

  // Upload thumbnail (right)
  mpUploadBtn:   { alignItems: 'center', gap: 6, width: 70 },
  mpUploadThumb: { width: 52, height: 52, borderRadius: 10, backgroundColor: '#1C1C1E', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  mpUploadLabel: { fontSize: 11, fontFamily: FONT.medium, color: FG },

  // Camera / Story mode tabs
  mpModeRow:       { flexDirection: 'row', justifyContent: 'center', gap: 28, paddingBottom: 6 },
  mpModeItem:      { alignItems: 'center', gap: 5 },
  mpModeText:      { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  mpModeTextActive:{ fontSize: FS.sm, fontFamily: FONT.bold, color: FG },
  mpModeDot:       { width: 4, height: 4, borderRadius: 2, backgroundColor: FG },

  // ── Video edit ──
  videoTopBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12,
  },
  videoTopBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  soundPill: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(30,30,30,0.85)', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8, maxWidth: SW * 0.55,
  },
  soundPillText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: FG, flex: 1 },

  rightToolbar: {
    position: 'absolute', right: 12, zIndex: 20,
    alignItems: 'center', gap: 6,
  },
  toolBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  toolBtnLabel:{ fontSize: FS.xs, fontFamily: FONT.regular, color: FG, marginTop: 2 },
  toolDivider: { width: 30, height: StyleSheet.hairlineWidth, backgroundColor: BORDER, marginVertical: 4 },

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
  slideStripContainer: {
    position: 'absolute', left: 0, right: 0, zIndex: 20,
    backgroundColor: 'rgba(0,0,0,0.60)',
  },
  slideThumb:    { width: 60, height: 80, borderRadius: 6, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', position: 'relative' },
  slideThumbImg: { width: 60, height: 80 },
  slideOverlayBadge: { position: 'absolute', top: 3, right: 3, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  slideReorderRow: { flexDirection: 'row', gap: 4, marginTop: 4 },
  slideReorderBtn: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  slideOverlayBadgeText: { fontSize: FS.xs, fontFamily: FONT.bold, color: '#fff' },
  slideNextBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20,
    paddingHorizontal: 20, paddingTop: 12,
    backgroundColor: 'rgba(0,0,0,0.60)',
  },
  slideNextBusy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },
  slideNextBusyText: { fontSize: FS.sm, fontFamily: FONT.medium, color: FG },
  errorRetryBtn: { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  errorRetryText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: FG },
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
  confirmBtn:{ borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  confirmText:{ fontSize: FS.base, fontFamily: FONT.bold, color: '#fff' },
  });
};
