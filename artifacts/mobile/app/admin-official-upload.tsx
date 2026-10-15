/**
 * Admin bulk upload to @brandthread. Platform admins pick several videos from
 * the camera roll (one Thread each) and/or photo sets (one swipeable slideshow
 * Thread of up to 10 photos each), give every Thread its own caption and
 * optional creator credit, then publish them all now or spread them out on a
 * schedule. Each Thread goes through the same upload/compose pipeline as the
 * composer (lib/createPost/publish.ts) with `postAs: 'brandthread'`.
 * Non-admins see an access notice; the server enforces the role regardless.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { CP, PillButton, tap } from '@/components/create-post/ui';
import { ReorderStrip } from '@/components/create-post/ReorderStrip';
import { useApi } from '@/lib/api';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { FONT } from '@/lib/theme';
import { isBuyerDevPreview, isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { assetToSlide } from '@/lib/createPost/slides';
import { publishCreatePost } from '@/lib/createPost/publish';
import type { MediaDraft, PickedAsset, PostDetails } from '@/lib/createPost/types';
import { MAX_VIDEO_SECONDS } from '@/constants/postLimits';
import { OFFICIAL_AVATAR_SOURCE, OFFICIAL_HANDLE } from '@/lib/officialAccount';
import {
  BULK_SLIDESHOW_ASPECTS, MAX_BULK_ITEMS, MAX_SLIDESHOW_PHOTOS, defaultSpreadStart, isValidCreditHandle,
  moveItem, normalizeCreditHandle, scheduleTimes, type BulkSlideshowAspect, type PublishPlan,
} from '@/lib/officialUpload';
import { isOfficialSeedPreview, setOfficialSeedPreview } from '@/services/officialSeedService';
import { previewBulkItems } from '@/lib/previewOfficialAccount';

type Status = { phase: 'ready' } | { phase: 'uploading'; fraction: number } | { phase: 'done'; scheduled: boolean } | { phase: 'error'; message: string };

type BulkItem = {
  id: string;
  kind: 'video' | 'slideshow';
  /** Video: the clip. Slideshow: ordered photos. */
  assets: PickedAsset[];
  aspect: BulkSlideshowAspect;
  caption: string;
  creditHandle: string;
  creditName: string;
  status: Status;
};

const SPREAD_OPTIONS = [
  { hours: 3, label: 'Every 3h' },
  { hours: 12, label: 'Every 12h' },
  { hours: 24, label: 'Daily' },
] as const;

let idCounter = 0;
const nextId = () => `bulk-${Date.now().toString(36)}-${(idCounter += 1)}`;

function toPicked(a: ImagePicker.ImagePickerAsset): PickedAsset {
  return {
    id: a.assetId ?? a.uri,
    uri: a.uri,
    kind: a.type === 'video' ? 'video' : 'photo',
    duration: a.type === 'video' ? Math.max(0.1, (a.duration ?? 0) / 1000) : 0,
    width: a.width,
    height: a.height,
    mimeType: a.mimeType ?? null,
  };
}

function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : '';
  try {
    const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
    if (typeof parsed?.error === 'string') return parsed.error;
    if (typeof parsed?.error?.message === 'string') return parsed.error.message;
  } catch { /* not JSON */ }
  return 'Upload failed. Check your connection and retry.';
}

export default function AdminOfficialUploadScreen() {
  const router = useRouter();
  const api = useApi();
  const insets = useSafeAreaInsets();
  const preview = isSellerDevPreview() || isBuyerDevPreview();
  // The signed-out demo preview shows the admin tools so they can be reviewed.
  const [isAdmin, setIsAdmin] = useState<boolean | null>(preview ? isPreviewDemoMode() : null);
  const [items, setItems] = useState<BulkItem[]>(() => (preview && isPreviewDemoMode()
    ? previewBulkItems().map((it): BulkItem => ({ ...it, id: nextId(), aspect: '4:5', status: { phase: 'ready' } }))
    : []));
  const [plan, setPlan] = useState<PublishPlan>({ kind: 'now' });
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [seedPreview, setSeedPreview] = useState(isOfficialSeedPreview());

  useEffect(() => {
    if (preview) return;
    let live = true;
    api.moderation.me()
      .then((r: { isModerator: boolean }) => { if (live) setIsAdmin(r.isModerator === true); })
      .catch(() => { if (live) setIsAdmin(false); });
    return () => { live = false; };
  }, [api, preview]);

  const remaining = MAX_BULK_ITEMS - items.length;
  const update = useCallback((id: string, patch: Partial<BulkItem>) => {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  async function pick(kind: 'videos' | 'photos', limit: number): Promise<PickedAsset[]> {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setNotice('Allow photo library access in Settings to pick media.'); return []; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: kind === 'videos' ? ['videos'] : ['images'],
      allowsMultipleSelection: true,
      selectionLimit: limit,
      orderedSelection: true,
      quality: 1,
      videoMaxDuration: MAX_VIDEO_SECONDS,
    });
    if (result.canceled) return [];
    return result.assets.slice(0, limit).map(toPicked);
  }

  async function addVideos() {
    tap();
    if (remaining <= 0) return;
    const picked = await pick('videos', remaining);
    setItems((list) => [...list, ...picked.map((asset): BulkItem => ({
      id: nextId(), kind: 'video', assets: [asset], aspect: '4:5', caption: '', creditHandle: '', creditName: '', status: { phase: 'ready' },
    }))]);
  }

  async function addSlideshow() {
    tap();
    if (remaining <= 0) return;
    const picked = await pick('photos', MAX_SLIDESHOW_PHOTOS);
    if (picked.length === 0) return;
    setItems((list) => [...list, {
      id: nextId(), kind: 'slideshow', assets: picked, aspect: '4:5', caption: '', creditHandle: '', creditName: '', status: { phase: 'ready' },
    }]);
  }

  async function addPhotosTo(item: BulkItem) {
    const room = MAX_SLIDESHOW_PHOTOS - item.assets.length;
    if (room <= 0) return;
    const picked = await pick('photos', room);
    if (picked.length > 0) update(item.id, { assets: [...item.assets, ...picked] });
  }

  const invalid = useMemo(() => items.find((it) => !isValidCreditHandle(it.creditHandle)), [items]);
  const pending = items.filter((it) => it.status.phase !== 'done');

  async function publishAll() {
    if (running || pending.length === 0) return;
    if (invalid) { setNotice('A credit handle can only use letters, numbers, dots and underscores.'); return; }
    if (preview) { setNotice('Publishing is off in the preview. Sign in as an admin to publish.'); return; }
    let times: Array<string | null>;
    try {
      times = scheduleTimes(pending.length, plan);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Pick a different schedule.');
      return;
    }
    setNotice(null);
    setRunning(true);
    let failed = 0;
    for (let i = 0; i < pending.length; i += 1) {
      const item = pending[i];
      update(item.id, { status: { phase: 'uploading', fraction: 0 } });
      try {
        const media: MediaDraft = item.kind === 'video'
          ? {
              kind: 'video',
              video: {
                uri: item.assets[0].uri, mimeType: item.assets[0].mimeType,
                duration: Math.min(item.assets[0].duration, MAX_VIDEO_SECONDS), speed: 1,
                trimStart: 0, trimEnd: Math.min(item.assets[0].duration, MAX_VIDEO_SECONDS), coverOffset: 0,
              },
            }
          : { kind: 'slides', slides: await Promise.all(item.assets.map(assetToSlide)), aspect: item.aspect, coverIndex: 0 };
        const details: PostDetails = {
          caption: item.caption.trim(),
          productTags: [],
          visibility: { isPublic: true, allowComments: true, allowReposts: true, showLikeCount: true },
          scheduledAt: times[i],
          postAsOfficial: true,
          creditHandle: normalizeCreditHandle(item.creditHandle),
          creditName: item.creditName.trim() || undefined,
        };
        await publishCreatePost({
          api,
          input: { mode: 'thread', media, details, isDraft: false },
          onProgress: (fraction) => update(item.id, { status: { phase: 'uploading', fraction } }),
        });
        update(item.id, { status: { phase: 'done', scheduled: times[i] !== null } });
      } catch (error) {
        failed += 1;
        update(item.id, { status: { phase: 'error', message: errorText(error) } });
      }
    }
    setRunning(false);
    Haptics.notificationAsync(failed ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success).catch(() => {});
    setNotice(failed
      ? `${failed} Thread${failed === 1 ? '' : 's'} didn't upload. Tap Publish again to retry them.`
      : `All set — ${pending.length} Thread${pending.length === 1 ? '' : 's'} ${plan.kind === 'now' ? 'published' : 'scheduled'} on ${OFFICIAL_HANDLE}.`);
  }

  if (isAdmin === null) {
    return (
      <View style={[s.root, s.center]}><ActivityIndicator color={CP.white} /></View>
    );
  }
  if (!isAdmin) {
    return (
      <View style={s.root}>
        <ScreenHeader title={`Upload to ${OFFICIAL_HANDLE}`} onBack={() => goBackOr(router)} />
        <View style={s.center}><Text style={s.muted}>Admin access required.</Text></View>
      </View>
    );
  }

  const label = plan.kind === 'now'
    ? `Publish ${pending.length || ''} now`.replace('  ', ' ')
    : `Schedule ${pending.length || ''}`.replace('  ', ' ');

  return (
    <View style={s.root} testID="admin-official-upload">
      <ScreenHeader title={`Upload to ${OFFICIAL_HANDLE}`} onBack={() => goBackOr(router)} />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <View style={s.account}>
          <View style={s.avatar}><Image source={OFFICIAL_AVATAR_SOURCE} style={{ width: '100%', height: '100%' }} /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.accountName}>Brandthread</Text>
            <Text style={s.muted}>{`Each item becomes one Thread on ${OFFICIAL_HANDLE}.`}</Text>
          </View>
        </View>

        <View style={s.addRow}>
          <PillButton label="Videos" icon="plus" variant="secondary" onPress={addVideos} disabled={running || remaining <= 0} testID="bulk-add-videos" />
          <PillButton label="Slideshow" icon="plus" variant="secondary" onPress={addSlideshow} disabled={running || remaining <= 0} testID="bulk-add-slideshow" />
        </View>
        <Text style={s.hint}>{`${items.length}/${MAX_BULK_ITEMS} Threads · slideshows hold up to ${MAX_SLIDESHOW_PHOTOS} photos`}</Text>

        {items.map((item, index) => (
          <View key={item.id} style={s.card} testID={`bulk-item-${index}`}>
            <View style={s.cardHead}>
              <Text style={s.cardTitle}>{`${index + 1}. ${item.kind === 'video' ? 'Video' : `Slideshow · ${item.assets.length} photos`}`}</Text>
              <StatusPill status={item.status} />
              {!running && item.status.phase !== 'done' ? (
                <Pressable onPress={() => setItems((l) => l.filter((x) => x.id !== item.id))} hitSlop={10} accessibilityLabel="Remove" testID={`bulk-remove-${index}`}>
                  <Feather name="x" size={18} color={CP.silver} />
                </Pressable>
              ) : null}
            </View>

            {item.kind === 'video' ? (
              <View style={s.videoThumb}><Feather name="video" size={22} color={CP.silver} /><Text style={s.muted}>{`${Math.round(item.assets[0].duration)}s`}</Text></View>
            ) : (
              <>
                <ReorderStrip
                  items={item.assets}
                  itemW={item.aspect === '4:5' ? 64 : 60}
                  itemH={80}
                  padding={0}
                  onReorder={(from, to) => update(item.id, { assets: moveItem(item.assets, from, to) })}
                  renderItem={(asset, i) => (
                    <View style={[s.slideThumb, { width: item.aspect === '4:5' ? 64 : 60 }]}>
                      <Image source={{ uri: asset.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                      <Text style={s.slideNum}>{i + 1}</Text>
                    </View>
                  )}
                  testID={`bulk-slides-${index}`}
                />
                <View style={s.aspectRow}>
                  {BULK_SLIDESHOW_ASPECTS.map((a) => (
                    <Pressable key={a} onPress={() => update(item.id, { aspect: a })} style={[s.chip, item.aspect === a && s.chipOn]} accessibilityState={{ selected: item.aspect === a }} testID={`bulk-aspect-${index}-${a.replace(':', 'x')}`}>
                      <Text style={[s.chipText, item.aspect === a && s.chipTextOn]}>{a}</Text>
                    </Pressable>
                  ))}
                  {item.assets.length < MAX_SLIDESHOW_PHOTOS ? (
                    <Pressable onPress={() => addPhotosTo(item)} style={s.chip} testID={`bulk-add-photos-${index}`}>
                      <Text style={s.chipText}>+ Photos</Text>
                    </Pressable>
                  ) : null}
                </View>
                <Text style={[s.hint, s.hintInCard]}>Hold and drag to reorder · centre-cropped to the ratio (fine-tune crops in the composer)</Text>
              </>
            )}

            <TextInput
              value={item.caption}
              onChangeText={(caption) => update(item.id, { caption: caption.slice(0, 2200) })}
              placeholder="Caption"
              placeholderTextColor={CP.silverDim}
              multiline
              style={[s.input, s.caption]}
              editable={!running && item.status.phase !== 'done'}
              testID={`bulk-caption-${index}`}
            />
            <View style={s.creditRow}>
              <View style={[s.input, s.handleBox, !isValidCreditHandle(item.creditHandle) && s.inputError]}>
                <Text style={s.at}>@</Text>
                <TextInput
                  value={item.creditHandle}
                  onChangeText={(t) => update(item.id, { creditHandle: t.replace(/^@+/, '').replace(/\s/g, '').slice(0, 30) })}
                  placeholder="credit"
                  placeholderTextColor={CP.silverDim}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={s.bare}
                  editable={!running && item.status.phase !== 'done'}
                  testID={`bulk-credit-handle-${index}`}
                />
              </View>
              <TextInput
                value={item.creditName}
                onChangeText={(t) => update(item.id, { creditName: t.slice(0, 60) })}
                placeholder="name (optional)"
                placeholderTextColor={CP.silverDim}
                style={[s.input, { flex: 1, minWidth: 0 }]}
                editable={!running && item.status.phase !== 'done'}
                testID={`bulk-credit-name-${index}`}
              />
            </View>
            {item.status.phase === 'error' ? <Text style={s.error}>{item.status.message}</Text> : null}
          </View>
        ))}

        {items.length > 0 ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>When</Text>
            <View style={s.aspectRow}>
              <Pressable onPress={() => setPlan({ kind: 'now' })} style={[s.chip, plan.kind === 'now' && s.chipOn]} testID="bulk-plan-now">
                <Text style={[s.chipText, plan.kind === 'now' && s.chipTextOn]}>All now</Text>
              </Pressable>
              {SPREAD_OPTIONS.map((o) => {
                const on = plan.kind === 'spread' && plan.everyHours === o.hours;
                return (
                  <Pressable key={o.hours} onPress={() => setPlan({ kind: 'spread', everyHours: o.hours, startAt: defaultSpreadStart() })} style={[s.chip, on && s.chipOn]} testID={`bulk-plan-${o.hours}h`}>
                    <Text style={[s.chipText, on && s.chipTextOn]}>{o.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {plan.kind === 'spread' ? (
              <Text style={s.hint}>{`First at ${new Date(plan.startAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}, then one every ${plan.everyHours}h.`}</Text>
            ) : null}
          </View>
        ) : null}

        <Pressable
          onPress={() => { const next = !seedPreview; setOfficialSeedPreview(next); setSeedPreview(next); tap(); }}
          style={s.previewRow}
          accessibilityRole="switch"
          accessibilityState={{ checked: seedPreview }}
          testID="bulk-seed-preview"
        >
          <Feather name={seedPreview ? 'check-square' : 'square'} size={20} color={CP.white} />
          <View style={{ flex: 1 }}>
            <Text style={s.previewTitle}>Preview the new-user Threads feed</Text>
            <Text style={s.muted}>Your Threads tab shows the official posts the way a brand-new account sees them (pull to refresh). Only on this device, nothing is recorded.</Text>
          </View>
        </Pressable>

        {notice ? <Text style={s.notice} testID="bulk-notice">{notice}</Text> : null}
      </ScrollView>

      <View style={[s.bottom, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <PillButton label={running ? 'Uploading…' : label} icon="send" onPress={publishAll} disabled={running || pending.length === 0} loading={running} testID="bulk-publish" />
      </View>
    </View>
  );
}

function StatusPill({ status }: { status: Status }) {
  const text = status.phase === 'uploading' ? `${Math.round(status.fraction * 100)}%`
    : status.phase === 'done' ? (status.scheduled ? 'Scheduled' : 'Posted')
    : status.phase === 'error' ? 'Failed' : null;
  if (!text) return <View style={{ flex: 1 }} />;
  return (
    <View style={{ flex: 1, alignItems: 'flex-end', paddingRight: 8 }}>
      <Text style={[s.status, status.phase === 'error' && { color: CP.white, borderColor: CP.white }]}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: CP.black },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: CP.silver, fontFamily: FONT.regular, fontSize: 13 },
  account: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden', backgroundColor: CP.black, borderWidth: 1, borderColor: CP.surface2 },
  accountName: { color: CP.white, fontFamily: FONT.bold, fontSize: 16 },
  addRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 4 },
  hint: { color: CP.silverDim, fontFamily: FONT.regular, fontSize: 12, paddingHorizontal: 16, marginTop: 8 },
  hintInCard: { paddingHorizontal: 0, marginTop: 0 },
  card: { marginHorizontal: 16, marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: CP.surface, gap: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center' },
  cardTitle: { color: CP.white, fontFamily: FONT.semibold, fontSize: 14 },
  status: { color: CP.silver, fontFamily: FONT.semibold, fontSize: 11, borderWidth: 1, borderColor: CP.silverDim, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  videoThumb: { height: 56, borderRadius: 8, backgroundColor: CP.surface2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  slideThumb: { height: 80, borderRadius: 6, overflow: 'hidden', backgroundColor: CP.surface2 },
  slideNum: { position: 'absolute', top: 4, left: 4, color: CP.white, fontFamily: FONT.bold, fontSize: 11, backgroundColor: `${CP.black}99`, paddingHorizontal: 5, borderRadius: 4, overflow: 'hidden' },
  aspectRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: CP.surface2, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: CP.white },
  chipText: { color: CP.white, fontFamily: FONT.semibold, fontSize: 13 },
  chipTextOn: { color: CP.black },
  input: { minHeight: 40, borderRadius: 8, backgroundColor: CP.surface2, paddingHorizontal: 10, color: CP.white, fontFamily: FONT.regular, fontSize: 14, outlineStyle: 'none' as any },
  inputError: { borderWidth: 1, borderColor: CP.white },
  caption: { minHeight: 64, paddingTop: 10, textAlignVertical: 'top' },
  creditRow: { flexDirection: 'row', gap: 8 },
  handleBox: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  at: { color: CP.silver, fontFamily: FONT.semibold, fontSize: 14 },
  bare: { flex: 1, minWidth: 0, width: '100%', height: 40, paddingHorizontal: 4, color: CP.white, fontFamily: FONT.regular, fontSize: 14, outlineStyle: 'none' as any },
  error: { color: CP.white, fontFamily: FONT.medium, fontSize: 12 },
  section: { paddingHorizontal: 16, marginTop: 18, gap: 8 },
  sectionTitle: { color: CP.white, fontFamily: FONT.semibold, fontSize: 15 },
  previewRow: { flexDirection: 'row', gap: 12, marginHorizontal: 16, marginTop: 18, padding: 12, borderRadius: 12, backgroundColor: CP.surface },
  previewTitle: { color: CP.white, fontFamily: FONT.semibold, fontSize: 14, marginBottom: 2 },
  notice: { color: CP.white, fontFamily: FONT.medium, fontSize: 13, paddingHorizontal: 16, marginTop: 14 },
  bottom: { paddingHorizontal: 16, paddingTop: 10, backgroundColor: CP.black, flexDirection: 'row' },
});
