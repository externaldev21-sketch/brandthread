/**
 * Step 4 — the post screen (TikTok's): back arrow + title, caption with
 * #hashtags / @mentions beside the cover, Hashtags / Mention chips, option
 * rows (tag products, visibility, more options, schedule) and the Drafts /
 * Post pills. Posting runs the real pipeline (lib/createPost/publish.ts) and
 * shows its real progress; a failed upload keeps everything and Retry resumes.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT } from '@/lib/theme';
import { HapticSwitch } from '@/components/BrandthreadUI';
import { useApi } from '@/lib/api';
import { isBuyerDevPreview, isSellerDevPreview } from '@/lib/devPreview';
import { getTaggableProducts } from '@/services/productService';
import type { Product } from '@/services/productTypes';
import type { PostProductTag, PostVisibility } from '@/services/types';
import type { MentionPerson } from '@/services/socialTypes';
import { MODE_LABEL, type PostMode } from '@/constants/postLimits';
import { activeToken, CAPTION_MAX, replaceToken, tokenizeCaption } from '@/lib/createPost/caption';
import type { MediaDraft, PostDetails, PublishInput } from '@/lib/createPost/types';
import { CP, CreateHeader, PillButton, SubPage, tap } from '@/components/create-post/ui';
import { formatCents } from '@/lib/money';
import { crispPx } from '@/lib/crispPixel';

const MAX_PRODUCT_TAGS = 5;
const isPreview = () => isSellerDevPreview() || isBuyerDevPreview();

export type PublishState =
  | { phase: 'idle' }
  | { phase: 'running'; fraction: number; step: 'uploading' | 'processing' | 'saving'; draft: boolean }
  | { phase: 'error'; message: string; draft: boolean };

function ratioOf(media: MediaDraft | null): number {
  if (!media || media.kind === 'video') return 9 / 16;
  return media.aspect === '1:1' ? 1 : media.aspect === '3:4' ? 3 / 4 : 9 / 16;
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

function OptionRow({ icon, label, value, onPress, testID }: {
  icon: keyof typeof Feather.glyphMap; label: string; value?: string; onPress: () => void; testID?: string;
}) {
  return (
    <Pressable onPress={() => { tap(); onPress(); }} style={s.row} accessibilityRole="button" testID={testID}>
      <Feather name={icon} size={22} color={CP.white} />
      <View style={{ flex: 1 }}>
        <Text style={s.rowLabel}>{label}</Text>
        {value ? <Text style={s.rowValue}>{value}</Text> : null}
      </View>
      <Feather name="chevron-right" size={20} color={CP.silverDim} />
    </Pressable>
  );
}

function Scrubber({ value, max, onChange }: { value: number; max: number; onChange: (v: number) => void }) {
  const [w, setW] = useState(0);
  const base = useSharedValue(0);
  const pan = Gesture.Pan()
    .onBegin((e) => { base.value = e.x; runOnJS(onChange)(Math.max(0, Math.min(max, (e.x / Math.max(1, w)) * max))); })
    .onUpdate((e) => { runOnJS(onChange)(Math.max(0, Math.min(max, ((base.value + e.translationX) / Math.max(1, w)) * max))); });
  const pos = max > 0 ? (value / max) * w : 0;
  return (
    <GestureDetector gesture={pan}>
      <View style={s.scrub} onLayout={(e) => setW(e.nativeEvent.layout.width)} testID="cover-scrubber">
        <View style={s.scrubTrack} />
        <View style={[s.scrubThumb, { left: Math.max(0, Math.min(w - 6, pos - 3)) }]} />
      </View>
    </GestureDetector>
  );
}

function VideoCoverPage({ uri, from, to, offset, onPick, onBack }: {
  uri: string; from: number; to: number; offset: number; onPick: (t: number) => void; onBack: () => void;
}) {
  const player = useVideoPlayer(uri, (p) => { p.loop = false; p.pause(); p.currentTime = from + offset; });
  const len = Math.max(0.1, to - from);
  return (
    <SubPage title="Edit cover" onBack={onBack} testID="cover-page">
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
      </View>
      <View style={{ paddingHorizontal: 20, paddingBottom: 24 }}>
        <Scrubber value={offset} max={len} onChange={(t) => { player.currentTime = from + t; onPick(t); }} />
        <Text style={s.hintCenter}>Drag to choose a cover frame</Text>
        <PillButton label="Done" onPress={onBack} testID="cover-done" flex={false} />
      </View>
    </SubPage>
  );
}

function SlideCoverPage({ media, onPick, onBack }: {
  media: Extract<MediaDraft, { kind: 'slides' }>; onPick: (i: number) => void; onBack: () => void;
}) {
  return (
    <SubPage title="Edit cover" onBack={onBack} testID="cover-page">
      <ScrollView contentContainerStyle={s.coverGrid}>
        {media.slides.map((sl, i) => (
          <Pressable key={sl.id} onPress={() => { tap(); onPick(i); }} style={[s.coverCell, i === media.coverIndex && s.coverCellOn]} accessibilityRole="button" testID={`cover-slide-${i}`}>
            <Image source={{ uri: sl.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            {i === media.coverIndex ? <View style={s.coverCheck}><Feather name="check" size={14} color={CP.black} /></View> : null}
          </Pressable>
        ))}
      </ScrollView>
      <View style={{ paddingHorizontal: 16, paddingBottom: 24 }}><PillButton label="Done" onPress={onBack} testID="cover-done" flex={false} /></View>
    </SubPage>
  );
}

function ProductsPage({ tags, onChange, onBack }: { tags: PostProductTag[]; onChange: (t: PostProductTag[]) => void; onBack: () => void }) {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [query, setQuery] = useState('');
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (isPreview()) { setProducts([]); return; }
    let live = true;
    getTaggableProducts().then((p) => { if (live) setProducts(p); }).catch(() => { if (live) setProducts([]); });
    return () => { live = false; };
  }, []);
  const shown = (products ?? []).filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <SubPage title="Tag products" onBack={onBack} testID="products-page">
      <View style={s.search}>
        <Feather name="search" size={18} color={CP.silverDim} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search your products" placeholderTextColor={CP.silverDim} style={s.searchInput} testID="products-search" />
      </View>
      {note ? <Text style={[s.hintCenter, { color: CP.white }]}>{note}</Text> : null}
      {products === null ? <ActivityIndicator color={CP.white} style={{ marginTop: 40 }} /> : shown.length === 0 ? (
        <View style={s.emptyWrap}>
          <Text style={s.emptyTitle}>{(products ?? []).length === 0 ? 'No products to tag yet' : 'No matches'}</Text>
          <Text style={s.emptyBody}>{(products ?? []).length === 0 ? 'Add a product to your store and you can tag it here.' : 'Try a different search.'}</Text>
        </View>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled">
          {shown.map((p) => {
            const on = tags.some((t) => t.productId === p.id);
            return (
              <Pressable
                key={p.id}
                style={s.productRow}
                accessibilityRole="button"
                testID={`product-${p.id}`}
                onPress={() => {
                  tap();
                  if (on) { onChange(tags.filter((t) => t.productId !== p.id)); setNote(null); return; }
                  if (tags.length >= MAX_PRODUCT_TAGS) { setNote(`You can tag up to ${MAX_PRODUCT_TAGS} products.`); return; }
                  onChange([...tags, { productId: p.id, productName: p.name, priceCents: p.pricing.priceCents }]);
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.rowLabel} numberOfLines={1}>{p.name}</Text>
                  <Text style={s.rowValue}>{formatCents(p.pricing.priceCents)}</Text>
                </View>
                <View style={[s.check, on && s.checkOn]}>{on ? <Feather name="check" size={14} color={CP.black} /> : null}</View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </SubPage>
  );
}

function VisibilityPage({ visibility, noun, onChange, onBack }: {
  visibility: PostVisibility; noun: string; onChange: (v: PostVisibility) => void; onBack: () => void;
}) {
  const options = [
    { id: true, title: 'Everyone', body: `Anyone on Brandthread can view this ${noun}.` },
    { id: false, title: 'Only me', body: `Only you can see this ${noun}.` },
  ];
  return (
    <SubPage title="Who can view this" onBack={onBack} testID="visibility-page">
      {options.map((o) => (
        <Pressable key={String(o.id)} style={s.productRow} onPress={() => { tap(); onChange({ ...visibility, isPublic: o.id }); }} accessibilityRole="radio" accessibilityState={{ selected: (visibility.isPublic ?? true) === o.id }} testID={`visibility-${o.id ? 'everyone' : 'me'}`}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>{o.title}</Text>
            <Text style={s.rowValue}>{o.body}</Text>
          </View>
          <View style={[s.check, (visibility.isPublic ?? true) === o.id && s.checkOn]}>
            {(visibility.isPublic ?? true) === o.id ? <Feather name="check" size={14} color={CP.black} /> : null}
          </View>
        </Pressable>
      ))}
    </SubPage>
  );
}

function OptionsPage({ visibility, onChange, onBack }: { visibility: PostVisibility; onChange: (v: PostVisibility) => void; onBack: () => void }) {
  const items: Array<{ key: 'allowComments' | 'allowReposts' | 'showLikeCount'; label: string }> = [
    { key: 'allowComments', label: 'Allow comments' },
    { key: 'allowReposts', label: 'Allow reposts' },
    { key: 'showLikeCount', label: 'Show like count' },
  ];
  return (
    <SubPage title="More options" onBack={onBack} testID="options-page">
      {items.map((it) => (
        <View key={it.key} style={s.productRow}>
          <Text style={[s.rowLabel, { flex: 1 }]}>{it.label}</Text>
          <HapticSwitch value={visibility[it.key]} onValueChange={(v: boolean) => onChange({ ...visibility, [it.key]: v })} testID={`option-${it.key}`} accessibilityLabel={it.label} />
        </View>
      ))}
    </SubPage>
  );
}

function SchedulePage({ value, onChange, onBack }: { value: string | null; onChange: (iso: string | null) => void; onBack: () => void }) {
  const initial = useMemo(() => {
    const d = value ? new Date(value) : new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
    return d;
  }, [value]);
  const [day, setDay] = useState(() => { const d = new Date(initial); d.setHours(0, 0, 0, 0); return d.getTime(); });
  const [hour, setHour] = useState(initial.getHours());
  const [minute, setMinute] = useState(initial.getMinutes());
  const [error, setError] = useState<string | null>(null);
  const days = useMemo(() => Array.from({ length: 30 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i); return d.getTime(); }), []);
  const chosen = new Date(day); chosen.setHours(hour, minute, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <SubPage title="Schedule" onBack={onBack} testID="schedule-page">
      <View style={s.calHead}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <Text key={i} style={s.calHeadText}>{d}</Text>)}
      </View>
      <View style={s.calGrid} testID="schedule-grid">
        {Array.from({ length: new Date(days[0]).getDay() }, (_, i) => <View key={`b${i}`} style={s.calCell} />)}
        {days.map((t) => {
          const d = new Date(t); const on = t === day;
          return (
            <View key={t} style={s.calCell}>
              <Pressable onPress={() => { tap(); setDay(t); setError(null); }} style={[s.calDay, on && s.calDayOn]} accessibilityRole="button" accessibilityLabel={d.toDateString()} testID={`schedule-day-${d.getDate()}`}>
                <Text style={[s.calDayText, on && { color: CP.black }]}>{d.getDate()}</Text>
              </Pressable>
            </View>
          );
        })}
      </View>
      <View style={s.timeRow}>
        {[{ v: hour, set: (n: number) => setHour((n + 24) % 24), label: 'hour' }, { v: minute, set: (n: number) => setMinute((n + 60) % 60), label: 'minute', step: 5 }].map((c) => (
          <View key={c.label} style={s.stepper}>
            <Pressable onPress={() => { tap(); c.set(c.v + (c.step ?? 1)); setError(null); }} accessibilityLabel={`Increase ${c.label}`} hitSlop={8}><Feather name="chevron-up" size={24} color={CP.white} /></Pressable>
            <Text style={s.stepValue}>{pad(c.v)}</Text>
            <Pressable onPress={() => { tap(); c.set(c.v - (c.step ?? 1)); setError(null); }} accessibilityLabel={`Decrease ${c.label}`} hitSlop={8}><Feather name="chevron-down" size={24} color={CP.white} /></Pressable>
          </View>
        ))}
      </View>
      <Text style={s.hintCenter}>{chosen.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}</Text>
      {error ? <Text style={[s.hintCenter, { color: CP.white, fontFamily: FONT.semibold }]}>{error}</Text> : null}
      <View style={{ flex: 1 }} />
      <View style={s.scheduleButtons}>
        {value ? <PillButton label="Post now" variant="secondary" onPress={() => { onChange(null); onBack(); }} testID="schedule-clear" /> : null}
        <PillButton label="Confirm" testID="schedule-confirm" onPress={() => {
          if (chosen.getTime() <= Date.now() + 60_000) { setError('Choose a time in the future.'); return; }
          onChange(chosen.toISOString()); onBack();
        }} />
      </View>
    </SubPage>
  );
}


function TagPeoplePage({ caption, onCaption, onBack }: { caption: string; onCaption: (c: string) => void; onBack: () => void }) {
  const api = useApi();
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<MentionPerson[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (isPreview()) { setPeople([]); return; }
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      api.social.mentionSearch(q, 20).then((r: MentionPerson[]) => { if (live) setPeople(r); }).catch(() => { if (live) setPeople([]); }).finally(() => { if (live) setLoading(false); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const handleOf = (p: MentionPerson) => `@${(p.username ?? p.handle ?? '').replace(/^@/, '')}`;
  const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const has = (h: string) => new RegExp(`(^|\\s)${escapeRe(h)}(?=\\s|$)`).test(caption);
  const toggle = (h: string, on: boolean) => {
    if (on) onCaption(caption.replace(new RegExp(`\\s?${escapeRe(h)}(?=\\s|$)`, 'g'), '').trim());
    else onCaption(`${caption}${caption && !/\s$/.test(caption) ? ' ' : ''}${h} `);
  };
  return (
    <SubPage title="Tag people" onBack={onBack} testID="people-page">
      <View style={s.search}>
        <Feather name="search" size={18} color={CP.silverDim} />
        <TextInput value={q} onChangeText={setQ} placeholder="Search people" placeholderTextColor={CP.silverDim} style={s.searchInput} testID="people-search" autoCapitalize="none" />
      </View>
      {loading ? <ActivityIndicator color={CP.white} style={{ marginTop: 24 }} /> : people.length === 0 ? (
        <View style={s.emptyWrap}>
          <Text style={s.emptyTitle}>{q ? 'No one found' : 'Search for people to tag'}</Text>
          <Text style={s.emptyBody}>Tagged people are mentioned in your caption.</Text>
        </View>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled">
          {people.map((p) => {
            const h = handleOf(p); const on = has(h);
            return (
              <Pressable key={p.userId} style={s.productRow} accessibilityRole="button" testID={`people-${p.userId}`}
                onPress={() => { tap(); toggle(h, on); }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowLabel} numberOfLines={1}>{p.name}</Text>
                  <Text style={s.rowValue}>{p.handle}</Text>
                </View>
                <View style={[s.check, on && s.checkOn]}>{on ? <Feather name="check" size={14} color={CP.black} /> : null}</View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </SubPage>
  );
}

function DiscardPage({ onSave, onDiscard, onKeep }: { onSave: () => void; onDiscard: () => void; onKeep: () => void }) {
  return (
    <View style={[StyleSheet.absoluteFill, s.progressPage, { zIndex: 90 }]} testID="discard-page">
      <Text style={s.progressTitle}>Save this post as a draft?</Text>
      <Text style={[s.emptyBody, { marginBottom: 24 }]}>If you discard now, you'll lose your edits.</Text>
      <View style={{ alignSelf: 'stretch', gap: 10 }}>
        <PillButton label="Save draft" onPress={onSave} testID="discard-save" flex={false} />
        <PillButton label="Discard" variant="secondary" onPress={onDiscard} testID="discard-discard" flex={false} />
        <PillButton label="Keep editing" variant="secondary" onPress={onKeep} testID="discard-keep" flex={false} />
      </View>
    </View>
  );
}

function ProgressPage({ state, onRetry, onCancel }: { state: PublishState; onRetry: () => void; onCancel: () => void }) {
  if (state.phase === 'idle') return null;
  const err = state.phase === 'error';
  const pct = state.phase === 'running' ? Math.round(state.fraction * 100) : 0;
  const label = state.phase === 'running'
    ? state.step === 'uploading' ? (state.draft ? 'Saving draft' : 'Uploading') : state.step === 'processing' ? 'Processing' : 'Finishing up'
    : '';
  return (
    <View style={[StyleSheet.absoluteFill, s.progressPage]} testID="publish-progress">
      {err ? (
        <>
          <Text style={s.progressTitle}>{state.draft ? "Couldn't save your draft" : "Couldn't post"}</Text>
          <Text style={s.emptyBody}>{state.message}</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 24, alignSelf: 'stretch' }}>
            <PillButton label="Cancel" variant="secondary" onPress={onCancel} testID="publish-cancel" />
            <PillButton label="Retry" onPress={onRetry} testID="publish-retry" />
          </View>
        </>
      ) : (
        <>
          <Text style={s.progressTitle} testID="publish-label">{label}</Text>
          <View style={s.bar}><View style={[s.barFill, { width: `${pct}%` }]} /></View>
          <Text style={s.progressPct} testID="publish-percent" accessibilityLiveRegion="polite">{pct}%</Text>
        </>
      )}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export function PostScreen({
  mode, isSeller, media, onMedia, details, onDetails, editing, existingThumb, publishState, onSubmit, onRetry, onCancelPublish, onBack, onDiscard,
}: {
  mode: PostMode;
  isSeller: boolean;
  media: MediaDraft | null;
  onMedia: (m: MediaDraft) => void;
  details: PostDetails;
  onDetails: (d: PostDetails) => void;
  editing: boolean;
  existingThumb?: string;
  publishState: PublishState;
  onSubmit: (asDraft: boolean) => void;
  onRetry: () => void;
  onCancelPublish: () => void;
  onBack: () => void;
  onDiscard: () => void;
}) {
  const insets = useSafeAreaInsets();
  const api = useApi();
  const isPost = mode === 'post';
  const [confirmExit, setConfirmExit] = useState(false);
  const input = useRef<TextInput>(null);
  const [cursor, setCursor] = useState(details.caption.length);
  const [page, setPage] = useState<null | 'products' | 'visibility' | 'options' | 'schedule' | 'cover' | 'people'>(null);
  const [people, setPeople] = useState<MentionPerson[]>([]);
  const noun = mode === 'thread' ? 'thread' : 'post';
  const token = activeToken(details.caption, cursor);
  const busy = publishState.phase === 'running';

  // @mention suggestions — the existing people picker endpoint the story sticker uses.
  useEffect(() => {
    if (!token || token.trigger !== '@' || isPreview()) { setPeople([]); return; }
    let live = true;
    const t = setTimeout(() => {
      api.social.mentionSearch(token.query, 8).then((r: MentionPerson[]) => { if (live) setPeople(r); }).catch(() => { if (live) setPeople([]); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token?.trigger, token?.query, token?.start]);

  const tokens = useMemo(() => tokenizeCaption(details.caption), [details.caption]);
  const coverSlide = media?.kind === 'slides' ? media.slides[media.coverIndex] : undefined;
  const coverIsVideo = media?.kind === 'video' || coverSlide?.kind === 'video';
  const coverUri = media?.kind === 'slides' ? (coverSlide?.kind === 'photo' ? coverSlide.uri : undefined) : existingThumb;
  const ratio = ratioOf(media);

  function insert(char: '#' | '@') {
    tap();
    const before = details.caption.slice(0, cursor);
    const needsSpace = before.length > 0 && !/\s$/.test(before);
    const text = `${before}${needsSpace ? ' ' : ''}${char}${details.caption.slice(cursor)}`;
    onDetails({ ...details, caption: text.slice(0, CAPTION_MAX) });
    setCursor(before.length + (needsSpace ? 1 : 0) + 1);
    input.current?.focus();
  }
  function pickPerson(p: MentionPerson) {
    if (!token) return;
    const handle = `@${(p.username ?? p.handle ?? '').replace(/^@/, '')}`;
    const r = replaceToken(details.caption, token, cursor, handle);
    onDetails({ ...details, caption: r.text });
    setCursor(r.cursor);
    setPeople([]);
  }

  const mentionCount = tokens.filter((t) => t.kind === 'mention').length;
  const scheduled = details.scheduledAt ? new Date(details.scheduledAt) : null;
  const postLabel = scheduled ? 'Schedule' : 'Post';

  return (
    <View style={s.root} testID="post-screen">
      <CreateHeader title={editing ? `Edit ${noun}` : mode === 'thread' ? 'Post to Threads' : 'New post'} onBack={() => (isPost && !editing ? setConfirmExit(true) : onBack())} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 16 }}>
          <View style={s.captionRow}>
            <View style={s.captionBox}>
              <Text style={[s.captionText, s.mirror]} pointerEvents="none" aria-hidden>
                {details.caption.length === 0 ? '' : tokens.map((t, i) => (
                  <Text key={i} style={t.kind === 'text' ? undefined : s.tokenText}>{t.text}</Text>
                ))}
              </Text>
              <TextInput
                ref={input}
                testID="caption-input"
                value={details.caption}
                onChangeText={(text) => onDetails({ ...details, caption: text.slice(0, CAPTION_MAX) })}
                onSelectionChange={(e) => setCursor(e.nativeEvent.selection.end)}
                placeholder={mode === 'thread' ? 'Describe your thread, add #hashtags, or @mention people' : 'Describe your post, add #hashtags, or @mention people'}
                placeholderTextColor={CP.silverDim}
                multiline
                maxLength={CAPTION_MAX}
                style={[s.captionText, s.captionInput]}
                selectionColor={CP.white}
                cursorColor={CP.white}
                underlineColorAndroid="transparent"
              />
            </View>
            <Pressable onPress={() => { if (media && !isPost) { tap(); setPage('cover'); } }} style={[s.cover, isPost && s.coverSmall, isPost && { order: -1 } as any, { aspectRatio: ratio }]} accessibilityRole="button" accessibilityLabel="Edit cover" testID="edit-cover" disabled={!media || isPost} {...({ dataSet: { textfitIgnore: '1' } } as object)}>
              {coverUri ? <Image source={{ uri: coverUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />   : coverIsVideo ? <View style={[StyleSheet.absoluteFill, { backgroundColor: CP.surface2, alignItems: 'center', justifyContent: 'center' }]}><Feather name="video" size={26} color={CP.silver} /></View> : null}
              {media && !isPost ? <Text style={s.coverLabel}>Edit cover</Text> : null}
            </Pressable>
          </View>

          {!isPost ? <View style={s.chips}>
            <Pressable onPress={() => insert('#')} style={s.chip} accessibilityRole="button" testID="chip-hashtags"><Text style={s.chipText}># Hashtags</Text></Pressable>
            <Pressable onPress={() => insert('@')} style={s.chip} accessibilityRole="button" testID="chip-mention"><Text style={s.chipText}>@ Mention</Text></Pressable>
          </View> : null}
          {people.length > 0 ? (
            <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={s.people} testID="mention-suggestions">
              {people.map((p) => (
                <Pressable key={p.userId} onPress={() => pickPerson(p)} style={s.person} accessibilityRole="button" testID={`mention-${p.userId}`}>
                  <Text style={s.personName} numberOfLines={1}>{p.name}</Text>
                  <Text style={s.personHandle} numberOfLines={1}>{p.handle}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          <View style={{ height: 8 }} />
          {isPost ? <OptionRow icon="user" label="Tag people" value={mentionCount ? `${mentionCount} tagged` : undefined} onPress={() => setPage('people')} testID="row-people" /> : null}
          {isSeller ? (
            <OptionRow icon="tag" label="Tag products" value={details.productTags.length ? `${details.productTags.length} tagged` : undefined} onPress={() => setPage('products')} testID="row-products" />
          ) : null}
          <OptionRow
            icon={(details.visibility.isPublic ?? true) ? 'globe' : 'lock'}
            label={isPost ? 'Audience' : (details.visibility.isPublic ?? true) ? `Everyone can view this ${noun}` : `Only you can view this ${noun}`}
            value={isPost ? ((details.visibility.isPublic ?? true) ? 'Everyone' : 'Only me') : undefined}
            onPress={() => setPage('visibility')}
            testID="row-visibility"
          />
          <OptionRow icon="more-horizontal" label="More options" value="Comments, reposts, like count" onPress={() => setPage('options')} testID="row-options" />
          {isSeller ? (
            <OptionRow icon="calendar" label="Schedule" value={scheduled ? scheduled.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Post now'} onPress={() => setPage('schedule')} testID="row-schedule" />
          ) : null}
        </ScrollView>

        <View style={[s.bottom, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          {isPost && !editing ? (
            <PillButton label={postLabel === 'Post' ? 'Share' : postLabel} onPress={() => onSubmit(false)} disabled={busy} testID="post-submit" />
          ) : (
            <>
              <PillButton label={editing ? 'Save draft' : 'Drafts'} icon="folder" variant="secondary" onPress={() => onSubmit(true)} disabled={busy} testID="post-drafts" />
              <PillButton label={editing ? 'Save' : postLabel} icon="send" onPress={() => onSubmit(false)} disabled={busy} testID="post-submit" />
            </>
          )}
        </View>
      </KeyboardAvoidingView>

      {page === 'people' ? <TagPeoplePage caption={details.caption} onCaption={(caption) => onDetails({ ...details, caption })} onBack={() => setPage(null)} /> : null}
      {confirmExit ? <DiscardPage onSave={() => { setConfirmExit(false); onSubmit(true); }} onDiscard={() => { setConfirmExit(false); onDiscard(); }} onKeep={() => setConfirmExit(false)} /> : null}
      {page === 'products' ? <ProductsPage tags={details.productTags} onChange={(productTags) => onDetails({ ...details, productTags })} onBack={() => setPage(null)} /> : null}
      {page === 'visibility' ? <VisibilityPage visibility={details.visibility} noun={noun} onChange={(visibility) => onDetails({ ...details, visibility })} onBack={() => setPage(null)} /> : null}
      {page === 'options' ? <OptionsPage visibility={details.visibility} onChange={(visibility) => onDetails({ ...details, visibility })} onBack={() => setPage(null)} /> : null}
      {page === 'schedule' ? <SchedulePage value={details.scheduledAt} onChange={(scheduledAt) => onDetails({ ...details, scheduledAt })} onBack={() => setPage(null)} /> : null}
      {page === 'cover' && media?.kind === 'slides' ? <SlideCoverPage media={media} onPick={(coverIndex) => onMedia({ ...media, coverIndex })} onBack={() => setPage(null)} /> : null}
      {page === 'cover' && media?.kind === 'video' ? (
        <VideoCoverPage uri={media.video.uri} from={media.video.trimStart} to={media.video.trimEnd} offset={media.video.coverOffset} onPick={(t) => onMedia({ kind: 'video', video: { ...media.video, coverOffset: t } })} onBack={() => setPage(null)} />
      ) : null}
      <ProgressPage state={publishState} onRetry={onRetry} onCancel={onCancelPublish} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: CP.black },
  captionRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 4 },
  captionBox: { flex: 1, minHeight: 132 },
  captionText: { fontFamily: FONT.regular, fontSize: 16, lineHeight: 22, padding: 0, margin: 0, color: CP.silver },
  mirror: { position: 'absolute', left: 0, right: 0, top: 0 },
  captionInput: { minHeight: 132, textAlignVertical: 'top', color: 'transparent', outlineStyle: 'none' as any },
  tokenText: { color: CP.white },
  cover: { width: 100, borderRadius: 8, overflow: 'hidden', backgroundColor: CP.surface, alignSelf: 'flex-start', maxHeight: 178 },
  coverSmall: { width: 64, maxHeight: 96 },
  coverLabel: { position: 'absolute', bottom: 6, alignSelf: 'center', color: CP.white, fontFamily: FONT.semibold, fontSize: 12, backgroundColor: CP.black, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, overflow: 'hidden' },
  chips: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  // Same-row chips share one width (equal grid), inner padding ≥12px.
  chip: { backgroundColor: CP.surface2, paddingHorizontal: 12, width: 124, height: 34, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  chipText: { color: CP.white, fontFamily: FONT.semibold, fontSize: 14 },
  people: { paddingHorizontal: 16, paddingTop: 10, gap: 8 },
  person: { backgroundColor: CP.surface, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, maxWidth: 180 },
  personName: { color: CP.white, fontFamily: FONT.semibold, fontSize: 14 },
  personHandle: { color: CP.silver, fontFamily: FONT.regular, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, minHeight: 60, paddingVertical: 10 },
  rowLabel: { color: CP.white, fontFamily: FONT.semibold, fontSize: 16 },
  rowValue: { color: CP.silver, fontFamily: FONT.regular, fontSize: 13, marginTop: 2 },
  bottom: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 10, backgroundColor: CP.black },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, paddingHorizontal: 12, height: 44, borderRadius: 10, backgroundColor: CP.surface2 },
  searchInput: { flex: 1, color: CP.white, fontFamily: FONT.regular, fontSize: 15, outlineStyle: 'none' as any },
  emptyWrap: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyTitle: { color: CP.white, fontFamily: FONT.bold, fontSize: 17, textAlign: 'center' },
  emptyBody: { color: CP.silver, fontFamily: FONT.regular, fontSize: 14, textAlign: 'center', marginTop: 6 },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 64, paddingVertical: 10 },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: crispPx(1.5), borderColor: CP.silver, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: CP.white, borderColor: CP.white },
  hintCenter: { color: CP.silver, fontFamily: FONT.regular, fontSize: 13, textAlign: 'center', marginVertical: 10, paddingHorizontal: 16 },
  coverGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 2, padding: 2 },
  coverCell: { width: '32.6%', aspectRatio: 3 / 4, borderWidth: 2, borderColor: 'transparent' },
  coverCellOn: { borderColor: CP.white },
  coverCheck: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: CP.white, alignItems: 'center', justifyContent: 'center' },
  scrub: { height: 36, justifyContent: 'center' },
  scrubTrack: { height: 4, borderRadius: 2, backgroundColor: CP.surface2 },
  scrubThumb: { position: 'absolute', width: 6, height: 28, borderRadius: 3, backgroundColor: CP.white },
  calHead: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 8 },
  calHeadText: { width: '14.2857%', textAlign: 'center', color: CP.silverDim, fontFamily: FONT.semibold, fontSize: 12 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingTop: 4 },
  calCell: { width: '14.2857%', height: 48, alignItems: 'center', justifyContent: 'center' },
  calDay: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  calDayOn: { backgroundColor: CP.white },
  calDayText: { color: CP.white, fontFamily: FONT.semibold, fontSize: 15 },
  timeRow: { flexDirection: 'row', justifyContent: 'center', gap: 40, paddingVertical: 24 },
  stepper: { alignItems: 'center', gap: 6 },
  stepValue: { color: CP.white, fontFamily: FONT.bold, fontSize: 34, minWidth: 60, textAlign: 'center' },
  scheduleButtons: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingBottom: 24 },
  progressPage: { backgroundColor: CP.black, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, zIndex: 100 },
  progressTitle: { color: CP.white, fontFamily: FONT.bold, fontSize: 20, marginBottom: 20, textAlign: 'center' },
  bar: { alignSelf: 'stretch', height: 6, borderRadius: 3, backgroundColor: CP.surface2, overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: CP.white },
  progressPct: { color: CP.silver, fontFamily: FONT.semibold, fontSize: 15, marginTop: 14 },
});
