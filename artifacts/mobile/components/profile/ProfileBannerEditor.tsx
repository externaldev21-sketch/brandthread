/**
 * Profile banner — the owner-side edit flow (TikTok 1:1), used by both Edit
 * profile screens (buyer + seller):
 *
 *   Edit profile ─ banner preview with an "Edit banner" pill on its right,
 *                  avatar overlapping the banner's bottom edge (centered),
 *                  "Edit photo or avatar" under it
 *   "Edit banner" → native action sheet: Choose GIF · Choose video ·
 *                  Remove banner (only when one is set) · Cancel
 *                  (iOS: Choose GIF → Photo Library / Files)
 *   video > 10s  → trim screen (TikTok's editor: filmstrip of the whole
 *                  clip, a 10s window slid along it, looping preview,
 *                  scrub) — any length, never a hard cut
 *   pick         → crop / position screen: the exact banner frame over the
 *                  whole picture, drag to reposition + pinch,
 *                  Cancel · Crop · Save along the bottom
 *   Save         → GIF (≤15MB): converted server-side to a looping MP4,
 *                  original kept as the fallback; video: muted, trimmed +
 *                  cropped server-side. Both loop forever.
 *
 * A trimmed (long) clip goes up through the chunked, resumable upload and
 * is rendered server-side from storage; short clips post directly.
 *
 * Storage + limits are the profile cover's (server: routes/profile-cover.ts):
 * the banner IS the cover, so one change per 24h, moderation and cleanup of
 * the replaced media all carry over.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActionSheetIOS, ActivityIndicator, Alert, Image as RNImage, Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { CachedImage } from '@/components/CachedImage';
import { useApi, type ProfileBannerCrop } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, ON_DARK, SP } from '@/lib/theme';
import { hapticLight, hapticSelection } from '@/lib/haptics';
import { emitProfileEvent } from '@/lib/profileEvents';
import { isBuyerDevPreview, isSellerDevPreview } from '@/lib/devPreview';
import { BannerTrimScreen } from './BannerTrimScreen';
import { useProfileLayout } from './profileLayout';
import { pickerDurationSeconds } from './profileCoverRules';
import { BannerBottomFade, BannerMedia, BannerPlaceholder } from './ProfileBannerHeader';
import {
  BANNER_GIF_MAX_BYTES, bannerHeight, bannerNeedsTrim, bannerSheetOptions, isGifAsset,
  type BannerSheetAction, type ProfileBanner,
} from './profileBannerRules';

type BannerSource = {
  kind: 'gif' | 'video';
  uri: string;
  mimeType: string | null;
  width: number;
  height: number;
  durationSeconds: number | null;
  /** The 10s window picked on the trim screen (videos over 10s). */
  trim?: { start: number; duration: number } | null;
};

function errorMessage(error: unknown): string {
  const message = (error as { message?: string } | null)?.message;
  return typeof message === 'string' && message.trim() ? message : "Couldn't update your banner. Try again.";
}

function notify(title: string, message?: string) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

/** Web pickers don't report a video's duration — read it from the file's metadata. */
function probeWebVideoDuration(uri: string): Promise<number | null> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const done = (value: number | null) => { video.removeAttribute('src'); resolve(value); };
    video.preload = 'metadata';
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
    video.onerror = () => done(null);
    setTimeout(() => done(null), 5000);
    video.src = uri;
  });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useProfileBanner({ banner, userId }: { banner: ProfileBanner | null; userId?: string | null }) {
  const api = useApi();
  const [current, setCurrent] = useState<ProfileBanner | null>(banner);
  const [busy, setBusy] = useState<null | 'uploading' | 'removing'>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [trimSource, setTrimSource] = useState<BannerSource | null>(null);
  const [cropSource, setCropSource] = useState<BannerSource | null>(null);

  // Server data wins when it changes (refetch after focus, etc.).
  useEffect(() => { setCurrent(banner); }, [banner?.type, banner?.url, banner?.posterUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = useCallback((next: ProfileBanner | null) => {
    setCurrent(next);
    emitProfileEvent({ type: 'banner', ownerId: userId ?? null, banner: next });
    emitProfileEvent({ type: 'content', ownerId: userId ?? null });
  }, [userId]);

  /** A picked GIF → crop screen (after the type + ~15MB checks). */
  const acceptGif = useCallback((asset: { uri: string; mimeType?: string | null; fileName?: string | null; name?: string | null; width?: number; height?: number; fileSize?: number | null; size?: number | null }) => {
    if (!isGifAsset(asset)) { notify('Choose a GIF', 'That file isn\'t a GIF. Pick a .gif, or use Choose video for a clip.'); return; }
    const bytes = asset.fileSize ?? asset.size ?? null;
    if (typeof bytes === 'number' && bytes > BANNER_GIF_MAX_BYTES) { notify('GIF too large', 'GIFs can be up to 15MB.'); return; }
    setCropSource({ kind: 'gif', uri: asset.uri, mimeType: 'image/gif', width: asset.width || 0, height: asset.height || 0, durationSeconds: null });
  }, []);

  const pickGif = useCallback(async (from: 'library' | 'files') => {
    try {
      if (from === 'files') {
        const result = await DocumentPicker.getDocumentAsync({ type: 'image/gif', copyToCacheDirectory: true, multiple: false });
        if (result.canceled || !result.assets?.[0]) return;
        acceptGif(result.assets[0]);
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
        // Keep the original file: the default "compatible" mode flattens a GIF to a still JPEG on iOS.
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
      });
      if (result.canceled || !result.assets?.[0]) return;
      acceptGif(result.assets[0]);
    } catch (error) {
      notify("Couldn't open your GIFs", errorMessage(error));
    }
  }, [acceptGif]);

  const pickVideo = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 1 });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const source: BannerSource = {
        kind: 'video',
        uri: asset.uri,
        mimeType: asset.mimeType ?? null,
        width: asset.width || 0,
        height: asset.height || 0,
        // expo-image-picker reports milliseconds on native but seconds on web.
        durationSeconds: Platform.OS === 'web'
          ? (typeof asset.duration === 'number' && asset.duration > 0 ? asset.duration : null)
          : pickerDurationSeconds(asset.duration),
      };
      if (source.durationSeconds == null) source.durationSeconds = await probeWebVideoDuration(asset.uri);
      // Over 10s: the trim screen picks the 10s window first (never a hard cut).
      if (bannerNeedsTrim(source.durationSeconds)) setTrimSource(source);
      else setCropSource(source);
    } catch (error) {
      notify("Couldn't open your videos", errorMessage(error));
    }
  }, []);

  const remove = useCallback(async () => {
    // Signed-out dev web preview: never calls the API; the change stays on this device session.
    if (isBuyerDevPreview() || isSellerDevPreview()) { apply(null); return; }
    setBusy('removing');
    try {
      await api.profileCover.remove();
      apply(null);
    } catch (error) {
      notify('Banner not removed', errorMessage(error));
    } finally {
      setBusy(null);
    }
  }, [api, apply]);

  const choose = useCallback((action: BannerSheetAction) => {
    setSheetOpen(false);
    if (action === 'remove') { void remove(); return; }
    if (action === 'video') { void pickVideo(); return; }
    // iOS: GIFs live in Photos or in Files — the system's own follow-up sheet.
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Photo Library', 'Files', 'Cancel'], cancelButtonIndex: 2 },
        (index) => { if (index === 0) void pickGif('library'); else if (index === 1) void pickGif('files'); },
      );
      return;
    }
    void pickGif('library');
  }, [pickGif, pickVideo, remove]);

  /** "Edit banner": iOS gets the system action sheet; Android + web the same sheet drawn in-app. */
  const openSheet = useCallback(() => {
    hapticLight();
    const options = bannerSheetOptions(!!current);
    if (Platform.OS === 'ios') {
      const destructiveButtonIndex = options.findIndex((option) => option.destructive);
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...options.map((option) => option.label), 'Cancel'],
          cancelButtonIndex: options.length,
          destructiveButtonIndex: destructiveButtonIndex >= 0 ? destructiveButtonIndex : undefined,
        },
        (index) => { if (index < options.length) choose(options[index].key); },
      );
      return;
    }
    setSheetOpen(true);
  }, [choose, current]);

  const saveCrop = useCallback(async (rect: ProfileBannerCrop) => {
    const source = cropSource;
    setCropSource(null);
    if (!source) return;
    if (isBuyerDevPreview() || isSellerDevPreview()) {
      apply(source.kind === 'gif'
        ? { type: 'gif', url: source.uri, posterUrl: null, gifUrl: source.uri }
        : { type: 'video', url: source.uri, posterUrl: null });
      return;
    }
    setBusy('uploading');
    try {
      if (source.kind === 'gif') {
        const saved = await api.profileCover.uploadGif(source.uri, rect);
        apply(saved.profileBanner);
      } else {
        // A window of a longer clip: send the whole source through the
        // chunked upload (any length / size) and render it server-side.
        const saved = source.trim
          ? await api.profileCover.uploadLong(source.uri, source.mimeType, source.trim, rect)
          : await api.profileCover.upload(source.uri, source.mimeType, null, rect);
        apply(saved.profileBanner ?? { type: 'video', url: saved.coverVideoUrl, posterUrl: saved.coverPosterUrl });
      }
    } catch (error) {
      notify('Banner not updated', errorMessage(error));
    } finally {
      setBusy(null);
    }
  }, [api, apply, cropSource]);

  return {
    banner: current,
    busy,
    openSheet,
    sheet: (
      <>
        <BannerActionSheet visible={sheetOpen} hasBanner={!!current} onChoose={choose} onClose={() => setSheetOpen(false)} />
        <BannerTrimScreen
          source={trimSource}
          onCancel={() => setTrimSource(null)}
          onConfirm={(trim) => {
            const source = trimSource;
            setTrimSource(null);
            if (source) setCropSource({ ...source, trim });
          }}
        />
        <BannerCropScreen source={cropSource} onCancel={() => setCropSource(null)} onSave={(rect) => { void saveCrop(rect); }} />
      </>
    ),
  };
}

// ─── Action sheet (Android + web; iOS uses ActionSheetIOS) ───────────────────

export function BannerActionSheet({
  visible, hasBanner, onChoose, onClose,
}: {
  visible: boolean;
  hasBanner: boolean;
  onChoose: (action: BannerSheetAction) => void;
  onClose: () => void;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  if (!visible) return null;
  const options = bannerSheetOptions(hasBanner);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheetHost, { paddingBottom: Math.max(insets.bottom, SP.sm) }]} pointerEvents="box-none" testID="banner-action-sheet">
        <View style={[styles.sheetGroup, { backgroundColor: theme.cardElevated }]}>
          {options.map((option, index) => (
            <Pressable
              key={option.key}
              onPress={() => { hapticSelection(); onChoose(option.key); }}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.sheetRow,
                index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                pressed && { backgroundColor: theme.card },
              ]}
              testID={`banner-sheet-${option.key}`}
            >
              <Text style={[styles.sheetText, { color: theme.text }]}>{option.label}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          style={({ pressed }) => [styles.sheetGroup, styles.sheetRow, { backgroundColor: theme.cardElevated }, pressed && { backgroundColor: theme.card }]}
          testID="banner-sheet-cancel"
        >
          <Text style={[styles.sheetText, styles.sheetCancel, { color: theme.text }]}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

// ─── Crop / position screen ──────────────────────────────────────────────────

/** Normalized crop rect for a centered, scaled + translated source inside the frame. */
export function bannerCropRect({
  sourceWidth, sourceHeight, frameWidth, frameHeight, scale, translateX, translateY,
}: {
  sourceWidth: number; sourceHeight: number; frameWidth: number; frameHeight: number;
  scale: number; translateX: number; translateY: number;
}): ProfileBannerCrop {
  const base = Math.max(frameWidth / sourceWidth, frameHeight / sourceHeight) * scale;
  const boxW = Math.min(sourceWidth, frameWidth / base);
  const boxH = Math.min(sourceHeight, frameHeight / base);
  const left = Math.max(0, Math.min(sourceWidth - boxW, sourceWidth / 2 - translateX / base - boxW / 2));
  const top = Math.max(0, Math.min(sourceHeight - boxH, sourceHeight / 2 - translateY / base - boxH / 2));
  return { x: left / sourceWidth, y: top / sourceHeight, width: boxW / sourceWidth, height: boxH / sourceHeight };
}

/** The picked clip looping muted in the crop frame — inside its trimmed 10s window when it has one. */
function CropVideo({ uri, trim }: { uri: string; trim?: { start: number; duration: number } | null }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.muted = true; p.play(); });
  useEffect(() => {
    if (!trim) return undefined;
    player.currentTime = trim.start;
    const id = setInterval(() => {
      if (player.currentTime >= trim.start + trim.duration || player.currentTime < trim.start - 0.5) player.currentTime = trim.start;
    }, 250);
    return () => clearInterval(id);
  }, [player, trim]);
  // Explicit 100% size: on web the <video> otherwise renders at its natural size.
  return <VideoView player={player} style={[StyleSheet.absoluteFill, styles.fill]} contentFit="cover" nativeControls={false} />;
}

export function BannerCropScreen({
  source, onCancel, onSave,
}: {
  source: BannerSource | null;
  onCancel: () => void;
  onSave: (rect: ProfileBannerCrop) => void;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const topInset = useHeaderTopInset();
  const window = useWindowDimensions();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  // The frame IS the profile banner on this device: same width as the
  // profile column, same height (bannerHeight), same cover fit — so what is
  // framed here is exactly what the profile shows.
  const { columnWidth } = useProfileLayout();
  const frameWidth = Math.min(window.width, columnWidth);
  const frameHeight = bannerHeight(window.height);

  useEffect(() => {
    if (!source) { setSize(null); return; }
    if (source.width > 0 && source.height > 0) { setSize({ width: source.width, height: source.height }); return; }
    if (source.kind === 'gif') {
      RNImage.getSize(source.uri, (width, height) => setSize({ width, height }), () => setSize({ width: frameWidth, height: frameHeight }));
    } else {
      // Unknown video size (some web pickers): treat it as the frame (no crop).
      setSize({ width: frameWidth, height: frameHeight });
    }
  }, [source, frameWidth, frameHeight]);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  useEffect(() => {
    scale.value = 1; savedScale.value = 1; tx.value = 0; ty.value = 0; savedTx.value = 0; savedTy.value = 0;
  }, [source?.uri]); // eslint-disable-line react-hooks/exhaustive-deps

  const base = size ? Math.max(frameWidth / size.width, frameHeight / size.height) : 1;
  const renderWidth = size ? size.width * base : frameWidth;
  const renderHeight = size ? size.height * base : frameHeight;
  const [gesturing, setGesturing] = useState(false);
  const canMove = !!size && (renderWidth > frameWidth + 1 || renderHeight > frameHeight + 1);

  function clamp(nextScale: number, x: number, y: number) {
    'worklet';
    const maxX = Math.max(0, (renderWidth * nextScale - frameWidth) / 2);
    const maxY = Math.max(0, (renderHeight * nextScale - frameHeight) / 2);
    return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
  }

  const pinch = Gesture.Pinch()
    .onBegin(() => { runOnJS(setGesturing)(true); })
    .onUpdate((event) => {
      const next = Math.max(1, Math.min(4, savedScale.value * event.scale));
      scale.value = next;
      const clamped = clamp(next, tx.value, ty.value);
      tx.value = clamped.x;
      ty.value = clamped.y;
    })
    .onEnd(() => {
      savedScale.value = scale.value; savedTx.value = tx.value; savedTy.value = ty.value;
      runOnJS(setGesturing)(false);
    });
  const pan = Gesture.Pan()
    .onBegin(() => { runOnJS(setGesturing)(true); })
    .onUpdate((event) => {
      const clamped = clamp(scale.value, savedTx.value + event.translationX, savedTy.value + event.translationY);
      tx.value = clamped.x;
      ty.value = clamped.y;
    })
    .onEnd(() => {
      savedTx.value = tx.value; savedTy.value = ty.value;
      runOnJS(setGesturing)(false);
    });
  const gesture = Gesture.Simultaneous(pinch, pan);

  const mediaStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  if (!source) return null;

  const save = () => {
    if (!size) return;
    hapticSelection();
    onSave(bannerCropRect({
      sourceWidth: size.width, sourceHeight: size.height, frameWidth, frameHeight,
      scale: scale.value, translateX: tx.value, translateY: ty.value,
    }));
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel} presentationStyle="fullScreen">
      <GestureHandlerRootView style={[styles.cropRoot, { backgroundColor: theme.background, paddingTop: topInset, paddingBottom: Math.max(insets.bottom, SP.md) }]}>
        {/* TikTok's crop: the whole picture stays visible, dimmed outside the
            banner frame; drag (and pinch) anywhere to move it under the frame. */}
        <GestureDetector gesture={gesture}>
          <View style={styles.cropStage} testID="banner-crop">
            <View style={{ width: frameWidth, height: frameHeight }} testID="banner-crop-frame">
              {size ? (
                <Animated.View
                  style={[
                    { position: 'absolute', width: renderWidth, height: renderHeight, left: (frameWidth - renderWidth) / 2, top: (frameHeight - renderHeight) / 2 },
                    mediaStyle,
                  ]}
                >
                  {source.kind === 'gif'
                    ? <CachedImage source={{ uri: source.uri }} style={StyleSheet.absoluteFill} contentFit="cover" autoplay transition={0} />
                    : <CropVideo uri={source.uri} trim={source.trim} />}
                </Animated.View>
              ) : (
                <ActivityIndicator color={theme.text} style={StyleSheet.absoluteFill} />
              )}
              {/* Outside the frame: dimmed, so the banner's edges are unmistakable. */}
              <View pointerEvents="none" style={[styles.cropDim, { bottom: frameHeight, height: 2000, left: -1000, right: -1000 }]} />
              <View pointerEvents="none" style={[styles.cropDim, { top: frameHeight, height: 2000, left: -1000, right: -1000 }]} />
              <View pointerEvents="none" style={[styles.cropDim, { top: 0, height: frameHeight, right: frameWidth, width: 1000 }]} />
              <View pointerEvents="none" style={[styles.cropDim, { top: 0, height: frameHeight, left: frameWidth, width: 1000 }]} />
              {/* The profile's own bottom fade, so the framing is exactly what shows. */}
              <BannerBottomFade height={frameHeight} testID="banner-crop-fade" />
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.cropFrameBorder]} />
              {gesturing ? (
                <View style={StyleSheet.absoluteFill} pointerEvents="none">
                  {[1, 2].map((i) => <View key={`v${i}`} style={[styles.gridV, { left: (frameWidth / 3) * i }]} />)}
                  {[1, 2].map((i) => <View key={`h${i}`} style={[styles.gridH, { top: (frameHeight / 3) * i }]} />)}
                </View>
              ) : null}
            </View>
          </View>
        </GestureDetector>
        <View style={styles.cropHint} testID="banner-crop-hint">
          <Feather name="move" size={15} color={theme.text} />
          <Text style={[styles.cropHintText, { color: theme.text }]}>{canMove ? 'Drag to reposition' : 'Pinch to zoom, then drag to reposition'}</Text>
        </View>
        <View style={styles.cropBar}>
          <Pressable onPress={onCancel} hitSlop={10} accessibilityRole="button" style={styles.cropBarSide} testID="banner-crop-cancel">
            <Text style={[styles.cropBarText, { color: theme.text }]}>Cancel</Text>
          </Pressable>
          <Text style={[styles.cropTitle, { color: theme.text }]} accessibilityRole="header">Crop</Text>
          <Pressable
            onPress={save}
            disabled={!size}
            hitSlop={10}
            accessibilityRole="button"
            style={({ pressed }) => [styles.cropBarSide, styles.cropBarRight, (pressed || !size) && styles.pressed]}
            testID="banner-crop-save"
          >
            <Text style={[styles.cropBarText, styles.cropBarStrong, { color: theme.text }]}>Save</Text>
          </Pressable>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

// ─── Edit profile: banner preview + overlapping avatar ───────────────────────

export const EDIT_BANNER_HEIGHT = 168;
const EDIT_AVATAR = 96;

export function EditProfileBanner({
  banner, busy, onEditBanner, avatar, onEditAvatar, avatarLabel = 'Edit photo or avatar', avatarDisabled,
}: {
  banner: ProfileBanner | null;
  busy: null | 'uploading' | 'removing';
  onEditBanner: () => void;
  /** The screen's existing avatar (with its own upload overlay / camera badge). */
  avatar: React.ReactNode;
  onEditAvatar: () => void;
  avatarLabel?: string;
  avatarDisabled?: boolean;
}) {
  const { theme } = useAppTheme();
  const label = busy === 'uploading' ? 'Uploading…' : busy === 'removing' ? 'Removing…' : 'Edit banner';
  return (
    <View style={styles.editRoot} testID="edit-profile-banner">
      <View style={[styles.editBanner, { backgroundColor: theme.cardElevated }]}>
        {banner ? (
          <>
            <BannerMedia banner={banner} active posterOnly={false} height={EDIT_BANNER_HEIGHT} />
            <BannerBottomFade height={EDIT_BANNER_HEIGHT} testID="edit-banner-fade" />
          </>
        ) : null}
        {/* No banner yet: the whole area is a subtle dark "Add banner" placeholder. */}
        {!banner && !busy ? (
          <BannerPlaceholder onAdd={onEditBanner} contentBottom={EDIT_AVATAR / 2} testID="edit-banner-button" />
        ) : (
        <Pressable
          onPress={onEditBanner}
          disabled={!!busy}
          accessibilityRole="button"
          accessibilityLabel={label}
          hitSlop={8}
          style={({ pressed }) => [styles.editPill, pressed && styles.pressed]}
          testID="edit-banner-button"
        >
          {busy ? <ActivityIndicator size="small" color="#000000" /> : <Feather name="film" size={14} color="#000000" />}
          <Text style={styles.editPillText}>{label}</Text>
        </Pressable>
        )}
      </View>
      <Pressable
        onPress={onEditAvatar}
        disabled={avatarDisabled}
        accessibilityRole="button"
        accessibilityLabel={avatarLabel}
        style={[styles.editAvatar, { borderColor: theme.background, backgroundColor: theme.background }]}
        testID="edit-banner-avatar"
      >
        {avatar}
      </Pressable>
      <Pressable onPress={onEditAvatar} disabled={avatarDisabled} accessibilityRole="button" hitSlop={8}>
        <Text style={[styles.editAvatarLabel, { color: theme.text }]}>{avatarLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
  fill: { width: '100%', height: '100%' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' }, // theme-exempt: system action-sheet dim
  sheetHost: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: SP.sm, gap: SP.sm },
  sheetGroup: { borderRadius: 14, overflow: 'hidden', width: '100%', maxWidth: 560, alignSelf: 'center' },
  sheetRow: { minHeight: 57, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.md },
  sheetText: { fontFamily: FONT.regular, fontSize: 20, letterSpacing: -0.4 },
  sheetCancel: { fontFamily: FONT.semibold },

  cropRoot: { flex: 1 },
  cropTitle: { fontFamily: FONT.semibold, fontSize: 17 },
  cropStage: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  cropDim: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.62)' }, // theme-exempt: outside-the-frame dim (TikTok crop)
  cropFrameBorder: { borderWidth: 1, borderColor: ON_DARK },
  cropHint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: SP.md },
  cropHintText: { fontFamily: FONT.semibold, fontSize: 14 },
  cropBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingTop: SP.md, minHeight: 52 },
  cropBarSide: { flex: 1, minHeight: 44, justifyContent: 'center' },
  cropBarRight: { alignItems: 'flex-end' },
  cropBarText: { fontFamily: FONT.regular, fontSize: 17 },
  cropBarStrong: { fontFamily: FONT.semibold },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: ON_DARK },
  gridH: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: ON_DARK },

  editRoot: { alignItems: 'center', paddingBottom: SP.md },
  editBanner: { width: '100%', height: EDIT_BANNER_HEIGHT, overflow: 'hidden', justifyContent: 'center' },
  editPill: {
    position: 'absolute', right: SP.md, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16,
    backgroundColor: '#FFFFFF', // theme-exempt: white pill over banner media (TikTok)
  },
  editPillText: { fontFamily: FONT.semibold, fontSize: 13, color: '#000000' }, // theme-exempt: on the white pill
  editAvatar: {
    marginTop: -EDIT_AVATAR / 2, width: EDIT_AVATAR + 8, height: EDIT_AVATAR + 8, borderRadius: (EDIT_AVATAR + 8) / 2,
    borderWidth: 4, alignItems: 'center', justifyContent: 'center',
  },
  editAvatarLabel: { fontFamily: FONT.semibold, fontSize: 14, marginTop: SP.sm },
});
