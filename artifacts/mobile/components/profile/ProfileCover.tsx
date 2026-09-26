/**
 * Profile cover video — the owner-side flow around the hero:
 *
 *  - `useProfileCover` loads the server-side coach-mark flag (own profile
 *    only), runs pick → (trim) → upload / remove, and surfaces the server's
 *    24h-limit message ("You can change your cover again in X hours").
 *  - `CoverCoachmarkSheet` — the one-time "add a cover video" pop-up.
 *  - `CoverTrimSheet` — shown for clips over 30s; suggests the first 20s.
 *  - `CoverManageSheet` — change / remove an existing cover.
 *
 * Avatar editing is untouched — the cover is a separate thing.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Animated, Modal, PanResponder, Platform, Pressable, StyleSheet, Text, View,
  type LayoutChangeEvent,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from '@/components/BrandthreadUI';
import { useApi } from '@/hooks/useApi';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { hapticLight, hapticSelection } from '@/lib/haptics';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { emitProfileEvent } from '@/lib/profileEvents';
import { InteractionLayer, ProfileButton } from './ProfileControls';
import { ProfileThread } from './ProfileThread';
import {
  COVER_TRIM_LENGTHS, clampTrim, defaultTrim, formatClock, needsTrim, pickerDurationSeconds, shouldShowCoverCoachmark,
} from './profileCoverRules';

export interface CoverMedia { videoUrl: string | null; posterUrl: string | null }
type PickedVideo = { uri: string; mimeType: string | null; durationSeconds: number | null };

function errorMessage(error: unknown): string {
  const message = (error as { message?: string } | null)?.message;
  return typeof message === 'string' && message.trim() ? message : "Couldn't update your cover. Try again.";
}

function notify(title: string, message?: string) {
  if (Platform.OS === 'web') {
    // RN-web's Alert is a no-op; the browser dialog is the only reliable surface.
    if (typeof window !== 'undefined') window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

export function useProfileCover({ own, cover, userId }: { own: boolean; cover: CoverMedia; userId?: string | null }) {
  const api = useApi();
  const [current, setCurrent] = useState<CoverMedia>(cover);
  const [coachStatus, setCoachStatus] = useState<{ seen: boolean; hasCover: boolean } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState<null | 'uploading' | 'removing'>(null);
  const [trimSource, setTrimSource] = useState<PickedVideo | null>(null);
  const [manageOpen, setManageOpen] = useState(false);

  // Server data wins when it changes (refetch after focus, etc.).
  useEffect(() => { setCurrent(cover); }, [cover.videoUrl, cover.posterUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!own) return;
    let alive = true;
    api.profileCover.coachmark()
      .then((status) => { if (alive) setCoachStatus(status); })
      .catch(() => { /* no coach mark rather than a broken one */ });
    return () => { alive = false; };
  }, [api, own, userId]);

  const coachmarkVisible = shouldShowCoverCoachmark({ own, status: coachStatus, dismissedLocally: dismissed });

  const dismissCoachmark = useCallback(() => {
    setDismissed(true);
    api.profileCover.markCoachmarkSeen().catch(() => {});
  }, [api]);

  const upload = useCallback(async (video: PickedVideo, trim: { start: number; duration: number } | null) => {
    setBusy('uploading');
    try {
      const saved = await api.profileCover.upload(video.uri, video.mimeType, trim);
      setCurrent({ videoUrl: saved.coverVideoUrl, posterUrl: saved.coverPosterUrl });
      emitProfileEvent({ type: 'content', ownerId: userId ?? null });
    } catch (error) {
      notify('Cover not updated', errorMessage(error));
    } finally {
      setBusy(null);
    }
  }, [api, userId]);

  const handlePicked = useCallback((video: PickedVideo) => {
    if (needsTrim(video.durationSeconds)) setTrimSource(video);
    else void upload(video, null);
  }, [upload]);

  const pickFrom = useCallback(async (source: 'library' | 'camera') => {
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) { notify('Camera access needed', 'Allow camera access to record a cover video.'); return; }
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['videos'], quality: 1, videoMaxDuration: source === 'camera' ? 30 : undefined };
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      handlePicked({ uri: asset.uri, mimeType: asset.mimeType ?? null, durationSeconds: pickerDurationSeconds(asset.duration) });
    } catch (error) {
      notify("Couldn't open your videos", errorMessage(error));
    }
  }, [handlePicked]);

  const startAdd = useCallback(() => {
    hapticLight();
    if (Platform.OS === 'web') { void pickFrom('library'); return; }
    Alert.alert('Add cover video', 'Up to 30 seconds. It plays muted on a loop.', [
      { text: 'Choose from library', onPress: () => { void pickFrom('library'); } },
      { text: 'Record video', onPress: () => { void pickFrom('camera'); } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [pickFrom]);

  const remove = useCallback(async () => {
    setManageOpen(false);
    setBusy('removing');
    try {
      await api.profileCover.remove();
      setCurrent({ videoUrl: null, posterUrl: null });
      emitProfileEvent({ type: 'content', ownerId: userId ?? null });
    } catch (error) {
      notify('Cover not removed', errorMessage(error));
    } finally {
      setBusy(null);
    }
  }, [api, userId]);

  return {
    cover: current,
    hasCover: !!current.videoUrl,
    busy,
    coachmarkVisible,
    dismissCoachmark,
    startAdd,
    openManage: () => { hapticSelection(); setManageOpen(true); },
    manageOpen,
    closeManage: () => setManageOpen(false),
    changeFromManage: () => { setManageOpen(false); startAdd(); },
    remove,
    trimSource,
    cancelTrim: () => setTrimSource(null),
    confirmTrim: (trim: { start: number; duration: number }) => {
      const source = trimSource;
      setTrimSource(null);
      if (source) void upload(source, trim);
    },
  };
}

// ─── Sheets ───────────────────────────────────────────────────────────────────

function Sheet({ visible, onClose, children, testID }: { visible: boolean; onClose: () => void; children: React.ReactNode; testID?: string }) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) { rise.setValue(0); return; }
    Animated.spring(rise, { toValue: 1, damping: 18, stiffness: 180, mass: 0.9, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [rise, visible]);
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: `${theme.background}B3` }]} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.sheetHost} pointerEvents="box-none">
        <Animated.View
          testID={testID}
          style={[
            styles.sheet,
            { backgroundColor: theme.card, borderColor: theme.border, paddingBottom: Math.max(insets.bottom, SP.md) + SP.sm },
            { opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [48, 0] }) }] },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: theme.border }]} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

export function CoverCoachmarkSheet({ visible, onAdd, onLater }: { visible: boolean; onAdd: () => void; onLater: () => void }) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  return (
    <Sheet visible={visible} onClose={onLater} testID="cover-coachmark">
      <View style={s.coachArt} pointerEvents="none">
        <ProfileThread height={120} color={theme.text} style={s.coachThread} />
        <View style={[s.coachIcon, { borderColor: theme.border, backgroundColor: theme.background }]}>
          <Feather name="film" size={26} color={theme.text} />
        </View>
      </View>
      <Text style={s.coachTitle} accessibilityRole="header">Make your profile move</Text>
      <Text style={s.coachBody}>
        Add a short video as your profile cover. It plays on a silent loop for everyone who visits — up to 30 seconds.
      </Text>
      <View style={s.coachActions}>
        <ProfileButton label="Add cover video" icon="film" variant="primary" onPress={onAdd} testID="cover-coachmark-add" />
      </View>
      <View style={s.coachActions}>
        <ProfileButton label="Maybe later" onPress={onLater} testID="cover-coachmark-later" />
      </View>
    </Sheet>
  );
}

export function CoverManageSheet({ visible, onChange, onRemove, onClose }: { visible: boolean; onChange: () => void; onRemove: () => void; onClose: () => void }) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  return (
    <Sheet visible={visible} onClose={onClose} testID="cover-manage">
      <Text style={s.coachTitle} accessibilityRole="header">Profile cover</Text>
      <Text style={s.coachBody}>You can change your cover once every 24 hours. Removing it counts as a change.</Text>
      <View style={s.coachActions}><ProfileButton label="Change cover video" icon="film" variant="primary" onPress={onChange} testID="cover-manage-change" /></View>
      <View style={s.coachActions}><ProfileButton label="Remove cover" icon="trash-2" onPress={onRemove} testID="cover-manage-remove" /></View>
      <View style={s.coachActions}><ProfileButton label="Cancel" onPress={onClose} /></View>
    </Sheet>
  );
}

export function CoverTrimSheet({
  source,
  onCancel,
  onConfirm,
}: {
  source: { uri: string; durationSeconds: number | null } | null;
  onCancel: () => void;
  onConfirm: (trim: { start: number; duration: number }) => void;
}) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const total = source?.durationSeconds ?? 0;
  const [trim, setTrim] = useState(() => defaultTrim(total));
  useEffect(() => { setTrim(defaultTrim(total)); }, [total, source?.uri]);
  const [trackWidth, setTrackWidth] = useState(0);

  const player = useVideoPlayer(source?.uri ?? null, (p) => { p.loop = false; p.muted = true; });
  // Preview loops inside the selected window.
  useEffect(() => {
    if (!source) return;
    player.currentTime = trim.start;
    player.play();
    const id = setInterval(() => {
      if (player.currentTime >= trim.start + trim.duration || player.currentTime < trim.start - 0.5) player.currentTime = trim.start;
    }, 250);
    return () => clearInterval(id);
  }, [player, source, trim.start, trim.duration]);

  const startRef = useRef(trim.start);
  startRef.current = trim.start;
  const pan = useMemo(() => {
    let origin = 0;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => { origin = startRef.current; },
      onPanResponderMove: (_event, gesture) => {
        if (trackWidth <= 0 || total <= 0) return;
        setTrim((prev) => clampTrim(origin + (gesture.dx / trackWidth) * total, prev.duration, total));
      },
    });
  }, [total, trackWidth]);

  const windowLeft = total > 0 ? (trim.start / total) * trackWidth : 0;
  const windowWidth = total > 0 ? Math.max(24, (trim.duration / total) * trackWidth) : trackWidth;

  return (
    <Sheet visible={!!source} onClose={onCancel} testID="cover-trim">
      <Text style={s.coachTitle} accessibilityRole="header">Trim your cover</Text>
      <Text style={s.coachBody}>Covers are up to 30 seconds. Drag the window to pick the part that loops.</Text>
      <View style={[s.trimPreview, { borderColor: theme.border }]}>
        {source ? <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} /> : null}
      </View>
      <View
        style={[s.trimTrack, { backgroundColor: theme.cardElevated, borderColor: theme.border }]}
        onLayout={(event: LayoutChangeEvent) => setTrackWidth(event.nativeEvent.layout.width)}
        accessibilityRole="adjustable"
        accessibilityLabel={`Cover window ${formatClock(trim.start)} to ${formatClock(trim.start + trim.duration)}`}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          const step = event.nativeEvent.actionName === 'increment' ? 1 : -1;
          setTrim((prev) => clampTrim(prev.start + step, prev.duration, total));
        }}
      >
        <View
          {...pan.panHandlers}
          testID="cover-trim-window"
          style={[s.trimWindow, { left: windowLeft, width: windowWidth, borderColor: theme.text, backgroundColor: `${theme.text}22` }]}
        />
      </View>
      <Text style={s.trimTimes}>{formatClock(trim.start)} – {formatClock(trim.start + trim.duration)} · {Math.round(trim.duration)}s</Text>
      <View style={s.trimChips}>
        {COVER_TRIM_LENGTHS.filter((length) => length <= Math.ceil(total)).map((length) => {
          const selected = Math.round(trim.duration) === length;
          return (
            <PressableScale
              key={length}
              onPress={() => { hapticSelection(); setTrim((prev) => clampTrim(prev.start, length, total)); }}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${length} seconds`}
              style={[s.trimChip, { borderColor: selected ? theme.text : theme.border, backgroundColor: selected ? theme.text : 'transparent' }]}
            >
              {(state) => (
                <>
                  <InteractionLayer state={state as { pressed: boolean }} radius={RADIUS.pill} theme={theme} />
                  <Text style={[s.trimChipText, { color: selected ? theme.background : theme.text }]}>{length}s</Text>
                </>
              )}
            </PressableScale>
          );
        })}
      </View>
      <View style={s.coachActions}>
        <ProfileButton label="Use this part" icon="check" variant="primary" onPress={() => onConfirm(clampTrim(trim.start, trim.duration, total))} testID="cover-trim-confirm" />
      </View>
      <View style={s.coachActions}><ProfileButton label="Cancel" onPress={onCancel} /></View>
    </Sheet>
  );
}

/** The hero affordances: "Add cover video" pill (no cover) / cover menu button (has cover). */
export function CoverHeroAffordance({
  hasCover,
  busy,
  onAdd,
  onManage,
}: {
  hasCover: boolean;
  busy: null | 'uploading' | 'removing';
  onAdd: () => void;
  onManage: () => void;
}) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const label = busy === 'uploading' ? 'Uploading cover…' : busy === 'removing' ? 'Removing cover…' : hasCover ? 'Edit cover' : 'Add cover video';
  return (
    <PressableScale
      onPress={hasCover ? onManage : onAdd}
      disabled={!!busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hasCover ? 'Change or remove your profile cover video' : 'Pick or record a short video to play behind your profile'}
      testID="profile-cover-affordance"
      style={[s.affordance, { backgroundColor: theme.cardGlass, borderColor: theme.border }]}
    >
      {(state) => (
        <>
          <InteractionLayer state={state as { pressed: boolean }} radius={RADIUS.pill} theme={theme} />
          <Feather name={busy ? 'loader' : hasCover ? 'film' : 'plus'} size={15} color={theme.text} />
          <Text style={s.affordanceText} numberOfLines={1}>{label}</Text>
        </>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheetHost: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  sheet: {
    width: '100%', maxWidth: 560, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1,
    paddingHorizontal: SP.lg, paddingTop: SP.sm, gap: SP.sm,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: SP.sm },
});

function makeStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    coachArt: { height: 132, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    coachThread: { position: 'absolute', left: -SP.lg, right: -SP.lg, top: 6 },
    coachIcon: { width: 64, height: 64, borderRadius: 32, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
    coachTitle: { ...TYPE_SCALE.title1, color: theme.text, textAlign: 'center', letterSpacing: -0.6 },
    coachBody: { fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 21, color: theme.muted, textAlign: 'center', marginBottom: SP.sm },
    coachActions: { flexDirection: 'row' },
    trimPreview: { alignSelf: 'center', width: 150, aspectRatio: 9 / 16, borderRadius: RADIUS.md, overflow: 'hidden', borderWidth: 1, backgroundColor: theme.background },
    trimTrack: { height: 48, borderRadius: RADIUS.sm, borderWidth: 1, marginTop: SP.sm, justifyContent: 'center' },
    trimWindow: { position: 'absolute', top: -1, bottom: -1, borderWidth: 2, borderRadius: RADIUS.sm },
    trimTimes: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text, textAlign: 'center', fontVariant: ['tabular-nums'] },
    trimChips: { flexDirection: 'row', justifyContent: 'center', gap: SP.sm, marginBottom: SP.sm },
    trimChip: { minWidth: 56, height: 44, borderRadius: RADIUS.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.md, overflow: 'hidden' },
    trimChipText: { fontFamily: FONT.bold, fontSize: FS.sm },
    affordance: {
      height: 44, borderRadius: RADIUS.pill, borderWidth: 1, flexDirection: 'row', alignItems: 'center',
      gap: 8, paddingHorizontal: SP.md, overflow: 'hidden', alignSelf: 'center',
    },
    affordanceText: { fontFamily: FONT.bold, fontSize: FS.sm, color: theme.text },
  });
}
